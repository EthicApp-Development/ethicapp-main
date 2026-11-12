import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import session from "express-session";
import { Server as SocketIO } from "socket.io";
import { io as connectClient } from "socket.io-client";
import { configureSocketServer } from "../../config/socket.config.js";
import { createStudentSocketInit, toStudentsNotifications } from "../student.socket.js";
import { createTeacherSocketInit, toTeacherNotifications } from "../teacher.socket.js";
import { createPhaseClockNotifier } from "../../helpers/phase-clock-notifier.js";

// Fixture: student 44 participates in session 57 and group 9; teacher 7
// created session 57, which owns group 9.
const fakeAccess = {
    isSessionParticipant: async (uid, sessionId) => uid === 44 && sessionId === 57,
    isGroupMember:        async (uid, groupId) => uid === 44 && groupId === 9,
    ownsSession:          async (uid, sessionId) => uid === 7 && sessionId === 57,
    ownsGroupSession:     async (uid, groupId) => uid === 7 && groupId === 9,
};
const silentLogger = { warn: () => {}, error: () => {} };

async function startServer({ access = fakeAccess, studentOptions = {} } = {}) {
    const httpServer = createServer();
    const io = new SocketIO(httpServer);
    const serverSockets = [];
    const studentInit = createStudentSocketInit({ access, logger: silentLogger, ...studentOptions });
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

// The phase clock's events (#1111) through real namespaces: the students and
// the teacher who joined the session's room get the transition and the clock,
// and only the teacher gets the deadline notice.
function nextPayload(client, event, ms = 1000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no ${event}`)), ms);
        client.once(event, (payload) => {
            clearTimeout(timer);
            resolve(payload);
        });
    });
}

test("the phase clock's events reach the session's room in both namespaces", async () => {
    const server = await startServer();
    const student = connect(server, "/student", { userId: 44, role: "A", transport: "websocket" });
    const teacher = connect(server, "/teacher", { userId: 7, role: "P", transport: "websocket" });
    const clock = {
        sessionId:   57,
        timeMode:    "hard",
        finished:    false,
        phaseId:     301,
        phaseNumber: 2,
        startedAt:   "2026-11-11T10:00:00.000Z",
        endsAt:      "2026-11-11T10:05:00.000Z",
        isLastPhase: true,
        serverNow:   "2026-11-11T10:00:00.050Z",
    };
    const notifier = createPhaseClockNotifier({
        students:  () => toStudentsNotifications(server.studentNamespace),
        teachers:  () => toTeacherNotifications(server.teacherNamespace),
        readClock: async () => clock,
        logger:    silentLogger,
    });
    try {
        await Promise.all([waitForConnection(student), waitForConnection(teacher)]);
        assert.deepEqual(await student.emitWithAck("joinSession", 57), { ok: true });
        assert.deepEqual(await teacher.emitWithAck("joinSession", 57), { ok: true });

        const transition = { sessionId: 57, phaseId: 301, phaseNumber: 2, reason: "deadline" };
        const received = Promise.all([
            nextPayload(student, "onPhaseTransition"),
            nextPayload(student, "onPhaseClock"),
            nextPayload(teacher, "onPhaseTransition"),
            nextPayload(teacher, "onPhaseClock"),
        ]);
        await notifier.phaseStarted(57, { phaseId: 301, phaseNumber: 2, reason: "deadline" });
        assert.deepEqual(await received, [transition, clock, transition, clock]);

        const studentNotice = receivesWithin(student, "onPhaseDeadlineReached");
        const teacherNotice = nextPayload(teacher, "onPhaseDeadlineReached");
        notifier.deadlineReached(57, { phaseId: 301, isLastPhase: true });
        assert.deepEqual(await teacherNotice, { sessionId: 57, phaseId: 301, isLastPhase: true });
        assert.equal(await studentNotice, false);
    } finally {
        student.close();
        teacher.close();
        await server.close();
    }
});

// The composing notice (epic #601, #655) through a real namespace: the
// group's other members get it, the writer and other groups do not.
test("a composing notice reaches the writer's group but not the writer or other groups", async () => {
    const groups = new Map([[9, [44, 45]], [10, [46]]]);
    const forwarded = [];
    const server = await startServer({
        access: {
            ...fakeAccess,
            isGroupMember: async (uid, groupId) => groups.get(groupId)?.includes(uid) ?? false,
        },
        studentOptions: {
            participantActivity: {
                forward: async signal => forwarded.push(signal),
                forget:  () => {},
            },
            composing: {
                checkAccess: async ({ userId, groupId, phaseId }) =>
                    (phaseId === 20 && groups.get(groupId)?.includes(userId) ? { sessionId: 57 } : null),
                resolveLabel: async ({ userId, role }) => ({ userId, role, name: "Fox" }),
            },
        },
    });
    const writer = connect(server, "/student", { userId: 44, role: "A", transport: "websocket" });
    const peer = connect(server, "/student", { userId: 45, role: "A", transport: "websocket" });
    const otherGroup = connect(server, "/student", { userId: 46, role: "A", transport: "websocket" });
    try {
        await Promise.all([writer, peer, otherGroup].map(waitForConnection));
        assert.deepEqual(await writer.emitWithAck("joinGroup", 9), { ok: true });
        assert.deepEqual(await peer.emitWithAck("joinGroup", 9), { ok: true });
        assert.deepEqual(await otherGroup.emitWithAck("joinGroup", 10), { ok: true });

        const peerNotice = nextPayload(peer, "onChatComposing");
        const writerNotice = receivesWithin(writer, "onChatComposing", 300);
        const otherNotice = receivesWithin(otherGroup, "onChatComposing", 300);
        writer.emit("chatComposing", { phaseId: 20, questionId: 30, groupId: 9, kind: "composing" });

        assert.deepEqual(await peerNotice, {
            groupId: 9, questionId: 30, userId: 44, role: "A", name: "Fox", kind: "composing",
        });
        assert.deepEqual([await writerNotice, await otherNotice], [false, false]);
        assert.deepEqual(forwarded.map(({ kind, sessionId, userId }) => [kind, sessionId, userId]),
            [["composing", 57, 44]]);

        const stoppedOnDisconnect = nextPayload(peer, "onChatComposing");
        writer.close();
        assert.equal((await stoppedOnDisconnect).kind, "stopped");
    } finally {
        writer.close();
        peer.close();
        otherGroup.close();
        await server.close();
    }
});
