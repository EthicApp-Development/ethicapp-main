// Integration tests for GET /activities/:id/users/:user_id/external_service_results
// (#1127, epic #1123), against a real PostgreSQL database with migrations
// applied: the route's access check, the registry's choice of services (the
// session's design and its pinned AI service policy), the reader bound to
// one student and the session's phases all run their real SQL. Only the
// adapter is a stub: a `student-results-reading` handler for a test service
// that rebuilds one entry per stored result its reader returns.
//
// The refusals are compared with full_state's, which the route must match.
//
// Run with `npm run test:integration`, setting ETHICAPP_INTEGRATION_DATABASE_URL
// to a disposable database. The test inserts users, a policy version, designs,
// sessions, phases, jobs and results, and does not remove them.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import pg from "pg";

import { requestStudentResults } from "./student-results-request.mjs";

const DATABASE_URL = process.env.ETHICAPP_INTEGRATION_DATABASE_URL;
const SKIP_REASON = DATABASE_URL
    ? false
    : "ETHICAPP_INTEGRATION_DATABASE_URL is not set; integration tests skipped.";

if (SKIP_REASON) {
    console.warn(SKIP_REASON);
}

const SERVICE_ID = "integration-results-service";
const NO_RESULTS_SERVICE_ID = "integration-unused-service";

let pool = null;
const query = async (sql, params = []) => (await pool.query(sql, params)).rows;

// Loaded in before(): the application's database settings are read when its
// modules are imported, so DATABASE_URL must be set first.
let app = null;

async function loadApplication() {
    process.env.DATABASE_URL = DATABASE_URL;
    pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });

    const [
        { createStudentExternalResultsRouter },
        { default: activitiesStudentRouter },
        { ExternalServicesRegistry },
        { ExternalServiceReportResultsService },
        { STUDENT_RESULTS_READING_HOOK },
        { createAiServicePolicyStore },
        { default: redisClient },
        config,
        rpg2,
    ] = await Promise.all([
        import("../student-external-results.js"),
        import("../activities-student.js"),
        import("../../../services/external-services.service.js"),
        import("../../../services/external-service-report-results.service.js"),
        import("../../../external-services/catalog.js"),
        import("../../../helpers/ai-service-policy.js"),
        import("../../../db/redis.js"),
        import("../../../config/database.config.js"),
        import("../../../db/rest-pg-2.js"),
    ]);
    // full_state's caches are never reached by the refusals compared here.
    redisClient.disconnect();

    const noJobs = new Proxy({}, {
        get: (target, name) => async () => assert.fail(`no job is written (${String(name)})`),
    });
    const registry = new ExternalServicesRegistry({
        jobsService:             noJobs,
        reportResultsStore:      new ExternalServiceReportResultsService({ dbQuery: query }),
        aiServicePolicy:         createAiServicePolicyStore({ getDb: async () => pool }),
        isAiAdditionsConfigured: async () => assert.fail("the connection is not read"),
        developmentAdapters:     false,
    });
    registry.initialized = true;
    for (const id of [SERVICE_ID, NO_RESULTS_SERVICE_ID]) {
        registry.services.set(id, {
            id,
            development: false,
            requires:    ["argumentation-tutor"],
            hooks:       [STUDENT_RESULTS_READING_HOOK],
            globalHooks: [],
            scopes:      ["response"],
            report:      null,
        });
    }

    // An adapter rebuilding what it published: one entry per stored result.
    // A result stored without a phase takes the one its payload names, as an
    // adapter reading its callback could.
    registry.subscribe(SERVICE_ID, STUDENT_RESULTS_READING_HOOK, async (context, { results }) =>
        (await results.list()).map(result => ({
            resultId:    result.id,
            phaseId:     result.phaseId ?? result.rawPayload.phaseId,
            questionId:  result.questionId,
            component:   { componentId: "integration-component" },
            payload:     { text: result.rawPayload.text },
            message:     null,
            status:      "completed",
            publishedAt: result.receivedAt,
        })));
    registry.subscribe(NO_RESULTS_SERVICE_ID, STUDENT_RESULTS_READING_HOOK, async () => []);

    return {
        resultsRouter:   createStudentExternalResultsRouter({ registry }),
        fullStateRouter: activitiesStudentRouter,
        async close() {
            await (await rpg2.getDBInstance(config.dbconnString)).end();
            await pool.end();
        },
    };
}

async function createUser(role) {
    const [user] = await query(`
        INSERT INTO users (name, mail, role)
        VALUES ('Integration user', $1, $2)
        RETURNING id;
    `, [`${randomUUID()}@integration.test`, role]);
    return { uid: user.id, role };
}

// A launched activity whose first phase enables `serviceIds`, pinned to a
// policy version that allows the test services' AI service, with
// `startedPhases` of its three phases started.
async function createActivity(teacher, students, {
    serviceIds = [SERVICE_ID],
    startedPhases = 2,
} = {}) {
    const [version] = await query(`
        INSERT INTO ai_service_policy_versions (allowed_service_ids, note)
        VALUES ('{argumentation-tutor}', 'Integration test #1127')
        RETURNING id;
    `);
    const design = {
        type:   "semantic_differential",
        phases: [
            { externalServices: { enabledServiceIds: serviceIds } },
            {},
            {},
        ],
    };
    const [designRow] = await query(`
        INSERT INTO designs (creator, design)
        VALUES ($1, $2::jsonb)
        RETURNING id;
    `, [teacher.uid, JSON.stringify(design)]);
    const [session] = await query(`
        INSERT INTO sessions
            (name, descr, creator, time, status, type, ai_service_policy_version_id)
        VALUES ('Integration session', '', $1, now(), 2, 'R', $2)
        RETURNING id;
    `, [teacher.uid, version.id]);
    await query(
        "INSERT INTO activity (design, session) VALUES ($1, $2);",
        [designRow.id, session.id]
    );
    for (const user of [teacher, ...students]) {
        await query("INSERT INTO sesusers (sesid, uid) VALUES ($1, $2);", [session.id, user.uid]);
    }
    const phaseIds = [];
    for (let number = 1; number <= startedPhases; number += 1) {
        const [phase] = await query(`
            INSERT INTO stages (number, type, sesid)
            VALUES ($1, 'individual', $2)
            RETURNING id;
        `, [number, session.id]);
        phaseIds.push(phase.id);
    }
    return { sessionId: session.id, phaseIds };
}

// A completed callback for `user`, through a job as a dispatched hook creates
// it, received at 10:`minute` on 2026-11-05. `claimedPhaseId` is a phase its
// payload names.
async function storeResult(sessionId, phaseId, user, text, minute, {
    status = "completed",
    claimedPhaseId = null,
} = {}) {
    const [job] = await query(`
        INSERT INTO external_service_jobs
            (service_id, hook_name, status, session_id, phase_id, question_id, user_id)
        VALUES ($1, 'student-response-submitted', 'completed', $2, $3, 1, $4)
        RETURNING id;
    `, [SERVICE_ID, sessionId, phaseId, user.uid]);
    const [result] = await query(`
        INSERT INTO external_service_results
            (job_id, correlation_id, service_id, status, session_id, phase_id,
             question_id, user_id, raw_payload, received_at)
        VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8::jsonb, $9)
        RETURNING id;
    `, [
        job.id, String(job.id), SERVICE_ID, status, sessionId, phaseId, user.uid,
        JSON.stringify({ text, phaseId: claimedPhaseId }),
        `2026-11-05T10:${String(minute).padStart(2, "0")}:00Z`,
    ]);
    return result.id;
}

const ROUTE = "GET /activities/:id/users/:user_id/external_service_results";

describe(ROUTE, { skip: SKIP_REASON }, () => {
    let teacher;
    let student;
    let peer;
    let outsider;
    let activity;
    let otherActivity;
    const ids = {};

    before(async () => {
        app = await loadApplication();

        teacher = await createUser("P");
        student = await createUser("A");
        peer = await createUser("A");
        outsider = await createUser("A");
        activity = await createActivity(teacher, [student, peer]);
        otherActivity = await createActivity(teacher, [outsider, student]);
        const [phaseOne, phaseTwo] = activity.phaseIds;

        const session = activity.sessionId;
        const otherPhase = otherActivity.phaseIds[0];

        // Stored out of order: the route answers oldest first.
        ids.second = await storeResult(session, phaseTwo, student, "Second", 5);
        ids.first = await storeResult(session, phaseOne, student, "First", 0);
        ids.peer = await storeResult(session, phaseOne, peer, "Peer", 1);
        ids.pending = await storeResult(session, phaseOne, student, "Pending", 2, {
            status: "pending",
        });
        ids.otherSession = await storeResult(
            otherActivity.sessionId, otherPhase, student, "Other session", 3
        );
        // A result stored in this session with another session's phase.
        ids.foreignPhase = await storeResult(session, otherPhase, student, "Foreign phase", 4);
        // A result stored without a phase, whose payload names another
        // session's phase: the hook accepts it, the route leaves it out.
        ids.claimedPhase = await storeResult(session, null, student, "Claimed phase", 6, {
            claimedPhaseId: otherPhase,
        });
    });

    after(async () => {
        await app?.close();
    });

    function results(session, { sessionId = activity.sessionId, userId = session.uid } = {}) {
        return requestStudentResults(app.resultsRouter, { session, sessionId, userId });
    }

    function fullState(session, { sessionId = activity.sessionId, userId = session.uid } = {}) {
        return requestStudentResults(app.fullStateRouter, {
            session, sessionId, userId, endpoint: "full_state",
        });
    }

    it("returns the student's own results of the session's phases, oldest first", async () => {
        const response = await results(student);

        assert.equal(response.status, 200);
        assert.equal(response.cacheControl, "no-store");
        assert.deepEqual(
            response.body.results.map(({ resultId }) => resultId),
            [ids.first, ids.second]
        );
        assert.deepEqual(response.body.results[0], {
            serviceId:   SERVICE_ID,
            resultId:    ids.first,
            phaseId:     activity.phaseIds[0],
            questionId:  1,
            component:   { componentId: "integration-component" },
            payload:     { text: "First" },
            message:     null,
            status:      "completed",
            publishedAt: "2026-11-05T10:00:00.000Z",
        });
        assert.equal(response.body.results[1].phaseId, activity.phaseIds[1]);
    });

    it("returns another student only their own results", async () => {
        const response = await results(peer);

        assert.equal(response.status, 200);
        assert.deepEqual(response.body.results.map(({ resultId }) => resultId), [ids.peer]);
    });

    it("returns the results of each session separately", async () => {
        const response = await results(student, { sessionId: otherActivity.sessionId });

        assert.equal(response.status, 200);
        assert.deepEqual(response.body.results.map(({ resultId }) => resultId), [ids.otherSession]);
    });

    const refusals = [
        ["another student's id", () => [student, { userId: peer.uid }], 404],
        ["a session the student is not enrolled in", () => [outsider, {}], 404],
        ["an unknown session", () => [student, { sessionId: 2147483647 }], 404],
        ["the session's teacher", () => [teacher, { userId: student.uid }], 403],
    ];
    for (const [label, args, status] of refusals) {
        it(`refuses ${label} as full_state does`, async () => {
            const [session, options] = args();

            const response = await results(session, options);
            const expected = await fullState(session, options);

            assert.equal(response.status, status);
            assert.deepEqual(
                { status: response.status, body: response.body },
                { status: expected.status, body: expected.body }
            );
        });
    }

    it("refuses an anonymized student as full_state does", async () => {
        const forgotten = await createUser("A");
        const { sessionId } = await createActivity(teacher, [forgotten]);
        await storeResult(sessionId, null, forgotten, "Erased", 0);
        await query("UPDATE users SET anonymized_at = now() WHERE id = $1;", [forgotten.uid]);

        const response = await results(forgotten, { sessionId });
        const expected = await fullState(forgotten, { sessionId });

        assert.equal(response.status, 404);
        assert.deepEqual(response.body, expected.body);
    });

    it("answers an empty list for an activity without services", async () => {
        const { sessionId, phaseIds } = await createActivity(teacher, [student], {
            serviceIds: [],
        });
        await storeResult(sessionId, phaseIds[0], student, "Not enabled", 0);

        const response = await results(student, { sessionId });

        assert.equal(response.status, 200);
        assert.deepEqual(response.body, { results: [] });
    });

    it("answers an empty list when the enabled services published nothing", async () => {
        const { sessionId } = await createActivity(teacher, [student], {
            serviceIds: [NO_RESULTS_SERVICE_ID],
        });

        const response = await results(student, { sessionId });

        assert.equal(response.status, 200);
        assert.deepEqual(response.body, { results: [] });
    });

    it("leaves out the results of phases the student cannot see", async () => {
        // The foreign phase and the phase a payload names belong to another
        // session; their results are stored in this one.
        const stored = await query(`
            SELECT id FROM external_service_results
            WHERE session_id = $1 AND user_id = $2 AND status <> 'pending'
        `, [activity.sessionId, student.uid]);
        assert.equal(stored.length, 4);

        const response = await results(student);

        const returned = response.body.results.map(({ resultId }) => resultId);
        assert.ok(!returned.includes(ids.foreignPhase));
        assert.ok(!returned.includes(ids.claimedPhase));
        assert.ok(!returned.includes(ids.pending));
    });
});
