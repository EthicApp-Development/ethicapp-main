// The composing signal on the student socket (epic #601, #655), with a fake
// socket, a fake database query, a fake registry and a fake clock: who may
// signal, the group notice, the coalesced dispatch to AI services, the rate
// limit, disconnects and the absence of side effects.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getStatusCode } from "../../../common/modules/session-status.js";
import { resolveChatAuthorLabel, loadChatAuthorIdentity } from "../../helpers/chat-author-label.js";
import {
    createParticipantActivityCoalescer,
    createParticipantActivityForwarder,
} from "../../helpers/participant-activity-helper.js";
import { GROUP_CHAT_ACCESS_SQL, resolveOpenGroupChatContext } from "../../helpers/group-chat-access.js";
import { ExternalServicesRegistry } from "../../services/external-services.service.js";
import { registerChatComposing } from "../chat-composing.js";
import { createStudentSocketInit } from "../student.socket.js";

const IN_PROGRESS = getStatusCode("in_progress");
const silentLogger = { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} };

// Session 57 (teacher 7) is in progress on phase 20, a semantic differential
// phase with chat and question 30. Group 9 of phase 20 has students 44 and
// 45; group 10 of phase 20 has student 46; group 11 belongs to phase 21.
function createWorld({ anonymous = false } = {}) {
    const state = { currentStage: 20, status: IN_PROGRESS, chat: true, anonymous };
    const groups = new Map([
        [9, { phase: 20, members: [44, 45] }],
        [10, { phase: 20, members: [46] }],
        [11, { phase: 21, members: [44] }],
    ]);
    const users = new Map([
        [44, { firstname: "Ana", lastname: "Rojas", name: "ana", anon_mask: "Fox" }],
        [45, { firstname: "Beto", lastname: "Soto", name: "beto", anon_mask: "Owl" }],
        [46, { firstname: "Carla", lastname: "Vera", name: "carla", anon_mask: null }],
    ]);
    const statements = [];

    const plain = value => (typeof value === "string" ? JSON.parse(value).name : value);

    async function query({ sql, sqlParams }) {
        statements.push(sql);
        const params = sqlParams.map(plain);

        if (sql === GROUP_CHAT_ACCESS_SQL) {
            const [groupId, phaseId, questionId, userId] = params;
            const group = groups.get(groupId);
            if (!group || (phaseId !== null && group.phase !== phaseId)) {
                return [];
            }
            return [{
                group_id:                  groupId,
                phase_id:                  group.phase,
                session_id:                57,
                creator:                   7,
                current_stage:             state.currentStage,
                status:                    state.status,
                chat:                      state.chat,
                is_group_member:           group.members.includes(userId),
                question_belongs_to_phase: questionId === 30 && group.phase === 20,
            }];
        }

        if (/FROM teamusers AS tu\s+INNER JOIN users AS u/u.test(sql)) {
            const [groupId, userId] = params;
            if (!groups.get(groupId)?.members.includes(userId)) {
                return [];
            }
            return [{ ...users.get(userId), phase_anonymous: state.anonymous }];
        }

        throw new Error(`Unexpected statement: ${sql}`);
    }

    return {
        state,
        statements,
        checkAccess: request => resolveOpenGroupChatContext(request, {
            query,
            loadDesignType: async () => "semantic_differential",
        }),
        resolveLabel: author => resolveChatAuthorLabel(author, {
            loadIdentity: member => loadChatAuthorIdentity(member, query),
        }),
    };
}

function createFakeSocket(uid) {
    const handlers = new Map();
    const emitted = [];
    return {
        id:   `socket-${uid}`,
        data: { uid },
        emitted,
        on(event, handler) {
            handlers.set(event, handler);
        },
        join() {},
        leave() {},
        // A broadcast to the room from this socket, which excludes it.
        to(room) {
            return {
                emit: (event, payload) => emitted.push({ room, event, payload, from: `socket-${uid}` }),
            };
        },
        receive(event, ...args) {
            handlers.get(event)?.(...args);
        },
    };
}

function createFakeDispatch() {
    const calls = [];
    return {
        calls,
        dispatchEphemeralHook: async (hookName, context, options) => {
            calls.push({ hookName, context, options });
            return [];
        },
    };
}

// The student socket with the world's database, a fake dispatch and a fake
// clock. Signals are handled with promises only, so one macrotask drains them.
function connectStudent({
    uid = 44,
    world = createWorld(),
    clock = { now: 1762959845000 },
    dispatch = createFakeDispatch(),
    enabledServiceIds = ["polyadic-agent"],
    phaseServiceReads = [],
    participantActivity,
} = {}) {
    const now = () => clock.now;
    const activity = participantActivity ?? createParticipantActivityForwarder({
        coalescer:         createParticipantActivityCoalescer({ now }),
        loadPhaseServices: async (phaseId) => {
            phaseServiceReads.push(phaseId);
            return { enabledServiceIds, configurations: {} };
        },
        dispatchEphemeralHook: dispatch.dispatchEphemeralHook,
        logger:                silentLogger,
    });
    const socket = createFakeSocket(uid);
    createStudentSocketInit({
        access:              {},
        logger:              silentLogger,
        participantActivity: activity,
        composing:           {
            checkAccess:  world.checkAccess,
            resolveLabel: world.resolveLabel,
            now,
        },
    })(socket);
    return { socket, world, clock, dispatch, phaseServiceReads, activity };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

const SIGNAL = Object.freeze({ phaseId: 20, questionId: 30, groupId: 9, kind: "composing" });

function notices(socket) {
    return socket.emitted.filter(({ event }) => event === "onChatComposing");
}

describe("chatComposing on the student socket", () => {
    describe("who can signal", () => {
        it("a member of the group in the phase's open chat notifies the group and the services", async () => {
            const { socket, dispatch } = connectStudent();

            socket.receive("chatComposing", { ...SIGNAL });
            await settle();

            assert.deepEqual(notices(socket), [{
                room:    "group-9",
                event:   "onChatComposing",
                payload: { groupId: 9, questionId: 30, userId: 44, role: "A", name: "Ana Rojas", kind: "composing" },
                from:    "socket-44",
            }]);
            assert.equal(dispatch.calls.length, 1);
        });

        it("a socket whose user is not a member of the group produces no notice and no dispatch", async () => {
            const { socket, dispatch } = connectStudent({ uid: 46 });
            socket.receive("chatComposing", { ...SIGNAL });
            await settle();
            assert.deepEqual(notices(socket), []);
            assert.equal(dispatch.calls.length, 0);
        });

        it("a group of another phase, an unknown group or a question of another phase produces nothing", async () => {
            const { socket, dispatch } = connectStudent();
            socket.receive("chatComposing", { ...SIGNAL, groupId: 11 });
            socket.receive("chatComposing", { ...SIGNAL, groupId: 12 });
            socket.receive("chatComposing", { ...SIGNAL, questionId: 31 });
            socket.receive("chatComposing", { ...SIGNAL, phaseId: 21 });
            await settle();
            assert.deepEqual(notices(socket), []);
            assert.equal(dispatch.calls.length, 0);
        });

        it("a chat that no longer accepts messages produces nothing, right after an automatic advance too", async () => {
            const { socket, world, dispatch } = connectStudent();

            socket.receive("chatComposing", { ...SIGNAL });
            await settle();
            assert.equal(notices(socket).length, 1);

            // The deadline runner starts phase 21 between two signals.
            world.state.currentStage = 21;
            socket.receive("chatComposing", { ...SIGNAL });
            socket.receive("chatComposing", { ...SIGNAL, kind: "stopped" });
            await settle();
            assert.equal(notices(socket).length, 1, "no notice for the closed chat");
            assert.equal(dispatch.calls.length, 1);

            world.state.currentStage = 20;
            for (const change of [{ chat: false }, { status: getStatusCode("finished") }]) {
                Object.assign(world.state, { chat: true, status: IN_PROGRESS }, change);
                socket.receive("chatComposing", { ...SIGNAL });
                await settle();
                assert.equal(notices(socket).length, 1, JSON.stringify(change));
            }
        });

        it("checks access on every signal, without caching it", async () => {
            const { socket, world } = connectStudent();
            socket.receive("chatComposing", { ...SIGNAL });
            socket.receive("chatComposing", { ...SIGNAL });
            socket.receive("chatComposing", { ...SIGNAL, kind: "stopped" });
            await settle();
            assert.equal(world.statements.filter(sql => sql === GROUP_CHAT_ACCESS_SQL).length, 3);
        });
    });

    describe("the group notice", () => {
        it("goes to the group's room from the sender's socket, so the sender and other groups do not get it", async () => {
            const { socket } = connectStudent();
            socket.receive("chatComposing", { ...SIGNAL });
            socket.receive("chatComposing", { ...SIGNAL, kind: "stopped" });
            await settle();

            assert.deepEqual(notices(socket).map(({ room, from, payload }) => [room, from, payload.kind]), [
                ["group-9", "socket-44", "composing"],
                ["group-9", "socket-44", "stopped"],
            ]);
            assert.equal(socket.emitted.length, 2, "nothing is emitted to the sender itself");
        });

        it("carries the mask, and no real name, in an anonymous phase", async () => {
            const { socket } = connectStudent({ world: createWorld({ anonymous: true }) });
            socket.receive("chatComposing", { ...SIGNAL });
            await settle();

            const [{ payload }] = notices(socket);
            assert.equal(payload.name, "Fox");
            const serialized = JSON.stringify(socket.emitted);
            for (const realName of ["Ana", "Rojas", "ana"]) {
                assert.equal(serialized.includes(realName), false, realName);
            }
        });

        it("carries a null name for an anonymous participant without a mask", async () => {
            const world = createWorld({ anonymous: true });
            const { socket } = connectStudent({ uid: 46, world });
            socket.receive("chatComposing", { ...SIGNAL, groupId: 10 });
            await settle();
            assert.equal(notices(socket)[0].payload.name, null);
        });

        it("keeps the order the writer sent the signals in", async () => {
            const { socket } = connectStudent();
            for (const kind of ["composing", "stopped", "composing", "stopped"]) {
                socket.receive("chatComposing", { ...SIGNAL, kind });
            }
            await settle();
            assert.deepEqual(notices(socket).map(({ payload }) => payload.kind),
                ["composing", "stopped", "composing", "stopped"]);
        });
    });

    describe("dispatch to services", () => {
        it("sends the ephemeral hook the contract's fields with the server's receipt time", async () => {
            const { socket, dispatch, phaseServiceReads } = connectStudent();
            socket.receive("chatComposing", { ...SIGNAL });
            await settle();

            assert.deepEqual(phaseServiceReads, [20]);
            assert.deepEqual(dispatch.calls, [{
                hookName: "participant-activity",
                context:  {
                    kind:       "composing",
                    sessionId:  57,
                    phaseId:    20,
                    questionId: 30,
                    groupId:    9,
                    userId:     44,
                    receivedAt: 1762959845000,
                },
                options: { enabledServiceIds: ["polyadic-agent"] },
            }]);
        });

        it("turns a burst of composing into at most one dispatch every 12 s, and forwards a stopped once", async () => {
            const { socket, clock, dispatch } = connectStudent();
            const start = clock.now;

            for (let second = 0; second < 20; second += 2) {
                clock.now = start + second * 1000;
                socket.receive("chatComposing", { ...SIGNAL });
                await settle();
            }
            socket.receive("chatComposing", { ...SIGNAL, kind: "stopped" });
            socket.receive("chatComposing", { ...SIGNAL, kind: "stopped" });
            await settle();

            assert.equal(notices(socket).length, 12, "the group follows every signal");
            assert.deepEqual(dispatch.calls.map(({ context }) => [context.kind, context.receivedAt - start]), [
                ["composing", 0],
                ["composing", 12000],
                ["stopped", 18000],
            ]);
        });

        it("coalesces per participant and question", async () => {
            const world = createWorld();
            const dispatch = createFakeDispatch();
            const clock = { now: 0 };
            const now = () => clock.now;
            const shared = createParticipantActivityForwarder({
                coalescer:             createParticipantActivityCoalescer({ now }),
                loadPhaseServices:     async () => ({ enabledServiceIds: ["polyadic-agent"] }),
                dispatchEphemeralHook: dispatch.dispatchEphemeralHook,
                logger:                silentLogger,
            });
            const ana = connectStudent({ uid: 44, world, clock, participantActivity: shared });
            const beto = connectStudent({ uid: 45, world, clock, participantActivity: shared });

            ana.socket.receive("chatComposing", { ...SIGNAL });
            beto.socket.receive("chatComposing", { ...SIGNAL });
            ana.socket.receive("chatComposing", { ...SIGNAL });
            await settle();

            assert.deepEqual(dispatch.calls.map(({ context }) => context.userId), [44, 45]);
        });

        it("dispatches nothing when the phase enables no service or the session's services are off", async () => {
            const { socket, dispatch } = connectStudent({ enabledServiceIds: [] });
            socket.receive("chatComposing", { ...SIGNAL });
            await settle();
            assert.equal(notices(socket).length, 1);
            assert.equal(dispatch.calls.length, 0);
        });

        it("sends the notice before the dispatch, and a failed dispatch affects neither", async () => {
            const order = [];
            const errors = [];
            const world = createWorld();
            const socket = createFakeSocket(44);
            const originalTo = socket.to.bind(socket);
            socket.to = room => ({
                emit: (event, payload) => {
                    order.push("notice");
                    originalTo(room).emit(event, payload);
                },
            });
            const registration = registerChatComposing(socket, {
                role:         "A",
                emitNotice:   (groupId, notice) => socket.to(`group-${groupId}`).emit("onChatComposing", notice),
                checkAccess:  world.checkAccess,
                resolveLabel: world.resolveLabel,
                activity:     {
                    forward: async () => {
                        order.push("dispatch");
                        throw new Error("service down");
                    },
                    forget: () => {},
                },
                logger: { error: (...args) => errors.push(args) },
            });

            socket.receive("chatComposing", { ...SIGNAL });
            await registration.idle();
            socket.receive("chatComposing", { ...SIGNAL, kind: "stopped" });
            await registration.idle();

            assert.deepEqual(order, ["notice", "dispatch", "notice", "dispatch"]);
            assert.equal(errors.length, 2);
            assert.deepEqual(Object.keys(errors[0][1]).sort(), ["error", "groupId", "phaseId", "userId"]);
        });

        it("reaches only enabled, subscribed services the policy allows, through the registry", async () => {
            const delivered = [];
            const jobsCalls = [];
            const registry = new ExternalServicesRegistry({
                jobsService: new Proxy({}, {
                    get: (target, name) => async (...args) => {
                        jobsCalls.push({ name, args });
                        return { id: "job-should-not-exist" };
                    },
                }),
                developmentAdapters:     true,
                isAiAdditionsConfigured: async () => true,
                aiServicePolicy:         {
                    getCurrentPolicyVersion:   async () => ({ id: 2, allowedServiceIds: ["polyadic-agent"] }),
                    getPolicyVersion:          async () => ({ id: 2, allowedServiceIds: ["polyadic-agent"] }),
                    getSessionPolicyVersionId: async () => 2,
                },
            });
            registry.initialized = true;
            // svc-polyadic: enabled, subscribed and allowed. svc-analyst:
            // enabled and subscribed, but the policy does not allow it.
            // svc-chat: enabled, without the hook. svc-elsewhere: subscribed
            // and allowed, but not enabled for the phase.
            for (const [id, requires, hooks] of [
                ["svc-polyadic", ["polyadic-agent"], ["participant-activity"]],
                ["svc-analyst", ["case-analyst"], ["participant-activity"]],
                ["svc-chat", ["polyadic-agent"], ["chat-message-received"]],
                ["svc-elsewhere", ["polyadic-agent"], ["participant-activity"]],
            ]) {
                registry.services.set(id, {
                    id, development: false, requires, hooks, globalHooks: [], scopes: ["chat"],
                });
            }
            for (const serviceId of ["svc-polyadic", "svc-analyst", "svc-elsewhere"]) {
                registry.subscribe(serviceId, "participant-activity", async (context) => {
                    delivered.push({ serviceId, context });
                });
            }
            registry.subscribe("svc-chat", "chat-message-received", async () => {
                delivered.push({ serviceId: "svc-chat" });
            });

            const { socket } = connectStudent({
                enabledServiceIds: ["svc-polyadic", "svc-analyst", "svc-chat"],
                dispatch:          {
                    dispatchEphemeralHook: (...args) => registry.dispatchEphemeralHook(...args),
                },
            });
            socket.receive("chatComposing", { ...SIGNAL });
            await settle();
            await settle();

            assert.deepEqual(delivered.map(({ serviceId }) => serviceId), ["svc-polyadic"]);
            assert.deepEqual(Object.keys(delivered[0].context).sort(), [
                "groupId", "kind", "phaseId", "questionId", "receivedAt", "serviceId", "sessionId",
                "ttlSeconds", "userId",
            ]);
            assert.equal(delivered[0].context.ttlSeconds, 30);
            assert.deepEqual(jobsCalls, [], "no job is created or read");
        });
    });

    describe("disconnects", () => {
        it("tell the group `stopped` for every chat the writer was still composing in", async () => {
            const { socket, world } = connectStudent();
            socket.receive("chatComposing", { ...SIGNAL });
            socket.receive("chatComposing", { ...SIGNAL });
            await settle();
            const statementsBefore = world.statements.length;

            socket.receive("disconnect", "transport close");
            await settle();

            assert.deepEqual(notices(socket).map(({ room, payload }) => [room, payload.kind, payload.name]), [
                ["group-9", "composing", "Ana Rojas"],
                ["group-9", "composing", "Ana Rojas"],
                ["group-9", "stopped", "Ana Rojas"],
            ]);
            assert.equal(world.statements.length, statementsBefore, "the stored label is reused");
        });

        it("send nothing for a writer who already stopped", async () => {
            const { socket } = connectStudent();
            socket.receive("chatComposing", { ...SIGNAL });
            socket.receive("chatComposing", { ...SIGNAL, kind: "stopped" });
            await settle();
            socket.receive("disconnect", "transport close");
            await settle();
            assert.deepEqual(notices(socket).map(({ payload }) => payload.kind), ["composing", "stopped"]);
        });

        it("drop the writer's coalescing state, so their next composing reaches the services at once", async () => {
            const world = createWorld();
            const dispatch = createFakeDispatch();
            const clock = { now: 0 };
            const shared = createParticipantActivityForwarder({
                coalescer:             createParticipantActivityCoalescer({ now: () => clock.now }),
                loadPhaseServices:     async () => ({ enabledServiceIds: ["polyadic-agent"] }),
                dispatchEphemeralHook: dispatch.dispatchEphemeralHook,
                logger:                silentLogger,
            });
            const first = connectStudent({ world, clock, participantActivity: shared });
            first.socket.receive("chatComposing", { ...SIGNAL });
            await settle();
            first.socket.receive("disconnect", "transport close");
            await settle();

            clock.now = 1000;
            const second = connectStudent({ world, clock, participantActivity: shared });
            second.socket.receive("chatComposing", { ...SIGNAL });
            await settle();

            assert.deepEqual(dispatch.calls.map(({ context }) => context.kind), ["composing", "composing"]);
        });

        it("drop signals that arrive after the disconnect, and one still being checked", async () => {
            let releaseAccess;
            const world = createWorld();
            const socket = createFakeSocket(44);
            const dispatch = createFakeDispatch();
            const registration = registerChatComposing(socket, {
                role:        "A",
                emitNotice:  (groupId, notice) => socket.to(`group-${groupId}`).emit("onChatComposing", notice),
                checkAccess: request => new Promise((resolve) => {
                    releaseAccess = () => resolve(world.checkAccess(request));
                }),
                resolveLabel: world.resolveLabel,
                activity:     createParticipantActivityForwarder({
                    loadPhaseServices:     async () => ({ enabledServiceIds: ["polyadic-agent"] }),
                    dispatchEphemeralHook: dispatch.dispatchEphemeralHook,
                    logger:                silentLogger,
                }),
            });

            socket.receive("chatComposing", { ...SIGNAL });
            await settle();
            socket.receive("disconnect", "transport close");
            socket.receive("chatComposing", { ...SIGNAL });
            releaseAccess();
            await registration.idle();

            assert.deepEqual(socket.emitted, []);
            assert.equal(dispatch.calls.length, 0);
        });
    });

    describe("the rate limit", () => {
        it("drops the 21st signal within a minute on one socket", async () => {
            const { socket, world, clock } = connectStudent();
            const start = clock.now;
            for (let index = 0; index < 21; index += 1) {
                clock.now = start + index * 100;
                socket.receive("chatComposing", { ...SIGNAL, kind: index % 2 === 0 ? "composing" : "stopped" });
            }
            await settle();

            assert.equal(notices(socket).length, 20);
            assert.equal(world.statements.filter(sql => sql === GROUP_CHAT_ACCESS_SQL).length, 20,
                "the 21st is not even checked");

            clock.now = start + 60000;
            socket.receive("chatComposing", { ...SIGNAL });
            await settle();
            assert.equal(notices(socket).length, 21, "the window slides");
        });

        it("counts refused payloads too", async () => {
            const { socket } = connectStudent();
            for (let index = 0; index < 20; index += 1) {
                socket.receive("chatComposing", { ...SIGNAL, content: "draft" });
            }
            socket.receive("chatComposing", { ...SIGNAL });
            await settle();
            assert.equal(notices(socket).length, 0);
        });
    });

    describe("bad payloads and side effects", () => {
        it("drop payloads with content, text, length or other extra fields before any read", async () => {
            const { socket, world, dispatch } = connectStudent();
            for (const extra of [{ content: "draft" }, { text: "draft" }, { length: 12 }, { userId: 45 }]) {
                socket.receive("chatComposing", { ...SIGNAL, ...extra });
            }
            socket.receive("chatComposing", { ...SIGNAL, kind: "typing" });
            socket.receive("chatComposing", { ...SIGNAL, groupId: "9" });
            socket.receive("chatComposing", "composing");
            socket.receive("chatComposing");
            await settle();

            assert.deepEqual(socket.emitted, []);
            assert.deepEqual(world.statements, []);
            assert.equal(dispatch.calls.length, 0);
        });

        it("read only, and never write to the database", async () => {
            const { socket, world } = connectStudent();
            socket.receive("chatComposing", { ...SIGNAL });
            await settle();
            socket.receive("disconnect", "transport close");
            await settle();

            assert.ok(world.statements.length > 0);
            for (const sql of world.statements) {
                assert.match(sql, /^\s*SELECT\b/u);
                assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE)\b/iu);
            }
        });

        it("log a failed check with ids only, and keep handling the next signals", async () => {
            const errors = [];
            const world = createWorld();
            const socket = createFakeSocket(44);
            let failNext = true;
            const registration = registerChatComposing(socket, {
                role:        "A",
                emitNotice:  (groupId, notice) => socket.to(`group-${groupId}`).emit("onChatComposing", notice),
                checkAccess: async (request) => {
                    if (failNext) {
                        failNext = false;
                        throw new Error("database unavailable");
                    }
                    return world.checkAccess(request);
                },
                resolveLabel: world.resolveLabel,
                logger:       { error: (...args) => errors.push(args) },
            });

            socket.receive("chatComposing", { ...SIGNAL });
            socket.receive("chatComposing", { ...SIGNAL });
            await registration.idle();

            assert.equal(errors.length, 1);
            assert.deepEqual(Object.keys(errors[0][1]).sort(), ["error", "groupId", "phaseId", "userId"]);
            assert.equal(notices(socket).length, 1);
        });
    });
});
