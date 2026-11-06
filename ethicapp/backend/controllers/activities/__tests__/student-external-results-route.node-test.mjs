// GET /activities/:id/users/:user_id/external_service_results (#1127, epic
// #1123): a student reads the results external services published to them in
// an activity. It refuses what full_state refuses, in the same way (#926),
// before the registry is asked, and keeps only the results of the session's
// phases. PostgreSQL is replaced by a fake pg pool that answers by matching
// the SQL, and the registry by a fake, so nothing here needs a database.
// The real hook and database are covered by
// student-external-results.integration-test.mjs.
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";

import {
    createStudentExternalResultsRouter,
    resultsOfPhases,
    SESSION_PHASE_IDS_SQL,
} from "../student-external-results.js";
import { SESSION_ACCESS_SQL } from "../../../helpers/activity-owner-helper.js";
import { installFakePgPool } from "../../__tests__/fake-pg-pool.mjs";
import { requestStudentResults } from "./student-results-request.mjs";

const OWNER = Object.freeze({ uid: 5, role: "P" });
const SUPER_ADMIN = Object.freeze({ uid: 3, role: "S" });
const STUDENT = Object.freeze({ uid: 9, role: "A" });
const PEER = Object.freeze({ uid: 12, role: "A" });
const OUTSIDER = Object.freeze({ uid: 11, role: "A" });
const FORGOTTEN_STUDENT = Object.freeze({ uid: 13, role: "A" });

const SESSION_ID = 10;
const OTHER_SESSION_ID = 20;
const UNKNOWN_ID = 999;
const PHASE_ONE = 100;
const PHASE_TWO = 101;
const OTHER_SESSION_PHASE = 200;

const SESSION_NOT_FOUND = Object.freeze({ error: "Session not found." });
const UNAUTHORIZED = Object.freeze({ status: "err", message: "Unauthorized" });
const FORBIDDEN = Object.freeze({ status: "err", message: "Forbidden" });

// Student text that may appear in an adapter's error, and must never reach a
// log.
const PRIVATE_MARKER = "private student argument 1127";

// --- Fake PostgreSQL -------------------------------------------------------

// A session's teacher is enrolled in it too (POST /sessions).
const sessions = new Map([
    [SESSION_ID, {
        creator:      OWNER.uid,
        participants: [OWNER.uid, STUDENT.uid, PEER.uid, FORGOTTEN_STUDENT.uid],
        phases:       [PHASE_ONE, PHASE_TWO],
    }],
    [OTHER_SESSION_ID, {
        creator:      99,
        participants: [99, OUTSIDER.uid],
        phases:       [OTHER_SESSION_PHASE],
    }],
]);
const anonymizedUserIds = new Set([FORGOTTEN_STUDENT.uid]);

function rowsFor(sql, params = []) {
    const [first, second] = params.map(Number);
    const session = sessions.get(first);

    if (sql === SESSION_ACCESS_SQL) {
        if (!session) {
            return [];
        }
        const requester = anonymizedUserIds.has(second) ? null : second;
        return [{
            session_id:  first,
            owned:       session.creator === requester,
            participant: session.participants.includes(requester),
        }];
    }
    if (sql === SESSION_PHASE_IDS_SQL) {
        return (session?.phases ?? []).map(id => ({ id }));
    }
    throw new Error(`Unexpected SQL: ${sql}`);
}

const db = installFakePgPool(rowsFor);

after(() => {
    db.restore();
});

// --- Fake registry ---------------------------------------------------------

function entry(resultId, phaseId, publishedAt) {
    return Object.freeze({
        serviceId:  "test-service",
        resultId,
        phaseId,
        questionId: 30,
        component:  Object.freeze({ componentId: "test-component" }),
        payload:    Object.freeze({ text: "Feedback" }),
        message:    null,
        status:     "completed",
        publishedAt,
    });
}

const FIRST = entry("a0000000-0000-4000-8000-000000000001", PHASE_ONE, "2026-11-05T10:00:00.000Z");
const SECOND = entry("a0000000-0000-4000-8000-000000000002", PHASE_TWO, "2026-11-05T10:05:00.000Z");
const ELSEWHERE = entry("a0000000-0000-4000-8000-000000000003", OTHER_SESSION_PHASE,
    "2026-11-05T10:06:00.000Z");
const THIRD = entry("a0000000-0000-4000-8000-000000000004", PHASE_ONE, "2026-11-05T10:10:00.000Z");

let registryCalls;
let collected;

const registry = {
    async collectStudentResults(context) {
        registryCalls.push(context);
        if (collected instanceof Error) {
            throw collected;
        }
        return collected;
    },
};

const router = createStudentExternalResultsRouter({ registry });

beforeEach(() => {
    db.reset();
    registryCalls = [];
    collected = Object.freeze([FIRST, SECOND, THIRD]);
});

function send(session, { sessionId = SESSION_ID, userId = session?.uid } = {}) {
    return requestStudentResults(router, { session, sessionId, userId });
}

// Runs fn and returns its result with every console line it wrote, on any
// channel, as "<channel> <text>".
async function captureConsole(fn) {
    const channels = ["log", "info", "warn", "error", "debug"];
    const originals = Object.fromEntries(channels.map(channel => [channel, console[channel]]));
    const output = [];
    for (const channel of channels) {
        console[channel] = (...args) => { output.push(`${channel} ${args.join(" ")}`); };
    }
    try {
        return { result: await fn(), output };
    } finally {
        Object.assign(console, originals);
    }
}

// --- Refusals --------------------------------------------------------------

describe("GET /activities/:id/users/:user_id/external_service_results refusals", () => {
    it("refuses a request without a signed-in user with 401, before any lookup", async () => {
        const response = await send(null, { userId: STUDENT.uid });

        assert.equal(response.status, 401);
        assert.deepEqual(response.body, UNAUTHORIZED);
        assert.equal(response.cacheControl, "no-store");
        assert.equal(db.queries.length, 0);
        assert.deepEqual(registryCalls, []);
    });

    const wrongRoles = [["the session's teacher", OWNER], ["a super-admin", SUPER_ADMIN]];
    for (const [label, session] of wrongRoles) {
        it(`refuses ${label} with 403, before any lookup`, async () => {
            const response = await send(session);

            assert.equal(response.status, 403);
            assert.deepEqual(response.body, FORBIDDEN);
            assert.equal(response.cacheControl, "no-store");
            assert.equal(db.queries.length, 0);
            assert.deepEqual(registryCalls, []);
        });
    }

    it("answers ids that are not numbers with 400, as full_state does", async () => {
        const bySession = await send(STUDENT, { sessionId: "abc" });
        const byUser = await send(STUDENT, { userId: "abc" });

        for (const response of [bySession, byUser]) {
            assert.equal(response.status, 400);
            assert.deepEqual(response.body, { error: "Invalid session ID or user ID." });
        }
        assert.equal(db.queries.length, 0);
        assert.deepEqual(registryCalls, []);
    });

    it("answers another student's id as an unknown session, without a query", async () => {
        const response = await send(STUDENT, { userId: PEER.uid });

        assert.equal(response.status, 404);
        assert.deepEqual(response.body, SESSION_NOT_FOUND);
        assert.equal(db.queries.length, 0);
        assert.deepEqual(registryCalls, []);
    });

    const unknownSessionCases = [
        ["a student enrolled in another session", OUTSIDER, SESSION_ID],
        ["an anonymized student", FORGOTTEN_STUDENT, SESSION_ID],
        ["a student asking for a session they are not enrolled in", STUDENT, OTHER_SESSION_ID],
        ["a student asking for an unknown session", STUDENT, UNKNOWN_ID],
    ];
    for (const [label, session, sessionId] of unknownSessionCases) {
        it(`answers ${label} as an unknown session`, async () => {
            const response = await send(session, { sessionId });

            assert.equal(response.status, 404);
            assert.deepEqual(response.body, SESSION_NOT_FOUND);
            assert.equal(response.cacheControl, "no-store");
            assert.deepEqual(db.queries.map(({ sql }) => sql), [SESSION_ACCESS_SQL]);
            assert.deepEqual(registryCalls, []);
        });
    }
});

// --- Reading ---------------------------------------------------------------

describe("GET /activities/:id/users/:user_id/external_service_results", () => {
    it("returns the student's results, oldest first, without caching", async () => {
        const response = await send(STUDENT);

        assert.equal(response.status, 200);
        assert.equal(response.cacheControl, "no-store");
        assert.deepEqual(response.body, { results: [FIRST, SECOND, THIRD] });
        assert.deepEqual(registryCalls, [{ sessionId: SESSION_ID, userId: STUDENT.uid }]);
        assert.deepEqual(
            db.queries.map(({ sql }) => sql),
            [SESSION_ACCESS_SQL, SESSION_PHASE_IDS_SQL]
        );
        assert.deepEqual(db.queries[1].params, [SESSION_ID]);
    });

    it("leaves out results of phases that are not the session's, logging counts only", async () => {
        collected = Object.freeze([FIRST, SECOND, ELSEWHERE, THIRD]);

        const { result: response, output } = await captureConsole(() => send(STUDENT));

        assert.equal(response.status, 200);
        assert.deepEqual(response.body.results.map(({ resultId }) => resultId),
            [FIRST.resultId, SECOND.resultId, THIRD.resultId]);
        assert.equal(output.length, 1);
        assert.match(output[0], /^warn \[external-services\] Left out student results/u);
        assert.deepEqual(JSON.parse(output[0].slice(output[0].indexOf("{"))), {
            sessionId: SESSION_ID,
            userId:    STUDENT.uid,
            dropped:   1,
        });
    });

    it("answers an empty list without reading the phases when nothing was published", async () => {
        collected = Object.freeze([]);

        const response = await send(STUDENT);

        assert.equal(response.status, 200);
        assert.deepEqual(response.body, { results: [] });
        assert.deepEqual(db.queries.map(({ sql }) => sql), [SESSION_ACCESS_SQL]);
    });

    it("answers 500 when the results cannot be read, logging no error text", async () => {
        collected = Object.assign(new Error(PRIVATE_MARKER), {
            name: "TypeError",
            code: "ECONNRESET",
        });

        const { result: response, output } = await captureConsole(() => send(STUDENT));

        assert.equal(response.status, 500);
        assert.deepEqual(response.body, { error: "Internal server error." });
        assert.equal(response.cacheControl, "no-store");
        assert.equal(output.length, 1);
        assert.match(
            output[0],
            /^error \[external-services\] Could not read a student's results\./u
        );
        assert.deepEqual(JSON.parse(output[0].slice(output[0].indexOf("{"))), {
            sessionId: SESSION_ID,
            userId:    STUDENT.uid,
            errorName: "TypeError",
            errorCode: "ECONNRESET",
        });
        assert.ok(!output.join("\n").includes(PRIVATE_MARKER));
    });
});

describe("resultsOfPhases", () => {
    it("keeps the results of the given phases in their order", () => {
        assert.deepEqual(
            resultsOfPhases([FIRST, ELSEWHERE, SECOND, THIRD], [PHASE_TWO, PHASE_ONE]),
            [FIRST, SECOND, THIRD]
        );
    });

    it("keeps nothing for a session without phases", () => {
        assert.deepEqual(resultsOfPhases([FIRST, SECOND], []), []);
    });
});
