// POST /activities/:session_id/phases/:phase_id/clock/extend (#1112, epic
// #1105): "+1 min" on the activity dashboard. Only the activity's owner may
// extend, the request carries exactly one minute and the deadline the teacher
// saw, each refusal has its status and code, and the students and the teacher
// are told only after a change, as are the services the phase enables
// (`phase-clock-changed`, #1178), without the answer waiting for them. The
// owner check runs against a fake pg pool; the extension, the clock reader
// and the notifiers are fakes. The statement
// itself is covered by
// helpers/__tests__/phase-clock-extension.integration-test.mjs.
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import express from "express";

import { createPhaseClockRouter } from "../phase-clock.js";
import { SESSION_OWNERSHIP_SQL } from "../../../helpers/activity-owner-helper.js";
import { installFakePgPool, requestRouter } from "../../__tests__/fake-pg-pool.mjs";

const OWNER = Object.freeze({ uid: 5, role: "P" });
const OTHER_TEACHER = Object.freeze({ uid: 6, role: "P" });
const FORGOTTEN_TEACHER = Object.freeze({ uid: 7, role: "P" });
const STUDENT = Object.freeze({ uid: 9, role: "A" });
const SUPER_ADMIN = Object.freeze({ uid: 3, role: "S" });

const SESSION_ID = 10;
const FORGOTTEN_SESSION_ID = 11;
const PHASE_ID = 101;
const UNKNOWN_ID = 999;

const ENDS_AT = "2026-11-11T10:05:00.000Z";
const VALID_BODY = Object.freeze({ minutes: 1, expectedEndsAt: ENDS_AT });

const SESSION_NOT_FOUND = Object.freeze({ error: "Session not found." });
const PHASE_NOT_FOUND = Object.freeze({ error: "Phase not found." });

const clockAt = endsAt => Object.freeze({
    sessionId:   SESSION_ID,
    timeMode:    "soft",
    finished:    false,
    phaseId:     PHASE_ID,
    phaseNumber: 2,
    startedAt:   "2026-11-11T10:00:00.000Z",
    endsAt,
    isLastPhase: false,
    serverNow:   "2026-11-11T10:01:30.250Z",
});

// --- Fake PostgreSQL, for the owner check ----------------------------------

const sessions = new Map([
    [SESSION_ID, { creator: OWNER.uid }],
    [FORGOTTEN_SESSION_ID, { creator: FORGOTTEN_TEACHER.uid }],
]);
const anonymizedUserIds = new Set([FORGOTTEN_TEACHER.uid]);

const db = installFakePgPool((sql, params = []) => {
    if (sql !== SESSION_OWNERSHIP_SQL) {
        throw new Error(`Unexpected SQL: ${sql}`);
    }
    const [sessionId, requesterId] = params.map(Number);
    const session = sessions.get(sessionId);
    if (!session) {
        return [];
    }
    const requester = anonymizedUserIds.has(requesterId) ? null : requesterId;
    return [{ session_id: sessionId, owned: session.creator === requester }];
});

after(() => {
    db.restore();
});

// --- Fakes ------------------------------------------------------------------

let extensions;
let clockReads;
let notifications;
let serviceNotifications;
let outcome;
let clock;

beforeEach(() => {
    db.reset();
    extensions = [];
    clockReads = [];
    notifications = [];
    serviceNotifications = [];
    outcome = { status: "extended", phaseId: PHASE_ID };
    clock = clockAt("2026-11-11T10:06:00.000Z");
});

function makeRouter(overrides = {}) {
    return createPhaseClockRouter({
        extendDeadline: async (request) => {
            extensions.push(request);
            return outcome;
        },
        readClock: async (sessionId) => {
            clockReads.push(sessionId);
            return clock;
        },
        notifyClockChanged: async (sessionId) => {
            notifications.push(sessionId);
        },
        notifyServicesClockChanged: async (sessionId, phaseId) => {
            serviceNotifications.push({ sessionId, phaseId });
        },
        ...overrides,
    });
}

function extend({
    session = OWNER,
    sessionId = SESSION_ID,
    phaseId = PHASE_ID,
    body = VALID_BODY,
    router = makeRouter(),
} = {}) {
    return requestRouter(router, {
        method: "POST",
        path:   `/activities/${sessionId}/phases/${phaseId}/clock/extend`,
        body,
        session,
    });
}

async function quietly(run) {
    const originalError = console.error;
    console.error = () => {};
    try {
        return await run();
    } finally {
        console.error = originalError;
    }
}

// --- A change ---------------------------------------------------------------

describe("an extension", () => {
    it("extends the owner's phase by one minute and answers the new clock", async () => {
        const response = await extend();

        assert.equal(response.status, 200);
        assert.deepEqual(response.body, clock);
        assert.deepEqual(extensions, [{
            sessionId:      SESSION_ID,
            phaseId:        PHASE_ID,
            teacherId:      OWNER.uid,
            minutes:        1,
            expectedEndsAt: ENDS_AT,
        }]);
        assert.deepEqual(clockReads, [SESSION_ID]);
    });

    it("tells the students and the teacher after the change", async () => {
        await extend();

        assert.deepEqual(notifications, [SESSION_ID]);
    });

    it("tells the services the phase enables, with the session and the phase", async () => {
        await extend();

        assert.deepEqual(serviceNotifications, [{ sessionId: SESSION_ID, phaseId: PHASE_ID }]);
    });

    it("answers without waiting for the services", async () => {
        let started = false;
        const router = makeRouter({
            notifyServicesClockChanged: () => {
                started = true;
                return new Promise(() => {});
            },
        });

        const response = await extend({ router });

        assert.equal(response.status, 200);
        assert.equal(started, true);
    });

    it("answers the new clock when telling the services fails, and logs it", async () => {
        const errors = [];
        const logger = { error: (...args) => errors.push(args) };
        for (const notifyServicesClockChanged of [
            async () => { throw new Error("registry down"); },
            () => { throw new Error("thrown at once"); },
        ]) {
            const router = makeRouter({ notifyServicesClockChanged, logger });

            const response = await extend({ router });
            await new Promise(resolve => setImmediate(resolve));

            assert.equal(response.status, 200);
            assert.deepEqual(response.body, clock);
        }
        assert.equal(errors.length, 2);
        assert.match(errors[0][0], /phase-clock-changed/);
    });

    it("passes the expected deadline as the teacher sent it", async () => {
        for (const expectedEndsAt of [
            "2026-11-11T10:05:00Z",
            "2026-11-11T07:05:00.123-03:00",
            "2026-11-11T10:05:00.123456Z",
        ]) {
            extensions = [];
            const response = await extend({ body: { minutes: 1, expectedEndsAt } });

            assert.equal(response.status, 200, expectedEndsAt);
            assert.equal(extensions[0].expectedEndsAt, expectedEndsAt);
        }
    });

    it("is never cached", async () => {
        const router = makeRouter();
        const app = express();
        app.use(express.json());
        app.use((req, res, next) => {
            req.session = OWNER;
            next();
        });
        app.use(router);
        const server = app.listen(0, "127.0.0.1");
        await new Promise(resolve => server.once("listening", resolve));
        try {
            const { port } = server.address();
            const response = await fetch(
                `http://127.0.0.1:${port}/activities/${SESSION_ID}/phases/${PHASE_ID}/clock/extend`,
                {
                    method:  "POST",
                    headers: { "Content-Type": "application/json" },
                    body:    JSON.stringify(VALID_BODY),
                }
            );
            assert.equal(response.status, 200);
            assert.equal(response.headers.get("cache-control"), "no-store");
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
    });
});

// --- Who may extend ----------------------------------------------------------

describe("who may extend", () => {
    it("refuses a request without a session before any lookup", async () => {
        const response = await extend({ session: null });

        assert.equal(response.status, 401);
        assert.deepEqual(db.queries, []);
        assert.deepEqual(extensions, []);
    });

    it("refuses a student, even a participant, and an administrator", async () => {
        for (const session of [STUDENT, SUPER_ADMIN]) {
            const response = await extend({ session });

            assert.equal(response.status, 403, session.role);
        }
        assert.deepEqual(db.queries, []);
        assert.deepEqual(extensions, []);
    });

    // The same 404 as an unknown session, so the answer does not reveal that
    // the activity exists (#923).
    it("answers another teacher and an anonymized owner as an unknown session", async () => {
        for (const [session, sessionId] of [
            [OTHER_TEACHER, SESSION_ID],
            [FORGOTTEN_TEACHER, FORGOTTEN_SESSION_ID],
            [OWNER, UNKNOWN_ID],
            [OWNER, "abc"],
        ]) {
            const response = await extend({ session, sessionId });

            assert.equal(response.status, 404, `${session.uid} ${sessionId}`);
            assert.deepEqual(response.body, SESSION_NOT_FOUND);
        }
        assert.deepEqual(extensions, []);
        assert.deepEqual(notifications, []);
    });

    it("answers a phase id that is not one with 404", async () => {
        for (const phaseId of ["abc", 0, -3]) {
            const response = await extend({ phaseId });

            assert.equal(response.status, 404, String(phaseId));
            assert.deepEqual(response.body, PHASE_NOT_FOUND);
        }
        assert.deepEqual(extensions, []);
    });
});

// --- The request -------------------------------------------------------------

describe("the request", () => {
    it("accepts only one minute", async () => {
        for (const minutes of [undefined, null, 0, 2, -1, 1.5, "1", 60]) {
            const response = await extend({ body: { minutes, expectedEndsAt: ENDS_AT } });

            assert.equal(response.status, 400, String(minutes));
            assert.equal(response.body.code, "INVALID_MINUTES");
        }
        assert.deepEqual(db.queries, []);
        assert.deepEqual(extensions, []);
    });

    it("needs the deadline the teacher saw, as an ISO 8601 time", async () => {
        for (const expectedEndsAt of [
            undefined,
            null,
            "",
            1762855500000,
            "2026-11-11",
            "2026-11-11T10:05:00",
            "2026-11-11 10:05:00Z",
            "2026-13-45T10:05:00Z",
            "Wed, 11 Nov 2026 10:05:00 GMT",
        ]) {
            const response = await extend({ body: { minutes: 1, expectedEndsAt } });

            assert.equal(response.status, 400, String(expectedEndsAt));
            assert.equal(response.body.code, "INVALID_EXPECTED_ENDS_AT");
        }
        assert.deepEqual(db.queries, []);
        assert.deepEqual(extensions, []);
    });

    it("refuses a request without a body", async () => {
        const response = await requestRouter(makeRouter(), {
            method:  "POST",
            path:    `/activities/${SESSION_ID}/phases/${PHASE_ID}/clock/extend`,
            session: OWNER,
        });

        assert.equal(response.status, 400);
        assert.equal(response.body.code, "INVALID_MINUTES");
    });
});

// --- Refusals ----------------------------------------------------------------

describe("a refused extension", () => {
    const CONFLICTS = [
        ["finished", "ACTIVITY_FINISHED"],
        ["not_current", "PHASE_NOT_CURRENT"],
        ["no_deadline", "NO_DEADLINE"],
        ["deadline_passed", "DEADLINE_PASSED"],
        ["deadline_changed", "DEADLINE_CHANGED"],
    ];

    for (const [status, code] of CONFLICTS) {
        it(`answers ${status} with 409 ${code} and the current clock, telling no one`,
            async () => {
                outcome = { status };
                clock = clockAt(ENDS_AT);

                const response = await extend();

                assert.equal(response.status, 409);
                assert.equal(response.body.code, code);
                assert.equal(typeof response.body.error, "string");
                assert.deepEqual(response.body.clock, clock);
                assert.deepEqual(clockReads, [SESSION_ID]);
                assert.deepEqual(notifications, []);
                assert.deepEqual(serviceNotifications, []);
            });
    }

    it("answers a phase of another session with 404, telling no one", async () => {
        outcome = { status: "phase_not_found" };

        const response = await extend();

        assert.equal(response.status, 404);
        assert.deepEqual(response.body, PHASE_NOT_FOUND);
        assert.deepEqual(notifications, []);
        assert.deepEqual(serviceNotifications, []);
    });

    it("answers a session that is no longer the teacher's with 404", async () => {
        outcome = { status: "not_found" };

        const response = await extend();

        assert.equal(response.status, 404);
        assert.deepEqual(response.body, SESSION_NOT_FOUND);
        assert.deepEqual(notifications, []);
    });
});

// --- Failures ----------------------------------------------------------------

describe("a failure", () => {
    it("answers 500 when the extension fails, telling no one", async () => {
        const router = makeRouter({
            extendDeadline: async () => {
                throw new Error("database down");
            },
        });

        const response = await quietly(() => extend({ router }));

        assert.equal(response.status, 500);
        assert.deepEqual(response.body, { error: "Internal server error" });
        assert.deepEqual(notifications, []);
        assert.deepEqual(serviceNotifications, []);
    });

    it("answers 500 for an outcome it does not know", async () => {
        outcome = { status: "surprise" };

        const response = await quietly(() => extend());

        assert.equal(response.status, 500);
        assert.deepEqual(notifications, []);
    });

    it("still tells the clients, and answers 404, when the session is gone after the change",
        async () => {
            clock = null;

            const response = await extend();

            assert.equal(response.status, 404);
            assert.deepEqual(response.body, SESSION_NOT_FOUND);
            assert.deepEqual(notifications, [SESSION_ID]);
        });
});
