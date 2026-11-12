// The teacher's composing signal on the teacher socket (epic #601, #1200),
// with a fake socket, a fake database query and a fake clock: who may signal,
// the notice the group's participants get on /student, the absence of AI
// services, jobs and writes, the rate limit and disconnects.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getStatusCode } from "../../../common/modules/session-status.js";
import { resolveChatAuthorLabel } from "../../helpers/chat-author-label.js";
import { GROUP_CHAT_ACCESS_SQL, resolveOpenGroupChatContext } from "../../helpers/group-chat-access.js";
import { createTeacherSocketInit } from "../teacher.socket.js";

const IN_PROGRESS = getStatusCode("in_progress");
const FINISHED = getStatusCode("finished");
const silentLogger = { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} };

// Session 57, created by teacher 7, is in progress on phase 20, a semantic
// differential phase with chat and question 30; its groups 9 and 10 belong
// to phase 20 and group 11 to phase 21. Session 58, created by teacher 8, is
// in progress on phase 40, with group 12 and question 50.
function createWorld() {
    const sessions = new Map([
        [57, { creator: 7, currentStage: 20, status: IN_PROGRESS }],
        [58, { creator: 8, currentStage: 40, status: IN_PROGRESS }],
    ]);
    const phases = new Map([
        [20, { session: 57, chat: true, questions: [30] }],
        [21, { session: 57, chat: true, questions: [31] }],
        [40, { session: 58, chat: true, questions: [50] }],
    ]);
    const groups = new Map([
        [9, { phase: 20, members: [44, 45] }],
        [10, { phase: 20, members: [46] }],
        [11, { phase: 21, members: [44] }],
        [12, { phase: 40, members: [60] }],
    ]);
    const statements = [];

    async function query({ sql, sqlParams }) {
        statements.push(sql);
        if (sql !== GROUP_CHAT_ACCESS_SQL) {
            throw new Error(`Unexpected statement: ${sql}`);
        }

        const [groupId, phaseId, questionId, userId] = sqlParams;
        const group = groups.get(groupId);
        if (!group || (phaseId !== null && group.phase !== phaseId)) {
            return [];
        }
        const phase = phases.get(group.phase);
        const session = sessions.get(phase.session);
        return [{
            group_id:                  groupId,
            phase_id:                  group.phase,
            session_id:                phase.session,
            creator:                   session.creator,
            current_stage:             session.currentStage,
            status:                    session.status,
            chat:                      phase.chat,
            is_group_member:           group.members.includes(userId),
            question_belongs_to_phase: phase.questions.includes(questionId),
        }];
    }

    return {
        sessions,
        phases,
        statements,
        checkAccess: request => resolveOpenGroupChatContext(request, {
            query,
            loadDesignType: async () => "semantic_differential",
        }),
        // The teacher's label needs no read; a participant's read would fail
        // the test.
        resolveLabel: author => resolveChatAuthorLabel(author, {
            loadIdentity: async () => {
                throw new Error("The teacher's label reads nothing.");
            },
        }),
    };
}

// A /teacher socket whose server reaches the /student namespace. Every emit
// is recorded with its namespace and room.
function createFakeTeacherSocket(uid) {
    const handlers = new Map();
    const emitted = [];
    const roomOf = namespace => room => ({
        emit: (event, payload) => emitted.push({ namespace, room, event, payload }),
    });
    const server = {
        of: namespace => ({ to: roomOf(namespace) }),
    };
    return {
        id:   `teacher-socket-${uid}`,
        data: { uid },
        nsp:  { name: "/teacher", server },
        emitted,
        on(event, handler) {
            handlers.set(event, handler);
        },
        join() {},
        leave() {},
        to:   roomOf("/teacher (from the socket)"),
        emit: (event, payload) => emitted.push({ namespace: "/teacher (to the socket)", event, payload }),
        receive(event, ...args) {
            handlers.get(event)?.(...args);
        },
    };
}

function connectTeacher({ uid = 7, world = createWorld(), clock = { now: 1762959845000 }, composing = {} } = {}) {
    const socket = createFakeTeacherSocket(uid);
    createTeacherSocketInit({
        access:    {},
        logger:    silentLogger,
        composing: {
            checkAccess:  world.checkAccess,
            resolveLabel: world.resolveLabel,
            now:          () => clock.now,
            ...composing,
        },
    })(socket);
    return { socket, world, clock };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

const SIGNAL = Object.freeze({ phaseId: 20, questionId: 30, groupId: 9, kind: "composing" });

function notices(socket) {
    return socket.emitted.filter(({ event }) => event === "onChatComposing");
}

describe("chatComposing on the teacher socket", () => {
    describe("who can signal", () => {
        it("the activity's teacher in the group's open chat notifies the group's participants", async () => {
            const { socket } = connectTeacher();

            socket.receive("chatComposing", { ...SIGNAL });
            await settle();

            assert.deepEqual(socket.emitted, [{
                namespace: "/student",
                room:      "group-9",
                event:     "onChatComposing",
                payload:   { groupId: 9, questionId: 30, userId: 7, role: "P", name: null, kind: "composing" },
            }]);
        });

        it("a teacher who does not own the activity produces no notice", async () => {
            const { socket } = connectTeacher({ uid: 8 });
            socket.receive("chatComposing", { ...SIGNAL });
            await settle();
            assert.deepEqual(socket.emitted, []);
        });

        it("a group of another activity, of another phase or unknown produces no notice", async () => {
            const { socket } = connectTeacher();
            socket.receive("chatComposing", { phaseId: 40, questionId: 50, groupId: 12, kind: "composing" });
            socket.receive("chatComposing", { ...SIGNAL, groupId: 12 });
            socket.receive("chatComposing", { ...SIGNAL, groupId: 11 });
            socket.receive("chatComposing", { ...SIGNAL, groupId: 13 });
            socket.receive("chatComposing", { ...SIGNAL, questionId: 31 });
            await settle();
            assert.deepEqual(socket.emitted, []);
        });

        it("a chat that does not accept messages produces no notice, right after an automatic advance too", async () => {
            const { socket, world } = connectTeacher();

            world.phases.get(20).chat = false;
            socket.receive("chatComposing", { ...SIGNAL });
            await settle();
            world.phases.get(20).chat = true;

            // The deadline runner (#1105) started phase 21.
            world.sessions.get(57).currentStage = 21;
            socket.receive("chatComposing", { ...SIGNAL });
            await settle();
            world.sessions.get(57).currentStage = 20;

            world.sessions.get(57).status = FINISHED;
            socket.receive("chatComposing", { ...SIGNAL });
            await settle();

            assert.deepEqual(socket.emitted, []);
            assert.equal(world.statements.length, 3, "access is read on every signal");
        });
    });

    describe("the group notice", () => {
        it("carries the teacher's id, role P and a null name, for composing and stopped", async () => {
            const { socket } = connectTeacher();
            socket.receive("chatComposing", { ...SIGNAL });
            socket.receive("chatComposing", { ...SIGNAL, kind: "stopped" });
            await settle();

            assert.deepEqual(notices(socket).map(({ payload }) => payload), [
                { groupId: 9, questionId: 30, userId: 7, role: "P", name: null, kind: "composing" },
                { groupId: 9, questionId: 30, userId: 7, role: "P", name: null, kind: "stopped" },
            ]);
        });

        it("goes only to the participants' room of the group, never to the teacher's namespace", async () => {
            const { socket } = connectTeacher();
            socket.receive("chatComposing", { ...SIGNAL });
            socket.receive("chatComposing", { ...SIGNAL, groupId: 10 });
            await settle();

            assert.deepEqual(socket.emitted.map(({ namespace, room }) => [namespace, room]), [
                ["/student", "group-9"],
                ["/student", "group-10"],
            ]);
        });
    });

    describe("side effects", () => {
        it("never forward to AI services, even when a forwarder is passed", async () => {
            const forwarded = [];
            const { socket } = connectTeacher({
                composing: {
                    activity: {
                        forward: async signal => forwarded.push(signal),
                        forget:  participant => forwarded.push(participant),
                    },
                },
            });

            socket.receive("chatComposing", { ...SIGNAL });
            await settle();
            socket.receive("disconnect", "transport close");
            await settle();

            assert.equal(notices(socket).length, 2);
            assert.deepEqual(forwarded, []);
        });

        it("read only the access, and never write to the database", async () => {
            const { socket, world } = connectTeacher();
            socket.receive("chatComposing", { ...SIGNAL });
            await settle();
            socket.receive("disconnect", "transport close");
            await settle();

            assert.deepEqual(world.statements, [GROUP_CHAT_ACCESS_SQL]);
            assert.doesNotMatch(GROUP_CHAT_ACCESS_SQL, /\b(INSERT|UPDATE|DELETE)\b/iu);
        });

        it("drop payloads with content, text, length or other extra fields before any read", async () => {
            const { socket, world } = connectTeacher();
            for (const extra of [{ content: "draft" }, { text: "draft" }, { length: 12 }, { userId: 8 }]) {
                socket.receive("chatComposing", { ...SIGNAL, ...extra });
            }
            socket.receive("chatComposing", { ...SIGNAL, kind: "typing" });
            socket.receive("chatComposing", "composing");
            await settle();

            assert.deepEqual(socket.emitted, []);
            assert.deepEqual(world.statements, []);
        });
    });

    describe("the rate limit", () => {
        it("drops the 21st signal within a minute on one socket", async () => {
            const { socket, world, clock } = connectTeacher();
            const start = clock.now;
            for (let index = 0; index < 21; index += 1) {
                clock.now = start + index * 100;
                socket.receive("chatComposing", { ...SIGNAL, kind: index % 2 === 0 ? "composing" : "stopped" });
            }
            await settle();

            assert.equal(notices(socket).length, 20);
            assert.equal(world.statements.length, 20, "the 21st is not even checked");

            clock.now = start + 60000;
            socket.receive("chatComposing", { ...SIGNAL });
            await settle();
            assert.equal(notices(socket).length, 21, "the window slides");
        });
    });

    describe("disconnects", () => {
        it("tell the group `stopped` when the teacher was composing", async () => {
            const { socket, world } = connectTeacher();
            socket.receive("chatComposing", { ...SIGNAL });
            await settle();
            const statementsBefore = world.statements.length;

            socket.receive("disconnect", "transport close");
            await settle();

            assert.deepEqual(notices(socket).map(({ namespace, room, payload }) =>
                [namespace, room, payload.kind, payload.role, payload.name]), [
                ["/student", "group-9", "composing", "P", null],
                ["/student", "group-9", "stopped", "P", null],
            ]);
            assert.equal(world.statements.length, statementsBefore, "nothing is read");
        });

        it("send nothing when the teacher already stopped, and drop later signals", async () => {
            const { socket } = connectTeacher();
            socket.receive("chatComposing", { ...SIGNAL });
            socket.receive("chatComposing", { ...SIGNAL, kind: "stopped" });
            await settle();
            socket.receive("disconnect", "transport close");
            socket.receive("chatComposing", { ...SIGNAL });
            await settle();

            assert.deepEqual(notices(socket).map(({ payload }) => payload.kind), ["composing", "stopped"]);
        });
    });
});
