import assert from "node:assert/strict";
import test from "node:test";
import { hydrateEngineRequest, requireSocketRole } from "../socket-auth.js";
import { createRoomAccess } from "../socket-room-access.js";

function runMiddleware(middleware, session) {
    const socket = { request: { session }, data: {} };
    let error;
    middleware(socket, (err) => {
        error = err;
    });
    return { socket, error };
}

test("requireSocketRole admits the allowed role and records the identity", () => {
    const { socket, error } = runMiddleware(requireSocketRole("A"), { uid: 44, role: "A" });

    assert.equal(error, undefined);
    assert.deepEqual(socket.data, { uid: 44, role: "A" });
});

test("requireSocketRole rejects missing sessions and wrong roles", () => {
    assert.equal(runMiddleware(requireSocketRole("A"), undefined).error.message, "unauthorized");
    assert.equal(runMiddleware(requireSocketRole("A"), { uid: "x", role: "A" }).error.message, "unauthorized");
    assert.equal(runMiddleware(requireSocketRole("P"), { uid: 44, role: "A" }).error.message, "forbidden");
    assert.equal(runMiddleware(requireSocketRole(["P", "S"]), { uid: 7, role: "S" }).error, undefined);
});

test("hydrateEngineRequest hydrates a raw request from the auth headers", () => {
    const req = { headers: { "x-user-id": "44", "x-user-role": "A" }, session: {} };
    let called = false;

    hydrateEngineRequest(req, {}, () => {
        called = true;
    });

    assert.equal(called, true);
    assert.equal(req.session.uid, 44);
    assert.equal(req.session.role, "A");
});

test("createRoomAccess sends uid and room id to each access query", async () => {
    const calls = [];
    const access = createRoomAccess(async (sql, params) => {
        calls.push({ sql, params });
        return true;
    });

    assert.equal(await access.isSessionParticipant(44, 57), true);
    await access.isGroupMember(44, 9);
    await access.ownsSession(7, 57);
    await access.ownsGroupSession(7, 9);

    assert.deepEqual(calls.map(({ params }) => params), [[44, 57], [44, 9], [7, 57], [7, 9]]);
    assert.match(calls[0].sql, /FROM sesusers/);
    assert.match(calls[1].sql, /FROM teamusers/);
    assert.match(calls[2].sql, /creator = \$1/);
    assert.match(calls[3].sql, /FROM teams/);
});
