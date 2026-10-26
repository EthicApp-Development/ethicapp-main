import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import session from "express-session";
import { Server as SocketIO } from "socket.io";
import { io as connectClient } from "socket.io-client";
import { configureSocketServer } from "../../config/socket.config.js";
import { createStudentSocketInit } from "../student.socket.js";
import { createTeacherSocketInit } from "../teacher.socket.js";

// Fixture: student 44 participates in session 57 and group 9; teacher 7
// created session 57, which owns group 9.
const fakeAccess = {
    isSessionParticipant: async (uid, sessionId) => uid === 44 && sessionId === 57,
    isGroupMember:        async (uid, groupId) => uid === 44 && groupId === 9,
    ownsSession:          async (uid, sessionId) => uid === 7 && sessionId === 57,
    ownsGroupSession:     async (uid, groupId) => uid === 7 && groupId === 9,
};
const silentLogger = { warn: () => {}, error: () => {} };

async function startServer({ access = fakeAccess } = {}) {
    const httpServer = createServer();
    const io = new SocketIO(httpServer);
    const serverSockets = [];
    const studentInit = createStudentSocketInit({ access, logger: silentLogger });
    const teacherInit = createTeacherSocketInit({ access, logger: silentLogger });

    const namespaces = configureSocketServer(io, {
        sessionMiddleware: session({
            secret:            "test-secret",
            resave:            false,
            saveUninitialized: false,
        }),
        studentInit: (socket) => {
            serverSockets.push(socket);
            studentInit(socket);
        },
        teacherInit: (socket) => {
            serverSockets.push(socket);
            teacherInit(socket);
        },
    });

    await new Promise(resolve => httpServer.listen(0, "127.0.0.1", resolve));
    const { port } = httpServer.address();

    return {
        ...namespaces,
        serverSockets,
        url:   `http://127.0.0.1:${port}`,
        close: () => new Promise(resolve => io.close(() => resolve())),
    };
}

function connect(server, namespace, { userId, role, transport }) {
    const extraHeaders = {};
    if (userId) {
        extraHeaders["X-User-Id"] = String(userId);
        extraHeaders["X-User-Role"] = role;
    }

    return connectClient(`${server.url}${namespace}`, {
        transports:   [transport],
        extraHeaders,
        reconnection: false,
        forceNew:     true,
    });
}

function waitForConnection(client) {
    return new Promise((resolve, reject) => {
        client.once("connect", () => resolve());
        client.once("connect_error", reject);
    });
}

function connectionError(client) {
    return new Promise((resolve, reject) => {
        client.once("connect", () => reject(new Error("unexpected connection")));
        client.once("connect_error", error => resolve(error.message));
    });
}

function receivesWithin(client, event, ms = 150) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), ms);
        client.once(event, () => {
            clearTimeout(timer);
            resolve(true);
        });
    });
}

for (const transport of ["polling", "websocket"]) {
    test(`[${transport}] sockets without an authenticated session are refused`, async () => {
        const server = await startServer();
        try {
            assert.equal(await connectionError(connect(server, "/student", { transport })), "unauthorized");
            assert.equal(await connectionError(connect(server, "/teacher", { transport })), "unauthorized");
        } finally {
            await server.close();
        }
    });

    test(`[${transport}] each namespace accepts only its role`, async () => {
        const server = await startServer();
        try {
            const studentOnTeacher = connect(server, "/teacher", { userId: 44, role: "A", transport });
            const teacherOnStudent = connect(server, "/student", { userId: 7, role: "P", transport });

            assert.equal(await connectionError(studentOnTeacher), "forbidden");
            assert.equal(await connectionError(teacherOnStudent), "forbidden");
        } finally {
            await server.close();
        }
    });

    test(`[${transport}] students join only their sessions, groups and personal room`, async () => {
        const server = await startServer();
        const client = connect(server, "/student", { userId: 44, role: "A", transport });
        try {
            await waitForConnection(client);

            assert.deepEqual(await client.emitWithAck("joinSession", 57), { ok: true });
            assert.deepEqual(await client.emitWithAck("joinSession", 58), { ok: false, error: "forbidden" });
            assert.deepEqual(await client.emitWithAck("joinGroup", 9), { ok: true });
            assert.deepEqual(await client.emitWithAck("joinGroup", 10), { ok: false, error: "forbidden" });
            assert.deepEqual(await client.emitWithAck("joinUser", 99), { ok: true });

            const rooms = server.serverSockets[0].rooms;
            assert.ok(rooms.has("session-57"));
            assert.ok(rooms.has("group-9"));
            assert.ok(rooms.has("user-44"), "personal room is the caller's own");
            assert.ok(!rooms.has("user-99"), "requested user id is ignored");
            assert.ok(!rooms.has("session-58"));
            assert.ok(!rooms.has("group-10"));

            const personal = receivesWithin(client, "onExternalServiceResult");
            server.studentNamespace.to("user-44").emit("onExternalServiceResult", { ok: true });
            assert.equal(await personal, true);

            const foreign = receivesWithin(client, "onExternalServiceResult");
            server.studentNamespace.to("user-99").emit("onExternalServiceResult", { leaked: true });
            assert.equal(await foreign, false);
        } finally {
            client.close();
            await server.close();
        }
    });

    test(`[${transport}] student sockets cannot write chat messages or broadcast`, async () => {
        const server = await startServer();
        const client = connect(server, "/student", { userId: 44, role: "A", transport });
        try {
            await waitForConnection(client);
            await client.emitWithAck("joinSession", 57);

            const serverSocket = server.serverSockets[0];
            assert.equal(serverSocket.listeners("messageToGroup").length, 0);
            assert.equal(serverSocket.listeners("broadcastToSession").length, 0);

            const notification = receivesWithin(client, "notification");
            client.emit("broadcastToSession", 57, "spoofed");
            assert.equal(await notification, false);
        } finally {
            client.close();
            await server.close();
        }
    });

    test(`[${transport}] a leave sent while a join is authorized is not undone`, async () => {
        let releaseSession57;
        const session57Check = new Promise((resolve) => {
            releaseSession57 = resolve;
        });
        const server = await startServer({
            access: {
                ...fakeAccess,
                isSessionParticipant: async (uid, sessionId) =>
                    (sessionId === 57 ? session57Check : uid === 44 && sessionId === 58),
            },
        });
        const client = connect(server, "/student", { userId: 44, role: "A", transport });
        try {
            await waitForConnection(client);

            const join57 = client.emitWithAck("joinSession", 57);
            client.emit("leaveSession", 57);
            assert.deepEqual(await client.emitWithAck("joinSession", 58), { ok: true });
            releaseSession57(true);

            assert.deepEqual(await join57, { ok: false, error: "superseded" });

            const rooms = server.serverSockets[0].rooms;
            assert.ok(rooms.has("session-58"));
            assert.ok(!rooms.has("session-57"), "abandoned session is not re-joined");

            const abandoned = receivesWithin(client, "onEndSession");
            server.studentNamespace.to("session-57").emit("onEndSession", { content: null });
            assert.equal(await abandoned, false);
        } finally {
            client.close();
            await server.close();
        }
    });

    test(`[${transport}] teachers join only sessions they created and their groups`, async () => {
        const server = await startServer();
        const owner = connect(server, "/teacher", { userId: 7, role: "P", transport });
        const otherTeacher = connect(server, "/teacher", { userId: 8, role: "P", transport });
        try {
            await Promise.all([waitForConnection(owner), waitForConnection(otherTeacher)]);

            assert.deepEqual(await owner.emitWithAck("joinSession", 57), { ok: true });
            assert.deepEqual(await owner.emitWithAck("joinGroupChat", 9), { ok: true });
            assert.deepEqual(await otherTeacher.emitWithAck("joinSession", 57), { ok: false, error: "forbidden" });
            assert.deepEqual(await otherTeacher.emitWithAck("joinGroupChat", 9), { ok: false, error: "forbidden" });

            const ownerSees = receivesWithin(owner, "onStudentJoined");
            const otherSees = receivesWithin(otherTeacher, "onStudentJoined");
            server.teacherNamespace.to("session-57").emit("onStudentJoined", { id: 44 });
            assert.deepEqual([await ownerSees, await otherSees], [true, false]);
        } finally {
            owner.close();
            otherTeacher.close();
            await server.close();
        }
    });
}
