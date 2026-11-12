import { PARTICIPANT_ACTIVITY_HOOK } from "../external-services/catalog.js";
import {
    COMPOSING_KIND,
    COMPOSING_SERVICE_INTERVAL_MS,
    COMPOSING_SERVICE_TTL_SECONDS,
} from "./composing-signal.js";
import { getPhaseExternalServices } from "./designs-helper.js";
import { describeError } from "./log-safety.js";

// Participants' composing signals on their way to AI services (epic #601,
// #655). The group notice follows every signal; the services receive them
// coalesced per participant, group and question:
//
// - the first `composing`, then at most one every
//   COMPOSING_SERVICE_INTERVAL_MS;
// - a `stopped` only after a forwarded `composing`, once. The next
//   `composing` is a first one again.
//
// An entry expires COMPOSING_SERVICE_TTL_SECONDS after its last forwarded
// `composing`: the services no longer count the participant as active, so
// a later `stopped` is not forwarded and a later `composing` is a first one.
// The state lives in this process only (see EXTERNAL.md, "Single instance").

function entryKey({ userId, groupId, questionId }) {
    return `${userId}:${groupId}:${questionId}`;
}

/**
 * The coalescing state of participants' signals.
 *
 * @param {Object} [options]
 * @param {() => number} [options.now] - Epoch milliseconds; replaced in tests.
 * @param {number} [options.intervalMs=COMPOSING_SERVICE_INTERVAL_MS]
 * @param {number} [options.entryTtlMs] - COMPOSING_SERVICE_TTL_SECONDS in
 *     milliseconds by default.
 * @returns {{
 *     shouldForward: (signal: { userId: number, groupId: number,
 *         questionId: number, kind: "composing"|"stopped" }) => boolean,
 *     forget: (participant: { userId: number, groupId: number,
 *         questionId: number }) => void,
 *     size: () => number,
 * }} `shouldForward()` records the decision it returns.
 */
export function createParticipantActivityCoalescer({
    now = () => Date.now(),
    intervalMs = COMPOSING_SERVICE_INTERVAL_MS,
    entryTtlMs = COMPOSING_SERVICE_TTL_SECONDS * 1000,
} = {}) {
    // Key -> time of the last forwarded `composing`.
    const forwardedAt = new Map();
    let lastSweepAt = now();

    function isExpired(at, currentTime) {
        return currentTime - at >= entryTtlMs;
    }

    // Forgets expired entries at most once per TTL, so participants who left
    // without a `stopped` do not accumulate.
    function sweep(currentTime) {
        if (currentTime - lastSweepAt < entryTtlMs) {
            return;
        }
        lastSweepAt = currentTime;
        for (const [key, at] of forwardedAt) {
            if (isExpired(at, currentTime)) {
                forwardedAt.delete(key);
            }
        }
    }

    function shouldForward(signal) {
        const currentTime = now();
        sweep(currentTime);

        const key = entryKey(signal);
        const last = forwardedAt.get(key);
        const active = last !== undefined && !isExpired(last, currentTime);

        if (signal.kind === COMPOSING_KIND) {
            if (active && currentTime - last < intervalMs) {
                return false;
            }
            forwardedAt.set(key, currentTime);
            return true;
        }

        forwardedAt.delete(key);
        return active;
    }

    return {
        shouldForward,
        forget: participant => forwardedAt.delete(entryKey(participant)),
        size:   () => forwardedAt.size,
    };
}

// The registry is loaded on the first dispatch: it imports the socket
// configuration, which imports this module through the student socket.
async function dispatchWithRegistry(hookName, context, options) {
    const { default: registry } = await import("../services/external-services.service.js");
    return registry.dispatchEphemeralHook(hookName, context, options);
}

/**
 * Forwards participants' composing signals to the AI services of their phase
 * through the `participant-activity` ephemeral hook, coalesced.
 *
 * @param {Object} [dependencies] - Replaced in tests.
 * @param {ReturnType<typeof createParticipantActivityCoalescer>}
 *     [dependencies.coalescer]
 * @param {(phaseId: number) => Promise<{ enabledServiceIds: string[] }>}
 *     [dependencies.loadPhaseServices=getPhaseExternalServices] - None when
 *     the activity runs with its AI services off.
 * @param {Function} [dependencies.dispatchEphemeralHook] -
 *     registry.dispatchEphemeralHook() by default, which applies the hook
 *     subscriptions and the AI service policy.
 * @param {{ error: Function }} [dependencies.logger=console]
 */
export function createParticipantActivityForwarder({
    coalescer = createParticipantActivityCoalescer(),
    loadPhaseServices = getPhaseExternalServices,
    dispatchEphemeralHook = dispatchWithRegistry,
    logger = console,
} = {}) {
    /**
     * Forwards one accepted signal, when the coalescing lets it through. The
     * decision is taken when called, before any await, so signals are
     * coalesced in the order they are passed.
     *
     * @param {{ kind: "composing"|"stopped", sessionId: number,
     *     phaseId: number, questionId: number, groupId: number,
     *     userId: number, receivedAt: number }} signal - `receivedAt` is the
     *     server's receipt time in epoch milliseconds.
     * @returns {Promise<void>} Never rejects; a failure is logged with the
     *     ids and the error's description only.
     */
    async function forward({ kind, sessionId, phaseId, questionId, groupId, userId, receivedAt }) {
        if (!coalescer.shouldForward({ userId, groupId, questionId, kind })) {
            return;
        }

        try {
            const { enabledServiceIds = [] } = await loadPhaseServices(phaseId) ?? {};
            if (enabledServiceIds.length === 0) {
                return;
            }
            await dispatchEphemeralHook(PARTICIPANT_ACTIVITY_HOOK, {
                kind,
                sessionId,
                phaseId,
                questionId,
                groupId,
                userId,
                receivedAt,
            }, { enabledServiceIds });
        } catch (error) {
            logger.error("[composing] Could not forward participant activity to AI services.", {
                sessionId,
                phaseId,
                groupId,
                error: describeError(error),
            });
        }
    }

    return {
        forward,
        forget: participant => coalescer.forget(participant),
    };
}
