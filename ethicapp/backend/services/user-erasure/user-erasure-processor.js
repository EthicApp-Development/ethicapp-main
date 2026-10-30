import { userErasureRequestsStore } from "./user-erasure-requests.store.js";

/**
 * Background processing of user erasure requests (#876, epic #879).
 *
 * When the management console forgets a student, it anonymizes the account
 * in EthicApp and records, in the same transaction, one pending request per
 * AI Additions service (user_erasure_requests, V29). The scheduled
 * anonymization job, which runs while ethicapp is stopped, records them too.
 * This processor, which runs inside the ethicapp web process because it holds
 * the AI Additions credentials and the adapter registry, sends them:
 *
 * - Every `intervalMs` it claims the due pending requests (a lease, so
 *   concurrent ethicapp processes never attempt the same request at once)
 *   and dispatches the `user-forgotten` global hook to the adapters that
 *   declare it and require the request's service, one service at a time.
 * - A confirmed erasure marks the request done. A failure a retry can fix
 *   (the service unreachable, a timeout, a 5xx, no AI Additions connection)
 *   schedules the next attempt with an exponential backoff,
 *   min(RETRY_BASE_DELAY_MS * 2^(attempts - 1), RETRY_MAX_DELAY_MS). Such a
 *   request stays pending until the service is back; it never gives up. A
 *   failure a retry cannot fix (a 400, no adapter for the service) marks it
 *   failed, for an administrator to retry by hand.
 * - The state lives in the database only, so processing survives restarts:
 *   the first tick after a start takes every due request, and a request whose
 *   attempt was cut short by a crash is due again once its lease ends.
 */

export const USER_FORGOTTEN_HOOK = "user-forgotten";

export const DEFAULT_INTERVAL_MS = 30 * 1000;
export const RETRY_BASE_DELAY_MS = 60 * 1000;
export const RETRY_MAX_DELAY_MS = 6 * 60 * 60 * 1000;
// Longer than an attempt can take (two AI Additions calls of at most
// AI_ADDITIONS_HTTP_TIMEOUT_MS each, plus a token request).
export const CLAIM_LEASE_MS = 5 * 60 * 1000;
const DEFAULT_BATCH_SIZE = 10;
const FIRST_TICK_DELAY_MS = 5 * 1000;

// HTTP statuses that say the request itself is wrong: retrying the same
// request cannot succeed. Everything else is retried (404 too: an AI
// Additions release without the erasure endpoint may be upgraded later).
const PERMANENT_HTTP_STATUSES = new Set([400, 422]);

/**
 * The delay before the next attempt, after `attempts` failed ones.
 * @param {number} attempts - Failed attempts so far, including this one (>= 1).
 * @returns {number} Milliseconds.
 */
export function retryDelayMs(attempts) {
    const exponent = Math.max(0, Math.min(Number(attempts) - 1, 30));
    return Math.min(RETRY_BASE_DELAY_MS * 2 ** exponent, RETRY_MAX_DELAY_MS);
}

/**
 * What an attempt's error means: an upper-case code to record, and whether a
 * later attempt may succeed. Messages are never recorded: they may carry URLs
 * or response text.
 * @param {unknown} error
 * @returns {{ code: string, retryable: boolean }}
 */
export function classifyErasureError(error) {
    if (error?.code === "not_configured") {
        return { code: "NOT_CONFIGURED", retryable: true };
    }
    if (error?.code === "credentials_missing") {
        return { code: "CREDENTIALS_MISSING", retryable: true };
    }
    if (error?.code === "invalid_user_id") {
        return { code: "INVALID_USER_ID", retryable: false };
    }

    const statusCode = Number(error?.statusCode);
    if (Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599) {
        return { code: `HTTP_${statusCode}`, retryable: !PERMANENT_HTTP_STATUSES.has(statusCode) };
    }

    if (error?.name === "AbortError" || error?.name === "TimeoutError") {
        return { code: "TIMEOUT", retryable: true };
    }

    return { code: "UNREACHABLE", retryable: true };
}

function rejectionOf(outcomes) {
    return outcomes.find(outcome => outcome?.status === "rejected") ?? null;
}

/**
 * @param {Object} options
 * @param {Object} options.registry - The external services registry:
 *     initialize(), initialized, globalHookServiceIds(), getServiceById(),
 *     hasAiAdditionsConnection(), dispatchGlobalHook().
 * @param {Object} [options.store] - A UserErasureRequestsStore.
 */
export function createUserErasureProcessor({
    registry,
    store = userErasureRequestsStore,
    logger = console,
    intervalMs = DEFAULT_INTERVAL_MS,
    batchSize = DEFAULT_BATCH_SIZE,
    leaseMs = CLAIM_LEASE_MS,
    timers = { setTimeout, clearTimeout },
} = {}) {
    let timer = null;
    let running = false;
    let activeTick = null;

    // The adapters that erase a service's data: those that declare the hook
    // in `globalHooks` and require the service.
    function erasureAdapterIds(serviceId) {
        return registry.globalHookServiceIds(USER_FORGOTTEN_HOOK)
            .filter(adapterId => (registry.getServiceById(adapterId)?.requires ?? [])
                .includes(serviceId));
    }

    async function recordFailure(request, { code, retryable }) {
        const label = `[user-erasure] Erasure request ${request.id} (${request.serviceId})`;
        if (retryable) {
            const delayMs = retryDelayMs(request.attempts + 1);
            await store.markRetry(request.id, code, delayMs);
            logger.warn(
                `${label} failed with ${code}; retrying in ${Math.round(delayMs / 1000)} s.`
            );
            return "retrying";
        }

        await store.markFailed(request.id, code);
        logger.error(
            `${label} failed with ${code}; it needs an administrator's retry.`
        );
        return "failed";
    }

    /**
     * Attempts one claimed request and records its outcome.
     * @returns {Promise<"done"|"retrying"|"failed">}
     */
    async function processRequest(request) {
        const adapterIds = erasureAdapterIds(request.serviceId);
        if (adapterIds.length === 0) {
            return recordFailure(request, { code: "NO_ADAPTER", retryable: false });
        }

        if (!await registry.hasAiAdditionsConnection()) {
            return recordFailure(request, { code: "NOT_CONFIGURED", retryable: true });
        }

        let outcomes;
        try {
            outcomes = await registry.dispatchGlobalHook(
                USER_FORGOTTEN_HOOK,
                { userId: request.userId, erasureRequestId: request.id },
                { serviceIds: adapterIds }
            );
        } catch (error) {
            return recordFailure(request, classifyErasureError(error));
        }

        // Nothing was dispatched: the connection went away meanwhile.
        if (!Array.isArray(outcomes) || outcomes.length === 0) {
            return recordFailure(request, { code: "NOT_DISPATCHED", retryable: true });
        }

        const rejection = rejectionOf(outcomes);
        if (rejection) {
            return recordFailure(request, classifyErasureError(rejection.reason));
        }

        await store.markDone(request.id);
        logger.info(`[user-erasure] Erasure request ${request.id} (${request.serviceId}) done.`);
        return "done";
    }

    /**
     * Processes the due requests, of one user or of all, until none is due.
     * A failure to record an outcome is logged; the request's lease then
     * makes it due again later.
     * @returns {Promise<{ done: number, retrying: number, failed: number }>}
     */
    async function processDue({ userId = null } = {}) {
        if (!registry.initialized) {
            await registry.initialize();
        }

        const summary = { done: 0, retrying: 0, failed: 0 };

        for (;;) {
            const claimed = await store.claimDue({ limit: batchSize, leaseMs, userId });
            if (claimed.length === 0) {
                return summary;
            }

            for (const request of claimed) {
                try {
                    summary[await processRequest(request)] += 1;
                } catch (error) {
                    logger.error(
                        "[user-erasure] Could not record the outcome of erasure request "
                        + `${request.id}.`,
                        error?.message
                    );
                }
            }

            if (claimed.length < batchSize) {
                return summary;
            }
        }
    }

    function schedule(delayMs) {
        if (!running) {
            return;
        }
        timer = timers.setTimeout(tick, delayMs);
        timer?.unref?.();
    }

    async function tick() {
        timer = null;
        activeTick = processDue()
            .catch(error => logger.error(
                "[user-erasure] Processing erasure requests failed.", error?.message))
            .finally(() => {
                activeTick = null;
            });
        await activeTick;
        schedule(intervalMs);
    }

    // Starts the periodic processing. The first tick runs shortly after the
    // start, so requests recorded while ethicapp was stopped go out soon.
    function start({ firstDelayMs = FIRST_TICK_DELAY_MS } = {}) {
        if (running) {
            return;
        }
        running = true;
        schedule(firstDelayMs);
        const seconds = Math.round(intervalMs / 1000);
        logger.info(`[user-erasure] Processing erasure requests every ${seconds} s.`);
    }

    async function stop() {
        running = false;
        if (timer) {
            timers.clearTimeout(timer);
            timer = null;
        }
        await activeTick;
    }

    return { processDue, processRequest, start, stop };
}
