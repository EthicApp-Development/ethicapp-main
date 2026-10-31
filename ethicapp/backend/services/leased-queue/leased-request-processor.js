/**
 * Background processing of a table of leased requests (#876, #877): the AI
 * Additions erasure requests and the deletion of upload files that
 * forgetting an account leaves for ethicapp.
 *
 * - Every `intervalMs` it claims the due pending requests (a lease, so
 *   concurrent ethicapp processes never attempt the same request at once)
 *   and attempts them one at a time.
 * - `attempt(request)` resolves to the outcome: `{ outcome: "done" }`, a
 *   completed request that needed nothing (`{ outcome: "skipped", code }`,
 *   when the store supports it), or an error,
 *   `{ outcome: "error", code, retryable }`. A retryable error schedules the
 *   next attempt with an exponential backoff,
 *   min(RETRY_BASE_DELAY_MS * 2^(attempts - 1), RETRY_MAX_DELAY_MS); such a
 *   request stays pending and never gives up. Any other error marks it
 *   failed, for an administrator to retry by hand.
 * - The state lives in the database only, so processing survives restarts:
 *   the first tick after a start takes every due request, and a request whose
 *   attempt was cut short by a crash is due again once its lease ends.
 */

export const DEFAULT_INTERVAL_MS = 30 * 1000;
export const RETRY_BASE_DELAY_MS = 60 * 1000;
export const RETRY_MAX_DELAY_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_LEASE_MS = 5 * 60 * 1000;
const DEFAULT_BATCH_SIZE = 10;
const FIRST_TICK_DELAY_MS = 5 * 1000;

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
 * @param {Object} options
 * @param {string} options.label - Log prefix, for example "[user-erasure]".
 * @param {Object} options.store - A LeasedRequestStore: claimDue, markDone,
 *     markRetry, markFailed, and markCompleted for skipped requests.
 * @param {(request: object) => Promise<object>} options.attempt
 * @param {(request: object) => string} [options.describe] - How a request
 *     is named in the log: ids and codes only, never personal data.
 * @param {() => Promise<void>} [options.prepare] - Runs before each
 *     processing, for example to initialize a registry.
 * @param {string[]} [options.summaryKeys] - The outcomes processDue counts.
 */
export function createLeasedRequestProcessor({
    label,
    store,
    attempt,
    describe = request => `Request ${request.id}`,
    prepare = async () => {},
    summaryKeys = ["done", "retrying", "failed"],
    logger = console,
    intervalMs = DEFAULT_INTERVAL_MS,
    batchSize = DEFAULT_BATCH_SIZE,
    leaseMs = DEFAULT_LEASE_MS,
    timers = { setTimeout, clearTimeout },
}) {
    let timer = null;
    let running = false;
    let activeTick = null;

    async function recordFailure(request, { code, retryable }) {
        const name = `${label} ${describe(request)}`;
        if (retryable) {
            const delayMs = retryDelayMs(request.attempts + 1);
            await store.markRetry(request.id, code, delayMs);
            const seconds = Math.round(delayMs / 1000);
            logger.warn(`${name} failed with ${code}; retrying in ${seconds} s.`);
            return "retrying";
        }

        await store.markFailed(request.id, code);
        logger.error(`${name} failed with ${code}; it needs an administrator's retry.`);
        return "failed";
    }

    /**
     * Attempts one claimed request and records its outcome.
     * @returns {Promise<"done"|"skipped"|"retrying"|"failed">}
     */
    async function processRequest(request) {
        const result = await attempt(request);

        if (result?.outcome === "done") {
            await store.markDone(request.id);
            logger.info(`${label} ${describe(request)} done.`);
            return "done";
        }

        if (result?.outcome === "skipped") {
            await store.markCompleted(request.id, "skipped", result.code);
            logger.info(`${label} ${describe(request)} skipped: ${result.code}.`);
            return "skipped";
        }

        return recordFailure(request, {
            code:      result?.code || "UNKNOWN_ERROR",
            retryable: result?.retryable !== false,
        });
    }

    /**
     * Processes the due requests, of one user or of all, until none is due.
     * A failure to record an outcome is logged; the request's lease then
     * makes it due again later.
     * @returns {Promise<Object<string, number>>} Counts by outcome.
     */
    async function processDue({ userId = null } = {}) {
        await prepare();

        const summary = Object.fromEntries(summaryKeys.map(key => [key, 0]));

        for (;;) {
            const claimed = await store.claimDue({ limit: batchSize, leaseMs, userId });
            if (claimed.length === 0) {
                return summary;
            }

            for (const request of claimed) {
                try {
                    const outcome = await processRequest(request);
                    summary[outcome] = (summary[outcome] ?? 0) + 1;
                } catch (error) {
                    logger.error(
                        `${label} Could not record the outcome of ${describe(request)}.`,
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
            .catch(error => logger.error(`${label} Processing requests failed.`, error?.message))
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
        logger.info(`${label} Processing requests every ${Math.round(intervalMs / 1000)} s.`);
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
