import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    FINISH_OPEN_SESSION_SQL,
    FINISH_SESSION_SQL,
    OPEN_SESSIONS_OF_CREATOR_SQL,
    SESSION_CURRENT_PHASE_SQL,
    createActivityFinisher,
} from "../activity-finish-helper.js";

const FINISHED = 3;

// A fake database holding sessions as { status, current_stage, creator }. It
// answers the helper's four statements and records every effect, database
// writes included, in one ordered log.
function fakeWorld(sessions = {}, { failOn = {} } = {}) {
    const effects = [];
    const rows = new Map(Object.entries(sessions).map(([id, row]) => [Number(id), { ...row }]));

    async function query(sql, params) {
        if (sql === SESSION_CURRENT_PHASE_SQL) {
            const row = rows.get(Number(params[0]));
            return { rows: row ? [{ current_stage: row.current_stage }] : [], rowCount: row ? 1 : 0 };
        }
        if (sql === FINISH_SESSION_SQL || sql === FINISH_OPEN_SESSION_SQL) {
            const [status, sessionId] = params;
            const row = rows.get(Number(sessionId));
            if (!row || (sql === FINISH_OPEN_SESSION_SQL && row.status === status)) {
                return { rows: [], rowCount: 0 };
            }
            row.status = status;
            row.current_stage = null;
            effects.push(["update", Number(sessionId), sql === FINISH_OPEN_SESSION_SQL ? "only-if-open" : "always"]);
            return { rows: [], rowCount: 1 };
        }
        if (sql === OPEN_SESSIONS_OF_CREATOR_SQL) {
            const [creator, finished] = params;
            const ids = [...rows.entries()]
                .filter(([, row]) => row.creator === creator && row.status !== finished)
                .map(([id]) => ({ id: String(id) }))
                .sort((left, right) => Number(left.id) - Number(right.id));
            return { rows: ids, rowCount: ids.length };
        }
        throw new Error(`unexpected SQL: ${sql}`);
    }

    function failIfAsked(step, sessionId) {
        if (failOn[step]?.includes(Number(sessionId))) {
            throw new Error(`${step} failed for ${sessionId}`);
        }
    }

    const errors = [];
    const dependencies = {
        query,
        invalidateStudentDescriptor: async (sessionId) => {
            failIfAsked("invalidate", sessionId);
            effects.push(["invalidate", sessionId]);
        },
        dispatchPhaseHook: async (hookName, context) => {
            failIfAsked("phaseHook", context.sessionId);
            effects.push(["phase-hook", hookName, context]);
        },
        notifyStudentsEnded: (sessionId) => {
            effects.push(["notify", sessionId]);
        },
        readEnabledServiceIds: async (sessionId) => {
            failIfAsked("readServices", sessionId);
            return [`service-of-${sessionId}`, "shared-service"];
        },
        dispatchRegistryHook: async (hookName, context, options) => {
            failIfAsked("registryHook", context.sessionId);
            effects.push(["registry-hook", hookName, context, options]);
        },
        logger: { error: (...args) => errors.push(args) },
    };

    return { rows, effects, errors, dependencies };
}

describe("finishActivity", () => {
    it("finishes the session, then invalidates, ends the phase, notifies and broadcasts, in that order", async () => {
        const world = fakeWorld({ 7: { status: 2, current_stage: 21, creator: 5 } });
        const finisher = createActivityFinisher(world.dependencies);

        const result = await finisher.finishActivity("7");

        assert.deepEqual(result, { status: "finished", sessionId: 7, previousPhaseId: 21 });
        assert.deepEqual(world.rows.get(7), { status: FINISHED, current_stage: null, creator: 5 });
        assert.deepEqual(world.effects, [
            ["update", 7, "always"],
            ["invalidate", "7"],
            ["phase-hook", "phase-ended", {
                sessionId: 7, phaseId: 21, startedPhaseId: null, endedPhaseId: 21,
            }],
            ["notify", "7"],
            ["registry-hook", "activity-finished", {
                sessionId: 7, phaseId: 21, startedPhaseId: null, endedPhaseId: 21,
            }, { enabledServiceIds: ["service-of-7", "shared-service"] }],
        ]);
        assert.deepEqual(world.errors, []);
    });

    it("skips phase-ended but still broadcasts activity-finished when there is no current phase", async () => {
        const world = fakeWorld({ 8: { status: 1, current_stage: null, creator: 5 } });
        const finisher = createActivityFinisher(world.dependencies);

        const result = await finisher.finishActivity(8);

        assert.deepEqual(result, { status: "finished", sessionId: 8, previousPhaseId: null });
        assert.deepEqual(world.effects.map(effect => effect[0]), [
            "update", "invalidate", "notify", "registry-hook",
        ]);
        assert.deepEqual(world.effects.at(-1)[2], {
            sessionId: 8, phaseId: null, startedPhaseId: null, endedPhaseId: null,
        });
    });

    it("finishes an already finished session again, as the teacher's route always did", async () => {
        const world = fakeWorld({ 9: { status: FINISHED, current_stage: null, creator: 5 } });
        const finisher = createActivityFinisher(world.dependencies);

        const result = await finisher.finishActivity(9);

        assert.equal(result.status, "finished");
        assert.equal(world.effects.filter(effect => effect[0] === "registry-hook").length, 1);
    });

    it("leaves a finished session alone with onlyIfOpen", async () => {
        const world = fakeWorld({ 9: { status: FINISHED, current_stage: null, creator: 5 } });
        const finisher = createActivityFinisher(world.dependencies);

        const result = await finisher.finishActivity(9, { onlyIfOpen: true });

        assert.deepEqual(result, { status: "not_updated", sessionId: 9 });
        assert.deepEqual(world.effects, []);
    });

    it("reports a missing session without any effect", async () => {
        const world = fakeWorld({});
        const finisher = createActivityFinisher(world.dependencies);

        assert.deepEqual(await finisher.finishActivity(404), { status: "not_found", sessionId: 404 });
        assert.deepEqual(world.effects, []);
    });

    it("still broadcasts activity-finished, with no services, when the design cannot be read", async () => {
        const world = fakeWorld({ 7: { status: 2, current_stage: 21, creator: 5 } }, {
            failOn: { readServices: [7] },
        });
        const finisher = createActivityFinisher(world.dependencies);

        const result = await finisher.finishActivity(7);

        assert.equal(result.status, "finished");
        assert.deepEqual(world.effects.at(-1)[3], { enabledServiceIds: [] });
        assert.equal(world.errors.length, 1);
    });

    it("never throws when the activity-finished dispatch fails", async () => {
        const world = fakeWorld({ 7: { status: 2, current_stage: 21, creator: 5 } }, {
            failOn: { registryHook: [7] },
        });
        const finisher = createActivityFinisher(world.dependencies);

        const result = await finisher.finishActivity(7);

        assert.equal(result.status, "finished");
        assert.equal(world.errors.length, 1);
        assert.match(String(world.errors[0][0]), /activity-finished/);
    });

    it("propagates a phase-ended failure after the session is finished, before notifying", async () => {
        const world = fakeWorld({ 7: { status: 2, current_stage: 21, creator: 5 } }, {
            failOn: { phaseHook: [7] },
        });
        const finisher = createActivityFinisher(world.dependencies);

        await assert.rejects(finisher.finishActivity(7), /phaseHook failed/);
        assert.deepEqual(world.effects.map(effect => effect[0]), ["update", "invalidate"]);
    });
});

describe("listOpenActivityIds", () => {
    it("lists the creator's sessions that are not finished, initiated ones included", async () => {
        const world = fakeWorld({
            3: { status: 2, current_stage: 1, creator: 5 },
            1: { status: 1, current_stage: null, creator: 5 },
            2: { status: FINISHED, current_stage: null, creator: 5 },
            4: { status: null, current_stage: null, creator: 5 },
            6: { status: 2, current_stage: 1, creator: 99 },
        });
        const finisher = createActivityFinisher(world.dependencies);

        assert.deepEqual(await finisher.listOpenActivityIds(5), [1, 3, 4]);
    });
});

describe("finishOpenActivitiesOf", () => {
    it("finishes every open session, one at a time, with all their effects", async () => {
        const world = fakeWorld({
            11: { status: 2, current_stage: 31, creator: 5 },
            12: { status: 1, current_stage: null, creator: 5 },
            13: { status: FINISHED, current_stage: null, creator: 5 },
            14: { status: 2, current_stage: 34, creator: 6 },
        });
        const finisher = createActivityFinisher(world.dependencies);

        const result = await finisher.finishOpenActivitiesOf(5);

        assert.deepEqual(result, { finished: [11, 12], skipped: [], failed: [] });
        assert.deepEqual(world.effects.map(effect => [effect[0], effect[1]]), [
            ["update", 11], ["invalidate", 11], ["phase-hook", "phase-ended"], ["notify", 11],
            ["registry-hook", "activity-finished"],
            ["update", 12], ["invalidate", 12], ["notify", 12], ["registry-hook", "activity-finished"],
        ]);
        assert.ok(world.effects
            .filter(effect => effect[0] === "update")
            .every(effect => effect[2] === "only-if-open"));
        assert.equal(world.rows.get(14).status, 2);
    });

    it("keeps going when one session fails, and reports it", async () => {
        const world = fakeWorld({
            11: { status: 2, current_stage: 31, creator: 5 },
            12: { status: 2, current_stage: 32, creator: 5 },
            13: { status: 1, current_stage: null, creator: 5 },
        }, { failOn: { invalidate: [12] } });
        const finisher = createActivityFinisher(world.dependencies);

        const result = await finisher.finishOpenActivitiesOf(5);

        assert.deepEqual(result, {
            finished: [11, 13],
            skipped:  [],
            failed:   [{ sessionId: 12, error: "finish_failed" }],
        });
        assert.deepEqual(world.effects.filter(effect => effect[0] === "notify"), [["notify", 11], ["notify", 13]]);
        assert.equal(world.errors.length, 1);
        assert.match(world.errors[0][0], /session 12 of user 5/);
    });

    it("skips a session finished between the listing and its update", async () => {
        const world = fakeWorld({
            11: { status: 2, current_stage: 31, creator: 5 },
            12: { status: 2, current_stage: 32, creator: 5 },
        });
        const finisher = createActivityFinisher({
            ...world.dependencies,
            // The teacher finishes 12 while 11 is being finished.
            notifyStudentsEnded: (sessionId) => {
                world.effects.push(["notify", sessionId]);
                if (sessionId === 11) {
                    world.rows.get(12).status = FINISHED;
                }
            },
        });

        const result = await finisher.finishOpenActivitiesOf(5);

        assert.deepEqual(result, { finished: [11], skipped: [12], failed: [] });
        assert.deepEqual(world.effects.filter(effect => effect[0] === "notify"), [["notify", 11]]);
    });

    it("is idempotent: a second call finds nothing to finish", async () => {
        const world = fakeWorld({
            11: { status: 2, current_stage: 31, creator: 5 },
            12: { status: 1, current_stage: null, creator: 5 },
        });
        const finisher = createActivityFinisher(world.dependencies);

        await finisher.finishOpenActivitiesOf(5);
        const effectsAfterFirstCall = world.effects.length;
        const second = await finisher.finishOpenActivitiesOf(5);

        assert.deepEqual(second, { finished: [], skipped: [], failed: [] });
        assert.equal(world.effects.length, effectsAfterFirstCall);
    });

    it("lets a failure of the listing itself propagate", async () => {
        const finisher = createActivityFinisher({
            query: async () => {
                throw new Error("database down");
            },
        });

        await assert.rejects(finisher.finishOpenActivitiesOf(5), /database down/);
    });
});
