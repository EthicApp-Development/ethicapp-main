// Integration test for finishing a teacher's open activities (#881), against a
// real PostgreSQL database with migrations applied: the selection of the
// teacher's unfinished sessions (initiated, in progress, and a NULL status),
// the guarded update, and the pending finalization (V30) that lets a retry
// finish a session whose steps failed after its update. Hooks, notifications
// and the descriptor cache are fakes here; they are covered by
// activity-finish-helper.node-test.mjs.
//
// Run with `npm run test:integration`, setting ETHICAPP_INTEGRATION_DATABASE_URL
// to a disposable database. The test inserts users and sessions, and does not
// remove them.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";

import { createActivityFinisher } from "../activity-finish-helper.js";

const DATABASE_URL = process.env.ETHICAPP_INTEGRATION_DATABASE_URL;
const SKIP_REASON = DATABASE_URL
    ? false
    : "ETHICAPP_INTEGRATION_DATABASE_URL is not set; integration tests skipped.";

if (SKIP_REASON) {
    console.warn(SKIP_REASON);
}

let pool = null;

function getPool() {
    pool ??= new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
    return pool;
}

async function query(sql, params = []) {
    return (await getPool().query(sql, params)).rows;
}

async function createTeacher() {
    const suffix = randomUUID();
    const [user] = await query(`
        INSERT INTO users (name, rut, mail, role)
        VALUES ('Integration teacher', $1, $2, 'P')
        RETURNING id;
    `, [suffix, `${suffix}@integration.test`]);
    return user.id;
}

async function createSession(creator, status, { withPhase = false } = {}) {
    const [session] = await query(`
        INSERT INTO sessions (name, descr, creator, time, status, type)
        VALUES ('Integration session', '', $1, now(), $2, 'R')
        RETURNING id;
    `, [creator, status]);
    if (withPhase) {
        const [phase] = await query(`
            INSERT INTO stages (number, type, sesid)
            VALUES (1, 'individual', $1)
            RETURNING id;
        `, [session.id]);
        await query("UPDATE sessions SET current_stage = $1 WHERE id = $2;", [phase.id, session.id]);
        return { id: session.id, phaseId: phase.id };
    }
    return { id: session.id, phaseId: null };
}

async function sessionState(id) {
    const [row] = await query("SELECT status, current_stage FROM sessions WHERE id = $1;", [id]);
    return row;
}

async function pendingFinalization(id) {
    const [row] = await query("SELECT ended_phase_id FROM activity_finalizations WHERE session_id = $1;", [id]);
    return row ?? null;
}

function finisherWithFakes({ failingInvalidation = [] } = {}) {
    const effects = [];
    const finisher = createActivityFinisher({
        query:                       (sql, params) => getPool().query(sql, params),
        invalidateStudentDescriptor: async (sessionId) => {
            if (failingInvalidation.includes(Number(sessionId))) {
                throw new Error("cache down");
            }
            effects.push(["invalidate", sessionId]);
        },
        dispatchPhaseHook:           async (hookName, context) => effects.push([hookName, context.sessionId, context.endedPhaseId]),
        notifyStudentsEnded:         sessionId => effects.push(["notify", sessionId]),
        readEnabledServiceIds:       async () => [],
        dispatchRegistryHook:        async (hookName, context) => effects.push([hookName, context.sessionId]),
        logger:                      { error: () => {} },
    });
    return { finisher, effects };
}

test.after(async () => {
    await pool?.end();
});

test("a teacher's open activities are listed, finished once, and nothing is left", {
    skip: SKIP_REASON,
}, async () => {
    const teacher = await createTeacher();
    const otherTeacher = await createTeacher();
    const inProgress = await createSession(teacher, 2, { withPhase: true });
    const initiated = await createSession(teacher, 1);
    const withoutStatus = await createSession(teacher, null);
    const finished = await createSession(teacher, 3);
    const othersActivity = await createSession(otherTeacher, 2, { withPhase: true });
    const { finisher, effects } = finisherWithFakes();

    const open = await finisher.listOpenActivityIds(teacher);
    assert.deepEqual(open, [inProgress.id, initiated.id, withoutStatus.id]);

    const result = await finisher.finishOpenActivitiesOf(teacher);
    assert.deepEqual(result, {
        finished: [inProgress.id, initiated.id, withoutStatus.id],
        skipped:  [],
        failed:   [],
    });

    for (const session of [inProgress, initiated, withoutStatus, finished]) {
        assert.deepEqual(await sessionState(session.id), { status: 3, current_stage: null });
        assert.equal(await pendingFinalization(session.id), null);
    }
    assert.deepEqual(await sessionState(othersActivity.id), { status: 2, current_stage: othersActivity.phaseId });

    // phase-ended only for the session that was on a phase.
    assert.deepEqual(
        effects.filter(effect => effect[0] === "phase-ended"),
        [["phase-ended", inProgress.id, inProgress.phaseId]],
    );
    assert.deepEqual(
        effects.filter(effect => effect[0] === "activity-finished").map(effect => effect[1]),
        [inProgress.id, initiated.id, withoutStatus.id],
    );

    const effectCount = effects.length;
    assert.deepEqual(await finisher.listOpenActivityIds(teacher), []);
    assert.deepEqual(await finisher.finishOpenActivitiesOf(teacher), { finished: [], skipped: [], failed: [] });
    assert.equal(effects.length, effectCount);
});

test("the guarded update leaves a finished session alone; the teacher's route finishes it again", {
    skip: SKIP_REASON,
}, async () => {
    const teacher = await createTeacher();
    const finished = await createSession(teacher, 3);
    const { finisher, effects } = finisherWithFakes();

    assert.deepEqual(
        await finisher.finishActivity(finished.id, { onlyIfOpen: true }),
        { status: "not_updated", sessionId: finished.id },
    );
    assert.deepEqual(effects, []);

    assert.deepEqual(
        await finisher.finishActivity(String(finished.id)),
        { status: "finished", sessionId: finished.id, previousPhaseId: null },
    );
    assert.deepEqual(await finisher.finishActivity(2147483000), { status: "not_found", sessionId: 2147483000 });
});

test("a session whose steps failed after its update stays pending, and a retry finishes it", {
    skip: SKIP_REASON,
}, async () => {
    const teacher = await createTeacher();
    const inProgress = await createSession(teacher, 2, { withPhase: true });
    const broken = finisherWithFakes({ failingInvalidation: [inProgress.id] });

    const first = await broken.finisher.finishOpenActivitiesOf(teacher);
    assert.deepEqual(first, { finished: [], skipped: [], failed: [{ sessionId: inProgress.id, error: "finish_failed" }] });
    assert.deepEqual(await sessionState(inProgress.id), { status: 3, current_stage: null });
    assert.deepEqual(await pendingFinalization(inProgress.id), { ended_phase_id: inProgress.phaseId });
    assert.deepEqual(broken.effects, []);
    assert.deepEqual(await broken.finisher.listOpenActivityIds(teacher), [inProgress.id]);

    const { finisher, effects } = finisherWithFakes();
    const retry = await finisher.finishOpenActivitiesOf(teacher);
    assert.deepEqual(retry, { finished: [inProgress.id], skipped: [], failed: [] });
    assert.deepEqual(effects, [
        ["invalidate", inProgress.id],
        ["phase-ended", inProgress.id, inProgress.phaseId],
        ["notify", inProgress.id],
        ["activity-finished", inProgress.id],
    ]);
    assert.equal(await pendingFinalization(inProgress.id), null);
    assert.deepEqual(await finisher.finishOpenActivitiesOf(teacher), { finished: [], skipped: [], failed: [] });
});

test("the teacher's route resumes a pending finalization with the phase it recorded", {
    skip: SKIP_REASON,
}, async () => {
    const teacher = await createTeacher();
    const inProgress = await createSession(teacher, 2, { withPhase: true });
    const broken = finisherWithFakes({ failingInvalidation: [inProgress.id] });
    await assert.rejects(broken.finisher.finishActivity(String(inProgress.id)), /cache down/);

    const { finisher, effects } = finisherWithFakes();
    assert.deepEqual(
        await finisher.finishActivity(String(inProgress.id)),
        { status: "finished", sessionId: inProgress.id, previousPhaseId: inProgress.phaseId },
    );
    assert.deepEqual(effects.find(effect => effect[0] === "phase-ended"), ["phase-ended", inProgress.id, inProgress.phaseId]);
    assert.equal(await pendingFinalization(inProgress.id), null);
});
