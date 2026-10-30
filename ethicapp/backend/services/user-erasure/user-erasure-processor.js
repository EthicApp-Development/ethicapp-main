import { userErasureRequestsStore } from "./user-erasure-requests.store.js";
import {
    createLeasedRequestProcessor,
    DEFAULT_INTERVAL_MS,
    DEFAULT_LEASE_MS,
    RETRY_BASE_DELAY_MS,
    RETRY_MAX_DELAY_MS,
    retryDelayMs,
} from "../leased-queue/leased-request-processor.js";

export { DEFAULT_INTERVAL_MS, RETRY_BASE_DELAY_MS, RETRY_MAX_DELAY_MS, retryDelayMs };

/**
 * Background processing of user erasure requests (#876, #877, epic #879).
 *
 * When the management console forgets a student or a teacher, it anonymizes
 * the account in EthicApp and records, in the same transaction, one pending
 * request per AI Additions service (user_erasure_requests, V31). The
 * scheduled anonymization job, which runs while ethicapp is stopped, records
 * them too. This processor, which runs inside the ethicapp web process
 * because it holds the AI Additions credentials and the adapter registry,
 * sends them, with the claim, lease and backoff of
 * createLeasedRequestProcessor:
 *
 * - it dispatches the `user-forgotten` global hook to the adapters that
 *   declare it and require the request's service, one service at a time;
 * - a confirmed erasure marks the request done. A failure a retry can fix
 *   (the service unreachable, a timeout, a 5xx, no AI Additions connection)
 *   is retried with backoff; it never gives up. A failure a retry cannot fix
 *   (a 400, no adapter for the service) marks it failed, for an
 *   administrator to retry by hand.
 */

export const USER_FORGOTTEN_HOOK = "user-forgotten";

// Longer than an attempt can take (two AI Additions calls of at most
// AI_ADDITIONS_HTTP_TIMEOUT_MS each, plus a token request).
export const CLAIM_LEASE_MS = DEFAULT_LEASE_MS;

// HTTP statuses that say the request itself is wrong: retrying the same
// request cannot succeed. Everything else is retried (404 too: an AI
// Additions release without the erasure endpoint may be upgraded later).
const PERMANENT_HTTP_STATUSES = new Set([400, 422]);

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

function failure(classification) {
    return { outcome: "error", ...classification };
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
    batchSize,
    leaseMs = CLAIM_LEASE_MS,
    timers = { setTimeout, clearTimeout },
} = {}) {
    // The adapters that erase a service's data: those that declare the hook
    // in `globalHooks` and require the service.
    function erasureAdapterIds(serviceId) {
        return registry.globalHookServiceIds(USER_FORGOTTEN_HOOK)
            .filter(adapterId => (registry.getServiceById(adapterId)?.requires ?? [])
                .includes(serviceId));
    }

    async function attempt(request) {
        const adapterIds = erasureAdapterIds(request.serviceId);
        if (adapterIds.length === 0) {
            return failure({ code: "NO_ADAPTER", retryable: false });
        }

        if (!await registry.hasAiAdditionsConnection()) {
            return failure({ code: "NOT_CONFIGURED", retryable: true });
        }

        let outcomes;
        try {
            outcomes = await registry.dispatchGlobalHook(
                USER_FORGOTTEN_HOOK,
                { userId: request.userId, erasureRequestId: request.id },
                { serviceIds: adapterIds }
            );
        } catch (error) {
            return failure(classifyErasureError(error));
        }

        // Nothing was dispatched: the connection went away meanwhile.
        if (!Array.isArray(outcomes) || outcomes.length === 0) {
            return failure({ code: "NOT_DISPATCHED", retryable: true });
        }

        const rejection = rejectionOf(outcomes);
        if (rejection) {
            return failure(classifyErasureError(rejection.reason));
        }

        return { outcome: "done" };
    }

    return createLeasedRequestProcessor({
        label:    "[user-erasure]",
        store,
        attempt,
        describe: request => `Erasure request ${request.id} (${request.serviceId})`,
        prepare:  async () => {
            if (!registry.initialized) {
                await registry.initialize();
            }
        },
        logger,
        intervalMs,
        batchSize,
        leaseMs,
        timers,
    });
}
