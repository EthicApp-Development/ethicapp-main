import assert from "node:assert/strict";
import test from "node:test";
import { parseRoomId, registerGuardedRoom } from "../guarded-rooms.js";

const silentLogger = { warn: () => {}, error: () => {} };

function createFakeSocket(uid = 44) {
    const handlers = new Map();
    return {
        data:   { uid },
        rooms:  new Set(),
        on:     (event, handler) => handlers.set(event, handler),
        join(room) {
            this.rooms.add(room);
        },
        leave(room) {
            this.rooms.delete(room);
        },
        async emit(event, ...args) {
            return handlers.get(event)(...args);
        },
    };
}

function register(socket, canJoin) {
    registerGuardedRoom(socket, {
        joinEvent:  "joinSession",
        leaveEvent: "leaveSession",
        roomName:   id => `session-${id}`,
        canJoin,
        logger:     silentLogger,
    });
}

test("parseRoomId accepts positive integers and numeric strings only", () => {
    assert.equal(parseRoomId(57), 57);
    assert.equal(parseRoomId("57"), 57);
    for (const value of [0, -1, 1.5, "", " ", "57abc", "1e3x", null, undefined, {}, [57]]) {
        assert.equal(parseRoomId(value), null, `rejects ${JSON.stringify(value)}`);
    }
});

test("an allowed join adds the room and acknowledges success", async () => {
    const socket = createFakeSocket();
    const checks = [];
    register(socket, async (id) => {
        checks.push(id);
        return true;
    });

    let ack;
    await socket.emit("joinSession", "57", (result) => {
        ack = result;
    });

    assert.deepEqual(checks, [57]);
    assert.deepEqual(Array.from(socket.rooms), ["session-57"]);
    assert.deepEqual(ack, { ok: true });
});

test("a denied join leaves rooms unchanged and acknowledges forbidden", async () => {
    const socket = createFakeSocket();
    register(socket, async () => false);

    let ack;
    await socket.emit("joinSession", 58, (result) => {
        ack = result;
    });

    assert.equal(socket.rooms.size, 0);
    assert.deepEqual(ack, { ok: false, error: "forbidden" });
});

test("malformed ids are rejected without an access check", async () => {
    const socket = createFakeSocket();
    let checks = 0;
    register(socket, async () => {
        checks += 1;
        return true;
    });

    let ack;
    await socket.emit("joinSession", "57; DROP TABLE", (result) => {
        ack = result;
    });

    assert.equal(checks, 0);
    assert.deepEqual(ack, { ok: false, error: "invalid_id" });
});

test("access check failures do not join and do not throw", async () => {
    const socket = createFakeSocket();
    register(socket, async () => {
        throw new Error("database unavailable");
    });

    let ack;
    await socket.emit("joinSession", 57, (result) => {
        ack = result;
    });

    assert.equal(socket.rooms.size, 0);
    assert.deepEqual(ack, { ok: false, error: "unavailable" });
});

test("joins without an acknowledgement callback still work", async () => {
    const socket = createFakeSocket();
    register(socket, async () => true);

    await socket.emit("joinSession", 57);
    assert.ok(socket.rooms.has("session-57"));

    await socket.emit("leaveSession", 57);
    assert.equal(socket.rooms.size, 0);
});

function deferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

test("a leave sent while the join is being authorized wins", async () => {
    const socket = createFakeSocket();
    const check = deferred();
    register(socket, () => check.promise);

    let ack;
    const joining = socket.emit("joinSession", 57, (result) => {
        ack = result;
    });
    await socket.emit("leaveSession", 57);
    check.resolve(true);
    await joining;

    assert.equal(socket.rooms.size, 0);
    assert.deepEqual(ack, { ok: false, error: "superseded" });
});

test("the latest join after a leave is applied once authorized", async () => {
    const socket = createFakeSocket();
    const checks = [deferred(), deferred()];
    let call = 0;
    register(socket, () => checks[call++].promise);

    const acks = [];
    const first = socket.emit("joinSession", 57, result => acks.push(["first", result]));
    await socket.emit("leaveSession", 57);
    const second = socket.emit("joinSession", 57, result => acks.push(["second", result]));

    checks[1].resolve(true);
    await second;
    checks[0].resolve(true);
    await first;

    assert.deepEqual(Array.from(socket.rooms), ["session-57"]);
    assert.deepEqual(acks, [["second", { ok: true }], ["first", { ok: false, error: "superseded" }]]);
});

test("pending joins of different rooms do not affect each other", async () => {
    const socket = createFakeSocket();
    const checks = new Map([[57, deferred()], [58, deferred()]]);
    register(socket, id => checks.get(id).promise);

    const joining57 = socket.emit("joinSession", 57);
    const joining58 = socket.emit("joinSession", 58);
    await socket.emit("leaveSession", 57);
    checks.get(57).resolve(true);
    checks.get(58).resolve(true);
    await Promise.all([joining57, joining58]);

    assert.deepEqual(Array.from(socket.rooms), ["session-58"]);
});
