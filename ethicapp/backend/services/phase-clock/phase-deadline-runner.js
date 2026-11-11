/**
 * The phase deadline runner (epic #1105, #1113): advances hard-mode
 * activities when the current phase's deadline passes.
 *
 * Every `intervalMs` (ETHICAPP_PHASE_CLOCK_POLL_INTERVAL_MS, one second by
 * default) a tick:
 *
 * 1. reads up to `batchSize` enforced due deadlines (phase-deadline-store.js:
 *    the current phase of a hard-mode activity in progress, past its
 *    `ends_at` and not handled), earliest first, and for each one starts the
 *    next phase on behalf of the session's creator, with the phase number it
 *    read as `expectedPhaseNumber` and `trigger: "deadline"`
 *    (helpers/phase-start-helper.js). The start claims the deadline under the
 *    session's lock, so however many starts race (the teacher's click, a
 *    second runner) the phase advances once;
 * 2. marks up to `batchSize` unenforced due deadlines handled (soft mode,
 *    finished activities, no time mode), with no phase start and no event.
 *
 * What each start's outcome leads to:
 *
 * - `started`: nothing more; the start's own announce tells the students and
 *   the teacher (`onPhaseTransition` and `onPhaseClock`, reason "deadline");
 * - `no_next_phase`: the last phase. The start handled the deadline without
 *   finishing the activity, and the teacher gets `onPhaseDeadlineReached`
 *   with `isLastPhase: true`. Only the start that claimed the deadline gets
 *   this outcome, so the notice goes out once per deadline; a "+1 min"
 *   (#1112) sets the deadline unhandled again, and the new one gets its own;
 * - `stale`, `not_due`: the activity moved on, or the deadline moved later or
 *   was handled meanwhile. Nothing to do;
 * - `invalid_design`, `not_launched`: the start handled the deadline, which
 *   no retry can change. Logged;
 * - `forbidden` (the teacher's account is anonymized), `finished`,
 *   `not_found`: the start wrote nothing; the deadline is marked handled
 *   here, and the outcome logged;
 * - a thrown error (for example a `preserve` grouping without an earlier
 *   team phase, helpers/groups-helper.js): the start rolled back, and the
 *   phase is retried after a backoff of its own,
 *   min(RETRY_BASE_DELAY_MS * 2^(failures - 1), RETRY_MAX_DELAY_MS), while
 *   the other activities go on every tick.
 *
 * The state that matters lives in the database: a restart loses only the
 * backoffs, and the first tick after a start takes every overdue deadline.
 * Ticks never overlap. The runner runs in the web process only
 * (the `ethicapp` entry point), because the start's events go out through
 * that process's Socket.IO namespaces, which have no Redis adapter.
 */

export const DEFAULT_INTERVAL_MS = 1000;
export const DEFAULT_BATCH_SIZE = 20;
export const RETRY_BASE_DELAY_MS = 5 * 1000;
export const RETRY_MAX_DELAY_MS = 5 * 60 * 1000;
// A tick that fails as a whole (the database unreachable) waits longer each
// time, up to this, so an outage does not log every second.
export const TICK_FAILURE_MAX_DELAY_MS = 60 * 1000;

const LABEL = "[phase-clock]";

/**
 * The poll interval from ETHICAPP_PHASE_CLOCK_POLL_INTERVAL_MS: a positive
 * integer of milliseconds. Unset or empty gives the default; anything else
 * gives the default with a warning.
 * @param {string|undefined} value
 * @param {{ warn: Function }} [logger]
 * @returns {number}
 */
export function resolvePollIntervalMs(value, logger = console) {
    if (value === undefined || value === null || String(value).trim() === "") {
        return DEFAULT_INTERVAL_MS;
    }
    const text = String(value).trim();
    const configured = Number(text);
    if (/^\d+$/.test(text) && Number.isSafeInteger(configured) && configured > 0) {
        return configured;
    }
    logger.warn(`${LABEL} ETHICAPP_PHASE_CLOCK_POLL_INTERVAL_MS is not a positive integer; `
        + `using ${DEFAULT_INTERVAL_MS} ms.`);
    return DEFAULT_INTERVAL_MS;
}

/**
 * The delay before retrying a phase whose start threw `failures` times.
 * @param {number} failures - At least 1.
 * @returns {number} Milliseconds.
 */
export function retryDelayMs(failures) {
    const exponent = Math.max(0, Math.min(Number(failures) - 1, 30));
    return Math.min(RETRY_BASE_DELAY_MS * 2 ** exponent, RETRY_MAX_DELAY_MS);
}

/**
 * The delay before the next tick, after `failedTicks` ticks in a row failed.
 * @param {number} intervalMs
 * @param {number} failedTicks
 */
export function nextTickDelayMs(intervalMs, failedTicks) {
    if (failedTicks <= 0) {
        return intervalMs;
    }
    const exponent = Math.min(failedTicks, 30);
    return Math.max(intervalMs, Math.min(intervalMs * 2 ** exponent, TICK_FAILURE_MAX_DELAY_MS));
}

/**
 * @param {Object} options
 * @param {{ listDueEnforced: Function, settleUnenforced: Function,
 *     markHandled: Function }} options.store - phase-deadline-store.js.
 * @param {(request: { sessionId: number, teacherId: number,
 *     expectedPhaseNumber: number, trigger: "deadline" }) => Promise<Object>}
 *     options.startNextPhase - helpers/phase-start-helper.js.
 * @param {{ deadlineReached: Function }} options.notifier -
 *     helpers/phase-clock-notifier.js.
 * @param {{ info: Function, warn: Function, error: Function }} [options.logger]
 * @param {number} [options.intervalMs]
 * @param {number} [options.batchSize]
 * @param {{ setTimeout: Function, clearTimeout: Function }} [options.timers]
 * @param {() => number} [options.now] Milliseconds, for the backoffs.
 */
export function createPhaseDeadlineRunner({
    store,
    startNextPhase,
    notifier,
    logger = console,
    intervalMs = DEFAULT_INTERVAL_MS,
    batchSize = DEFAULT_BATCH_SIZE,
    timers = {
        setTimeout:   (callback, delayMs) => setTimeout(callback, delayMs),
        clearTimeout: handle => clearTimeout(handle),
    },
    now = () => Date.now(),
}) {
    // Phase id -> { failures, retryAt }, for the phases whose start threw.
    const backoffs = new Map();
    let timer = null;
    let running = false;
    let activeTick = null;
    let failedTicks = 0;

    const describe = ({ sessionId, phaseId, phaseNumber }) =>
        `Session ${sessionId}, phase ${phaseNumber} (id ${phaseId})`;

    async function giveUp(deadline, reason) {
        const marked = await store.markHandled(deadline.phaseId);
        logger.warn(`${LABEL} ${describe(deadline)}: ${reason}; `
            + (marked ? "its deadline is marked handled." : "its deadline was already handled."));
    }

    /**
     * Starts the next phase for one due deadline and acts on the outcome.
     * @returns {Promise<string>} The outcome's status.
     */
    async function handleOutcome(deadline, result) {
        const status = result?.status;
        switch (status) {
        case "started":
            logger.info(`${LABEL} ${describe(deadline)}: its deadline started phase `
                + `${result.phase.number} (id ${result.phase.id}).`);
            break;
        case "no_next_phase":
            notifier.deadlineReached(deadline.sessionId,
                { phaseId: deadline.phaseId, isLastPhase: true });
            logger.info(`${LABEL} ${describe(deadline)}: the last phase's deadline passed; `
                + "the teacher was notified.");
            break;
        case "stale":
        case "not_due":
            break;
        case "invalid_design":
            logger.error(`${LABEL} ${describe(deadline)}: the next phase cannot start `
                + `(${result.problem}); its deadline is handled.`);
            break;
        case "not_launched":
            logger.error(`${LABEL} ${describe(deadline)}: the session has no launched `
                + "activity; its deadline is handled.");
            break;
        case "forbidden":
            await giveUp(deadline, "the session's teacher cannot start phases");
            break;
        case "finished":
            await giveUp(deadline, "the activity is finished");
            break;
        case "not_found":
            await giveUp(deadline, "the session was not found");
            break;
        default:
            logger.warn(`${LABEL} ${describe(deadline)}: unexpected outcome ${status}.`);
        }
        return status;
    }

    function recordFailure(deadline, error) {
        const failures = (backoffs.get(deadline.phaseId)?.failures ?? 0) + 1;
        const delayMs = retryDelayMs(failures);
        backoffs.set(deadline.phaseId, { failures, retryAt: now() + delayMs });
        logger.error(`${LABEL} ${describe(deadline)}: starting the next phase failed `
            + `(${error?.message}); retrying in ${Math.round(delayMs / 1000)} s.`);
    }

    async function processDeadline(deadline) {
        let result;
        try {
            result = await startNextPhase({
                sessionId:           deadline.sessionId,
                teacherId:           deadline.teacherId,
                expectedPhaseNumber: deadline.phaseNumber,
                trigger:             "deadline",
            });
        } catch (error) {
            recordFailure(deadline, error);
            return "error";
        }
        backoffs.delete(deadline.phaseId);
        return handleOutcome(deadline, result);
    }

    // The phases still backing off, and forgets the backoffs that ended.
    // A phase whose backoff ended is due again only while it is selected;
    // one the teacher moved past is never selected again.
    function backingOff() {
        const at = now();
        const excluded = [];
        for (const [phaseId, backoff] of backoffs) {
            if (backoff.retryAt > at) {
                excluded.push(phaseId);
            }
        }
        return excluded;
    }

    function forgetEndedBackoffs(selected, excluded) {
        const keep = new Set([...excluded, ...selected.map(deadline => deadline.phaseId)]);
        for (const phaseId of backoffs.keys()) {
            if (!keep.has(phaseId)) {
                backoffs.delete(phaseId);
            }
        }
    }

    /**
     * One tick: the enforced due deadlines, then the unenforced ones.
     * @returns {Promise<{ outcomes: Object<string, number>, settled: number }>}
     */
    async function processDue() {
        const excludePhaseIds = backingOff();
        const due = await store.listDueEnforced({ limit: batchSize, excludePhaseIds });
        if (due.length < batchSize) {
            forgetEndedBackoffs(due, excludePhaseIds);
        }

        const outcomes = {};
        for (const deadline of due) {
            let status;
            try {
                status = await processDeadline(deadline);
            } catch (error) {
                // Acting on an outcome failed (marking a deadline handled);
                // the deadline is still due, and the next tick tries again.
                logger.error(`${LABEL} ${describe(deadline)}: handling the outcome failed.`,
                    error?.message);
                status = "error";
            }
            outcomes[status] = (outcomes[status] ?? 0) + 1;
        }

        // Housekeeping only: a failure is logged and never delays the
        // enforced deadlines of the next tick.
        let settled = 0;
        try {
            settled = await store.settleUnenforced({ limit: batchSize });
        } catch (error) {
            logger.error(`${LABEL} Marking the unenforced deadlines handled failed.`,
                error?.message);
        }
        return { outcomes, settled };
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
            .then(() => {
                failedTicks = 0;
            })
            .catch((error) => {
                failedTicks += 1;
                logger.error(`${LABEL} Checking the phase deadlines failed.`, error?.message);
            })
            .finally(() => {
                activeTick = null;
            });
        await activeTick;
        schedule(nextTickDelayMs(intervalMs, failedTicks));
    }

    // Starts the periodic checks. The first tick comes one interval after the
    // start, and takes every deadline that passed while ethicapp was stopped.
    function start({ firstDelayMs = intervalMs } = {}) {
        if (running) {
            return;
        }
        running = true;
        schedule(firstDelayMs);
        logger.info(`${LABEL} Checking the phase deadlines every ${intervalMs} ms.`);
    }

    // Stops scheduling ticks and waits for the one in progress, if any.
    async function stop() {
        running = false;
        if (timer) {
            timers.clearTimeout(timer);
            timer = null;
        }
        await activeTick;
    }

    return { processDue, start, stop };
}
