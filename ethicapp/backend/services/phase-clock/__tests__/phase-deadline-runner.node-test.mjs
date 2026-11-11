// The phase deadline runner (#1113, epic #1105) with a fake store, a fake
// phase start and a fake notifier: what each outcome of a start by the
// deadline leads to, the per-phase backoff after a thrown error, the marking
// of unenforced deadlines, and the loop under Node's fake timers (start,
// interval, no overlapping ticks, the backoff of failed ticks, stop).
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import {
    createPhaseDeadlineRunner,
    DEFAULT_INTERVAL_MS,
    nextTickDelayMs,
    resolvePollIntervalMs,
    retryDelayMs,
    RETRY_BASE_DELAY_MS,
    RETRY_MAX_DELAY_MS,
    TICK_FAILURE_MAX_DELAY_MS,
} from "../phase-deadline-runner.js";

function deadline(sessionId, phaseNumber = 1) {
    return { sessionId, teacherId: sessionId + 1000, phaseId: sessionId * 10 + phaseNumber,
        phaseNumber };
}

function makeLogger() {
    const lines = { info: [], warn: [], error: [] };
    return {
        lines,
        info:  (...args) => lines.info.push(args.join(" ")),
        warn:  (...args) => lines.warn.push(args.join(" ")),
        error: (...args) => lines.error.push(args.join(" ")),
    };
}

/**
 * A runner whose store returns `due` (an array, or a function of the
 * selection's options) and whose start answers with `outcomeOf(request)`.
 */
function setup({
    due = [],
    outcomeOf = () => ({ status: "stale", currentPhaseNumber: 9 }),
    settled = 0,
    markHandled = async () => true,
    settleUnenforced,
    intervalMs,
    batchSize,
} = {}) {
    const calls = { list: [], starts: [], marks: [], settles: [], notices: [] };
    const logger = makeLogger();
    const store = {
        async listDueEnforced(options) {
            calls.list.push(options);
            return typeof due === "function" ? due(options) : due;
        },
        async settleUnenforced(options) {
            calls.settles.push(options);
            return settleUnenforced ? settleUnenforced(options) : settled;
        },
        async markHandled(phaseId) {
            calls.marks.push(phaseId);
            return markHandled(phaseId);
        },
    };
    const runner = createPhaseDeadlineRunner({
        store,
        startNextPhase: async (request) => {
            calls.starts.push(request);
            return outcomeOf(request);
        },
        notifier: {
            deadlineReached: (sessionId, payload) => calls.notices.push([sessionId, payload]),
        },
        logger,
        ...(intervalMs ? { intervalMs } : {}),
        ...(batchSize ? { batchSize } : {}),
    });
    return { runner, calls, logger };
}

describe("the poll interval", () => {
    it("is ETHICAPP_PHASE_CLOCK_POLL_INTERVAL_MS when it is a positive integer", () => {
        const logger = makeLogger();
        assert.equal(resolvePollIntervalMs("250", logger), 250);
        assert.equal(resolvePollIntervalMs(" 2000 ", logger), 2000);
        assert.deepEqual(logger.lines.warn, []);
    });

    it("is one second when unset, and with a warning when invalid", () => {
        const logger = makeLogger();
        assert.equal(DEFAULT_INTERVAL_MS, 1000);
        for (const unset of [undefined, null, "", "  "]) {
            assert.equal(resolvePollIntervalMs(unset, logger), 1000);
        }
        assert.deepEqual(logger.lines.warn, []);

        for (const invalid of ["0", "-5", "1.5", "abc", "1e3", "500ms"]) {
            assert.equal(resolvePollIntervalMs(invalid, logger), 1000, invalid);
        }
        assert.equal(logger.lines.warn.length, 6);
        assert.match(logger.lines.warn[0], /ETHICAPP_PHASE_CLOCK_POLL_INTERVAL_MS/);
    });
});

describe("the delays", () => {
    it("double for each failed start of a phase, up to five minutes", () => {
        assert.equal(retryDelayMs(1), RETRY_BASE_DELAY_MS);
        assert.equal(retryDelayMs(2), 2 * RETRY_BASE_DELAY_MS);
        assert.equal(retryDelayMs(3), 4 * RETRY_BASE_DELAY_MS);
        assert.equal(retryDelayMs(10), RETRY_MAX_DELAY_MS);
        assert.equal(retryDelayMs(1000), RETRY_MAX_DELAY_MS);
    });

    it("double for each failed tick in a row, up to a minute", () => {
        assert.equal(nextTickDelayMs(1000, 0), 1000);
        assert.equal(nextTickDelayMs(1000, 1), 2000);
        assert.equal(nextTickDelayMs(1000, 3), 8000);
        assert.equal(nextTickDelayMs(1000, 50), TICK_FAILURE_MAX_DELAY_MS);
        assert.equal(nextTickDelayMs(120000, 2), 120000, "never shorter than the interval");
    });
});

describe("a tick", () => {
    it("starts the next phase of each due deadline as the session's creator", async () => {
        const due = [deadline(1, 1), deadline(2, 3)];
        const { runner, calls } = setup({
            due,
            outcomeOf: ({ expectedPhaseNumber }) => ({
                status: "started",
                phase:  { id: 500 + expectedPhaseNumber, number: expectedPhaseNumber + 1 },
            }),
            settled:   2,
            batchSize: 20,
        });

        const result = await runner.processDue();

        assert.deepEqual(calls.list, [{ limit: 20, excludePhaseIds: [] }]);
        assert.deepEqual(calls.starts, [
            { sessionId: 1, teacherId: 1001, expectedPhaseNumber: 1, trigger: "deadline" },
            { sessionId: 2, teacherId: 1002, expectedPhaseNumber: 3, trigger: "deadline" },
        ]);
        assert.deepEqual(calls.marks, []);
        assert.deepEqual(calls.notices, [], "the start announces the new phase itself");
        assert.deepEqual(calls.settles, [{ limit: 20 }]);
        assert.deepEqual(result, { outcomes: { started: 2 }, settled: 2 });
    });

    it("notifies the teacher once when the last phase's deadline passes", async () => {
        const last = deadline(3, 4);
        const { runner, calls } = setup({
            due:       [last],
            outcomeOf: () => ({ status: "no_next_phase", currentPhaseNumber: 4 }),
        });

        await runner.processDue();

        assert.deepEqual(calls.notices, [[3, { phaseId: last.phaseId, isLastPhase: true }]]);
        assert.deepEqual(calls.marks, [], "the start already handled the deadline");
    });

    it("notifies again when the last phase's extended deadline passes", async () => {
        // "+1 min" (#1112) sets the deadline unhandled, so the store returns
        // the phase again; the runner keeps no memory of an earlier notice.
        const last = deadline(3, 4);
        const { runner, calls } = setup({
            due:       [last],
            outcomeOf: () => ({ status: "no_next_phase", currentPhaseNumber: 4 }),
        });

        await runner.processDue();
        await runner.processDue();

        assert.equal(calls.notices.length, 2);
    });

    it("does nothing more when the activity moved on or the deadline is not due", async () => {
        const { runner, calls, logger } = setup({
            due:       [deadline(1), deadline(2)],
            outcomeOf: ({ sessionId }) => (sessionId === 1
                ? { status: "stale", currentPhaseNumber: 2 }
                : { status: "not_due", currentPhaseNumber: 1 }),
        });

        const { outcomes } = await runner.processDue();

        assert.deepEqual(outcomes, { stale: 1, not_due: 1 });
        assert.deepEqual(calls.marks, []);
        assert.deepEqual(calls.notices, []);
        assert.deepEqual(logger.lines.error, []);
        assert.deepEqual(logger.lines.warn, []);
    });

    it("logs an invalid design or a session without an activity, which the start handled",
        async () => {
            const { runner, calls, logger } = setup({
                due:       [deadline(1), deadline(2)],
                outcomeOf: ({ sessionId }) => (sessionId === 1
                    ? { status: "invalid_design", problem: "Unsupported grouping algorithm: x" }
                    : { status: "not_launched" }),
            });

            await runner.processDue();

            assert.deepEqual(calls.marks, []);
            assert.deepEqual(calls.notices, []);
            assert.equal(logger.lines.error.length, 2);
            assert.match(logger.lines.error[0], /Session 1.*Unsupported grouping algorithm: x/);
            assert.match(logger.lines.error[1], /Session 2.*no launched activity/);
        });

    it("marks the deadline handled when the teacher cannot start phases, the activity is "
        + "finished or the session is gone", async () => {
        const due = [deadline(1), deadline(2), deadline(3)];
        const statuses = { 1: "forbidden", 2: "finished", 3: "not_found" };
        const { runner, calls, logger } = setup({
            due,
            outcomeOf:   ({ sessionId }) => ({ status: statuses[sessionId] }),
            markHandled: async phaseId => phaseId !== due[2].phaseId,
        });

        const { outcomes } = await runner.processDue();

        assert.deepEqual(outcomes, { forbidden: 1, finished: 1, not_found: 1 });
        assert.deepEqual(calls.marks, due.map(item => item.phaseId));
        assert.deepEqual(calls.notices, []);
        assert.equal(logger.lines.warn.length, 3);
        assert.match(logger.lines.warn[0], /cannot start phases; its deadline is marked handled/);
        assert.match(logger.lines.warn[1], /finished; its deadline is marked handled/);
        assert.match(logger.lines.warn[2], /not found; its deadline was already handled/);
    });

    it("logs an unexpected outcome", async () => {
        const { runner, logger } = setup({
            due:       [deadline(1)],
            outcomeOf: () => ({ status: "something_new" }),
        });

        await runner.processDue();

        assert.match(logger.lines.warn[0], /unexpected outcome something_new/);
    });

    it("goes on with the other deadlines when marking one handled fails", async () => {
        const { runner, calls, logger } = setup({
            due:       [deadline(1), deadline(2)],
            outcomeOf: ({ sessionId }) => (sessionId === 1
                ? { status: "finished" }
                : { status: "no_next_phase", currentPhaseNumber: 1 }),
            markHandled: async () => {
                throw new Error("connection reset");
            },
        });

        const { outcomes } = await runner.processDue();

        assert.deepEqual(outcomes, { error: 1, no_next_phase: 1 });
        assert.equal(calls.notices.length, 1);
        assert.match(logger.lines.error[0], /Session 1.*handling the outcome failed/);
    });

    it("marks the unenforced deadlines after the enforced ones, and survives its failure",
        async () => {
            const { runner, calls, logger } = setup({
                due:              [deadline(1)],
                outcomeOf:        () => ({ status: "stale", currentPhaseNumber: 2 }),
                settleUnenforced: async () => {
                    throw new Error("lock timeout");
                },
            });

            const result = await runner.processDue();

            assert.equal(calls.starts.length, 1);
            assert.equal(calls.settles.length, 1);
            assert.deepEqual(result, { outcomes: { stale: 1 }, settled: 0 });
            assert.match(logger.lines.error[0], /unenforced deadlines/);
        });
});

describe("the backoff after a start throws", () => {
    beforeEach(() => {
        mock.timers.enable({ apis: ["Date"], now: 0 });
    });
    afterEach(() => {
        mock.timers.reset();
    });

    it("leaves the phase out until its backoff ends, while the others go on", async () => {
        const failing = deadline(1);
        const healthy = deadline(2);
        let throws = true;
        const { runner, calls, logger } = setup({
            // The store leaves out the excluded phases, as its SQL does.
            due: ({ excludePhaseIds }) => [failing, healthy]
                .filter(item => !excludePhaseIds.includes(item.phaseId)),
            outcomeOf: ({ sessionId }) => {
                if (sessionId === 1 && throws) {
                    throw new Error("No earlier team phase to preserve groups from");
                }
                return { status: "started", phase: { id: 99, number: 2 } };
            },
        });

        const first = await runner.processDue();
        assert.deepEqual(first.outcomes, { error: 1, started: 1 });
        assert.match(logger.lines.error[0],
            /Session 1.*No earlier team phase.*retrying in 5 s/);

        // Within the five seconds the phase is left out.
        mock.timers.tick(RETRY_BASE_DELAY_MS - 1);
        await runner.processDue();
        assert.deepEqual(calls.list.at(-1).excludePhaseIds, [failing.phaseId]);
        assert.deepEqual(calls.starts.at(-1).sessionId, 2);

        // Then it is tried again; a second failure waits twice as long.
        mock.timers.tick(1);
        await runner.processDue();
        assert.deepEqual(calls.list.at(-1).excludePhaseIds, []);
        assert.match(logger.lines.error[1], /retrying in 10 s/);

        mock.timers.tick(2 * RETRY_BASE_DELAY_MS);
        throws = false;
        const recovered = await runner.processDue();
        assert.deepEqual(recovered.outcomes, { started: 2 });

        // The backoff is gone: a later failure starts again from 5 s.
        throws = true;
        await runner.processDue();
        assert.match(logger.lines.error.at(-1), /retrying in 5 s/);
    });

    it("forgets the backoff of a phase that is no longer due", async () => {
        const failing = deadline(1);
        let stillDue = true;
        const { runner, calls, logger } = setup({
            due:       () => (stillDue ? [failing] : []),
            outcomeOf: () => {
                throw new Error("boom");
            },
        });

        await runner.processDue();
        // The teacher moved on meanwhile.
        stillDue = false;
        mock.timers.tick(RETRY_BASE_DELAY_MS);
        await runner.processDue();
        stillDue = true;
        await runner.processDue();

        assert.deepEqual(calls.list.map(options => options.excludePhaseIds), [[], [], []]);
        assert.match(logger.lines.error.at(-1), /retrying in 5 s/, "it starts afresh");
    });
});

describe("the loop", () => {
    beforeEach(() => {
        mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
    });
    afterEach(() => {
        mock.timers.reset();
    });

    // Lets the promises of a tick settle; setImmediate is not faked.
    async function flush() {
        for (let i = 0; i < 20; i += 1) {
            await new Promise(resolve => setImmediate(resolve));
        }
    }

    it("ticks one interval after the start and then every interval until stopped", async () => {
        const { runner, calls, logger } = setup({ intervalMs: 1000 });

        runner.start();
        runner.start();
        assert.equal(logger.lines.info.length, 1, "a second start is a no-op");
        assert.match(logger.lines.info[0], /every 1000 ms/);

        mock.timers.tick(999);
        await flush();
        assert.equal(calls.list.length, 0);

        mock.timers.tick(1);
        await flush();
        assert.equal(calls.list.length, 1, "the first tick, overdue deadlines included");

        mock.timers.tick(1000);
        await flush();
        mock.timers.tick(1000);
        await flush();
        assert.equal(calls.list.length, 3);

        await runner.stop();
        mock.timers.tick(10000);
        await flush();
        assert.equal(calls.list.length, 3);
    });

    it("never overlaps ticks, and stop waits for the tick in progress", async () => {
        let release;
        const { runner, calls } = setup({
            intervalMs: 1000,
            due:        () => new Promise((resolve) => {
                release = () => resolve([deadline(1)]);
            }),
            outcomeOf: () => ({ status: "started", phase: { id: 5, number: 2 } }),
        });

        runner.start();
        mock.timers.tick(1000);
        await flush();
        assert.equal(calls.list.length, 1);

        // The slow tick holds the next one back.
        mock.timers.tick(5000);
        await flush();
        assert.equal(calls.list.length, 1);

        let stopped = false;
        const stopping = runner.stop().then(() => {
            stopped = true;
        });
        await flush();
        assert.equal(stopped, false);

        release();
        await stopping;
        assert.equal(calls.starts.length, 1, "the tick in progress finishes");
        mock.timers.tick(5000);
        await flush();
        assert.equal(calls.list.length, 1, "and no other follows");
    });

    it("waits longer after failed ticks, and returns to the interval after one succeeds",
        async () => {
            let failing = true;
            const { runner, calls, logger } = setup({
                intervalMs: 1000,
                due:        () => {
                    if (failing) {
                        throw new Error("database unavailable");
                    }
                    return [];
                },
            });
            const ticksAt = [];
            const at = async (ms) => {
                mock.timers.tick(ms);
                await flush();
                ticksAt.push(calls.list.length);
            };

            runner.start();
            await at(1000); // tick 1 fails: next in 2 s
            await at(1999);
            await at(1); // tick 2 fails: next in 4 s
            await at(3999);
            failing = false;
            await at(1); // tick 3 succeeds: next in 1 s
            await at(1000); // tick 4

            assert.deepEqual(ticksAt, [1, 1, 2, 2, 3, 4]);
            assert.equal(logger.lines.error.length, 2);
            assert.match(logger.lines.error[0], /Checking the phase deadlines failed/);
            await runner.stop();
        });

    it("acts on overdue deadlines in its first tick, with the outcomes above", async () => {
        const { runner, calls } = setup({
            intervalMs: 1000,
            due:        [deadline(1, 2), deadline(2, 5)],
            outcomeOf:  ({ sessionId }) => (sessionId === 1
                ? { status: "started", phase: { id: 7, number: 3 } }
                : { status: "no_next_phase", currentPhaseNumber: 5 }),
        });

        runner.start();
        mock.timers.tick(1000);
        await flush();
        await runner.stop();

        assert.equal(calls.starts.length, 2);
        assert.deepEqual(calls.notices, [[2, { phaseId: 25, isLastPhase: true }]]);
        assert.equal(calls.settles.length, 1);
    });
});
