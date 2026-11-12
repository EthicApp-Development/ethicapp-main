import { PARTICIPANT_ACTIVITY_HOOK } from "../external-services/catalog.js";
import {
    COMPOSING_KINDS,
    COMPOSING_SERVICE_TTL_MAX_SECONDS,
    COMPOSING_SERVICE_TTL_SECONDS,
    isComposingKind,
} from "../helpers/composing-signal.js";

// Ephemeral hooks (epic #601, #654): signals that tell a service what is
// happening right now and lose their meaning shortly after. They are
// dispatched by registry.dispatchEphemeralHook(), never by dispatchHook():
// they create no job, inject no `jobId`, pass no `callback` and collect no
// result. Each handler receives only its context; a failure is logged
// without content and affects neither the other services nor the caller.

export { PARTICIPANT_ACTIVITY_HOOK };

const ID_FIELDS = Object.freeze(["sessionId", "phaseId", "questionId", "groupId", "userId"]);

function isPositiveId(value) {
    return Number.isSafeInteger(value) && value > 0;
}

function normalizeReceivedAt(value) {
    const date = value instanceof Date || typeof value === "number" || typeof value === "string"
        ? new Date(value)
        : null;
    return date !== null && Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/**
 * The context of `participant-activity`: `{ kind, sessionId, phaseId,
 * questionId, groupId, userId, receivedAt, ttlSeconds }`, frozen, and nothing
 * else. Any other field of `context` is dropped, so no draft text, key,
 * length or client time can reach a service.
 *
 * - `kind` is `composing` or `stopped`.
 * - The ids are positive integers. `userId` is the participant who writes.
 * - `receivedAt` is the server's receipt time of the signal (a Date, epoch
 *   milliseconds or an ISO 8601 string), returned as ISO 8601.
 * - `ttlSeconds` defaults to COMPOSING_SERVICE_TTL_SECONDS, and otherwise is
 *   an integer from 1 to COMPOSING_SERVICE_TTL_MAX_SECONDS.
 *
 * @param {Object} context
 * @returns {Readonly<Object>}
 * @throws {TypeError} When a field is missing or invalid; the message names
 *     the field only.
 */
export function normalizeParticipantActivityContext(context) {
    if (context === null || typeof context !== "object" || Array.isArray(context)) {
        throw new TypeError("A participant-activity context must be an object.");
    }
    if (!isComposingKind(context.kind)) {
        throw new TypeError(
            `A participant-activity context needs a kind among ${COMPOSING_KINDS.join(", ")}.`
        );
    }

    const ids = {};
    for (const field of ID_FIELDS) {
        if (!isPositiveId(context[field])) {
            throw new TypeError(
                `A participant-activity context needs a positive integer ${field}.`
            );
        }
        ids[field] = context[field];
    }

    const receivedAt = normalizeReceivedAt(context.receivedAt);
    if (receivedAt === null) {
        throw new TypeError(
            "A participant-activity context needs the time the signal was received."
        );
    }

    const ttlSeconds = context.ttlSeconds ?? COMPOSING_SERVICE_TTL_SECONDS;
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1
        || ttlSeconds > COMPOSING_SERVICE_TTL_MAX_SECONDS) {
        throw new TypeError(
            "A participant-activity ttlSeconds must be an integer from 1 to "
            + `${COMPOSING_SERVICE_TTL_MAX_SECONDS}.`
        );
    }

    return Object.freeze({ kind: context.kind, ...ids, receivedAt, ttlSeconds });
}

// The context normalizer of each ephemeral hook.
const CONTEXT_NORMALIZERS = Object.freeze({
    [PARTICIPANT_ACTIVITY_HOOK]: normalizeParticipantActivityContext,
});

/**
 * The normalized context of an ephemeral hook (see the normalizer of each
 * hook above).
 * @param {string} hookName - One of EPHEMERAL_HOOKS.
 * @param {Object} context
 * @returns {Readonly<Object>}
 * @throws {TypeError} For an unknown hook or an invalid context.
 */
export function normalizeEphemeralContext(hookName, context) {
    const normalize = Object.hasOwn(CONTEXT_NORMALIZERS, hookName)
        ? CONTEXT_NORMALIZERS[hookName]
        : null;
    if (!normalize) {
        throw new TypeError(`${hookName} is not an ephemeral hook.`);
    }
    return normalize(context);
}

/**
 * Runs the handlers of an ephemeral hook concurrently. Each one receives a
 * frozen copy of `context` with its `serviceId`, and nothing else. A handler
 * that throws or rejects is logged with the hook, the service, the session,
 * the phase and the group, plus the error's name, code and status code; its
 * message is never logged.
 *
 * @param {Object} options
 * @param {string} options.hookName
 * @param {Readonly<Object>} options.context - A normalized context.
 * @param {{ serviceId: string, handler: Function }[]} options.subscribers
 * @param {{ warn: Function }} [options.logger=console]
 * @returns {Promise<{ serviceId: string, status: "delivered"|"failed" }[]>}
 *     One outcome per subscriber, in order. Handler return values are ignored.
 */
export async function runEphemeralHandlers({ hookName, context, subscribers, logger = console }) {
    const settled = await Promise.allSettled(subscribers.map(async ({ serviceId, handler }) =>
        handler(Object.freeze({ ...context, serviceId }))
    ));

    return settled.map((outcome, index) => {
        const { serviceId } = subscribers[index];
        if (outcome.status === "fulfilled") {
            return { serviceId, status: "delivered" };
        }

        const error = outcome.reason;
        logger.warn("[external-services] An ephemeral hook handler failed.", {
            hookName,
            serviceId,
            sessionId: context.sessionId ?? null,
            phaseId:   context.phaseId ?? null,
            groupId:   context.groupId ?? null,
            errorName: typeof error?.name === "string" ? error.name : null,
            errorCode: typeof error?.code === "string" || typeof error?.code === "number"
                ? String(error.code)
                : null,
            statusCode: Number.isInteger(error?.statusCode) ? error.statusCode : null,
        });
        return { serviceId, status: "failed" };
    });
}
