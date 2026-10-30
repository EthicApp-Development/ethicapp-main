import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import express from "express";

import { createTeacherActivitiesAdminRouter } from "../teacher-activities.js";
import { createActivityFinisher } from "../../../helpers/activity-finish-helper.js";

const SUPER_ADMIN = Object.freeze({ uid: 1, role: "S" });
const USERS = Object.freeze({
    5: { id: 5, role: "P" },
    6: { id: 6, role: "A" },
});

const servers = [];

afterEach(async () => {
    await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))));
});

// A finisher over an in-memory session table: { id: { creator, status } }.
function inMemoryFinisher(sessions, { failing = [] } = {}) {
    const notified = [];
    const finisher = createActivityFinisher({
        query: async (sql, params) => {
            if (/SELECT id\s+FROM sessions/.test(sql)) {
                const [creator, finished] = params;
                const rows = Object.entries(sessions)
                    .filter(([, row]) => row.creator === creator && row.status !== finished)
                    .map(([id]) => ({ id: Number(id) }));
                return { rows, rowCount: rows.length };
            }
            if (/SELECT current_stage/.test(sql)) {
                const row = sessions[params[0]];
                return { rows: row ? [{ current_stage: null }] : [], rowCount: row ? 1 : 0 };
            }
            const [status, id] = params;
            if (sessions[id].status === status) {
                return { rows: [], rowCount: 0 };
            }
            sessions[id].status = status;
            return { rows: [], rowCount: 1 };
        },
        invalidateStudentDescriptor: async (sessionId) => {
            if (failing.includes(sessionId)) {
                throw new Error("cache down");
            }
        },
        dispatchPhaseHook:     async () => {},
        notifyStudentsEnded:   sessionId => notified.push(sessionId),
        readEnabledServiceIds: async () => [],
        dispatchRegistryHook:  async () => [],
        logger:                { error: () => {} },
    });
    return { finisher, notified };
}

function spyFinisher() {
    const calls = [];
    return {
        calls,
        listOpenActivityIds: async (userId) => {
            calls.push(["list", userId]);
            return [];
        },
        finishOpenActivitiesOf: async (userId) => {
            calls.push(["finish", userId]);
            return { finished: [], skipped: [], failed: [] };
        },
    };
}

async function request({ session = SUPER_ADMIN, finisher = spyFinisher(), readUser, method, path }) {
    const app = express();
    app.use((req, res, next) => {
        req.session = session ? { ...session } : undefined;
        next();
    });
    app.use(createTeacherActivitiesAdminRouter({
        finisher,
        readUser: readUser ?? (async userId => USERS[userId] ?? null),
    }));

    const server = app.listen(0, "127.0.0.1");
    servers.push(server);
    await new Promise(resolve => server.once("listening", resolve));
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers: { Accept: "application/json" },
    });
    const isJson = (response.headers.get("content-type") || "").startsWith("application/json");
    const body = isJson ? await response.json() : await response.text();
    return { status: response.status, body, finisher };
}

const ROUTES = [
    ["GET", "/api/admin/users/5/open-activities"],
    ["POST", "/api/admin/users/5/finish-activities"],
];

describe("internal teacher activity endpoints: refusals", () => {
    for (const [method, path] of ROUTES) {
        it(`${method} ${path} refuses a request without a session user`, async () => {
            const { status, body, finisher } = await request({ session: {}, method, path });
            assert.equal(status, 401);
            assert.deepEqual(body, { ok: false, error: "unauthenticated" });
            assert.deepEqual(finisher.calls, []);
        });

        it(`${method} ${path} refuses a teacher session`, async () => {
            const { status, body, finisher } = await request({ session: { uid: 5, role: "P" }, method, path });
            assert.equal(status, 403);
            assert.deepEqual(body, { ok: false, error: "forbidden" });
            assert.deepEqual(finisher.calls, []);
        });

        it(`${method} ${path} accepts a super-admin impersonating a teacher`, async () => {
            const session = { uid: 5, role: "P", authUid: 1, authRole: "S", impersonating: true };
            const { status } = await request({ session, method, path });
            assert.equal(status, 200);
        });

        for (const badId of ["0", "-3", "abc", "5.5", "99999999999", "1e3"]) {
            it(`${method} ${path} refuses the user id ${badId}`, async () => {
                const { status, body, finisher } = await request({
                    method,
                    path: path.replace("/5/", `/${badId}/`),
                });
                assert.equal(status, 400);
                assert.deepEqual(body, { ok: false, error: "invalid_user" });
                assert.deepEqual(finisher.calls, []);
            });
        }

        it(`${method} ${path} answers 404 for an unknown user`, async () => {
            const { status, body, finisher } = await request({ method, path: path.replace("/5/", "/77/") });
            assert.equal(status, 404);
            assert.deepEqual(body, { ok: false, error: "user_not_found" });
            assert.deepEqual(finisher.calls, []);
        });

        it(`${method} ${path} refuses a user who is not a teacher`, async () => {
            const { status, body, finisher } = await request({ method, path: path.replace("/5/", "/6/") });
            assert.equal(status, 400);
            assert.deepEqual(body, { ok: false, error: "not_a_teacher" });
            assert.deepEqual(finisher.calls, []);
        });

        it(`${method} ${path} is case-sensitive, like the NGINX locations`, async () => {
            const { status } = await request({ method, path: path.replace("/api/admin/", "/API/admin/") });
            assert.equal(status, 404);
        });

        it(`${method} ${path} answers 500 without details when the lookup fails`, async () => {
            const { status, body } = await request({
                method,
                path,
                readUser: async () => {
                    throw new Error("connection string postgres://secret@db");
                },
            });
            assert.equal(status, 500);
            assert.deepEqual(body, { ok: false, error: "internal_error" });
        });
    }

    it("refuses GET on the finish route", async () => {
        const { status, finisher } = await request({ method: "GET", path: "/api/admin/users/5/finish-activities" });
        assert.equal(status, 404);
        assert.deepEqual(finisher.calls, []);
    });
});

describe("GET /api/admin/users/:id/open-activities", () => {
    it("counts the teacher's unfinished sessions without finishing them", async () => {
        const sessions = {
            10: { creator: 5, status: 2 },
            11: { creator: 5, status: 1 },
            12: { creator: 5, status: 3 },
            13: { creator: 9, status: 2 },
        };
        const { finisher, notified } = inMemoryFinisher(sessions);

        const { status, body } = await request({
            finisher, method: "GET", path: "/api/admin/users/5/open-activities",
        });

        assert.equal(status, 200);
        assert.deepEqual(body, { ok: true, userId: 5, count: 2, sessionIds: [10, 11] });
        assert.equal(sessions[10].status, 2);
        assert.deepEqual(notified, []);
    });
});

describe("POST /api/admin/users/:id/finish-activities", () => {
    it("finishes every unfinished session of the teacher, and nothing on a second call", async () => {
        const sessions = {
            10: { creator: 5, status: 2 },
            11: { creator: 5, status: 1 },
            12: { creator: 5, status: 3 },
            13: { creator: 9, status: 2 },
        };
        const { finisher, notified } = inMemoryFinisher(sessions);
        const call = () => request({ finisher, method: "POST", path: "/api/admin/users/5/finish-activities" });

        const first = await call();
        assert.equal(first.status, 200);
        assert.deepEqual(first.body, { ok: true, userId: 5, finished: [10, 11], skipped: [], failed: [] });
        assert.deepEqual(notified, [10, 11]);
        assert.equal(sessions[11].status, 3);
        assert.equal(sessions[13].status, 2);

        const second = await call();
        assert.equal(second.status, 200);
        assert.deepEqual(second.body, { ok: true, userId: 5, finished: [], skipped: [], failed: [] });
        assert.deepEqual(notified, [10, 11]);
    });

    it("reports the sessions it could not finish, with ok false", async () => {
        const sessions = {
            10: { creator: 5, status: 2 },
            11: { creator: 5, status: 2 },
            12: { creator: 5, status: 1 },
        };
        const { finisher } = inMemoryFinisher(sessions, { failing: [11] });

        const { status, body } = await request({
            finisher, method: "POST", path: "/api/admin/users/5/finish-activities",
        });

        assert.equal(status, 200);
        assert.deepEqual(body, {
            ok:       false,
            userId:   5,
            finished: [10, 12],
            skipped:  [],
            failed:   [{ sessionId: 11, error: "finish_failed" }],
        });
    });

    it("answers 500 when the sessions cannot be listed", async () => {
        const finisher = {
            listOpenActivityIds:    async () => [],
            finishOpenActivitiesOf: async () => {
                throw new Error("database down");
            },
        };

        const { status, body } = await request({
            finisher, method: "POST", path: "/api/admin/users/5/finish-activities",
        });

        assert.equal(status, 500);
        assert.deepEqual(body, { ok: false, error: "internal_error" });
    });
});
