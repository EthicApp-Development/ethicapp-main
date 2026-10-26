import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { ExternalServicesRegistry } from "../external-services.service.js";
import {
    ExternalServiceJobsService,
    JOB_KIND,
    JOB_STATUS,
    RESULT_STATUS,
} from "../external-service-jobs.service.js";
import {
    createRoomJobsAccess,
    ExternalServiceRoomJobsService,
} from "../external-service-room-jobs.service.js";
import {
    getCallbackTarget,
    register as registerPolyadic,
} from "../../external-services/adapters/polyadic-bridge.adapter.js";

// Room-scoped jobs for proactive Polyadic callbacks (#833), end to end with
// fakes: the Polyadic adapter creates rooms through a fake AI Additions
// client, its room jobs are stored by the real jobs and room jobs services
// over an in-memory stand-in for the two tables, and callbacks go through the
// registry's dispatchServiceHook().

const SERVICE_ID = "svc-polyadic";
const normalize = sql => sql.replace(/\s+/g, " ").trim();
const tick = () => new Promise(resolve => setImmediate(resolve));
const LIVE = ["pending", "open"];

// The statements of ExternalServiceJobsService and
// ExternalServiceRoomJobsService, each run atomically after yielding to the
// event loop, so concurrent requests interleave between statements as they
// would against Postgres. `beforeClaim` runs right before a claim statement.
function makeDatabase() {
    const jobs = [];
    const results = [];
    let clock = 0;
    const database = { jobs, results, beforeClaim: null };

    const sameRoom = (left, right) => left.service_id === right.service_id
        && left.session_id === right.session_id
        && left.phase_id === right.phase_id
        && left.group_id === right.group_id;

    database.dbQuery = async (sql, params = []) => {
        await tick();
        const text = normalize(sql);

        // ExternalServiceJobsService.createResult()
        if (text.startsWith("SELECT id, status, session_id")) {
            return jobs.filter(job => job.id === params[0] && job.service_id === params[1])
                .map(job => ({ ...job }));
        }
        if (text.startsWith("SELECT 1 FROM external_service_jobs")) {
            return jobs.filter(job => job.id === params[0]).map(() => ({ "?column?": 1 }));
        }
        if (text.startsWith("INSERT INTO external_service_results")) {
            const [jobId, correlationId, serviceId, hookName, status] = params;
            const eventId = params[11];
            if (eventId !== null && results.some(row => row.service_id === serviceId
                && row.event_id === eventId)) {
                return [];
            }
            const row = {
                id:             randomUUID(),
                job_id:         jobId,
                correlation_id: correlationId,
                service_id:     serviceId,
                hook_name:      hookName,
                status,
                event_id:       eventId,
            };
            results.push(row);
            return [{ ...row }];
        }
        if (text.startsWith("SELECT id, job_id, correlation_id, service_id, hook_name, status")) {
            return results.filter(row => row.service_id === params[0] && row.event_id === params[1])
                .map(row => ({ ...row }));
        }

        // ExternalServiceJobsService.claimResult()
        if (text.startsWith("UPDATE external_service_results SET status = $2, job_id = $3")) {
            await database.beforeClaim?.();
            const [id, status, jobId, correlationId, pending, kind, liveStatuses] = params;
            const row = results.find(candidate => candidate.id === id && candidate.status === pending);
            const roomCondition = text.includes("EXISTS");
            if (!row || (roomCondition && !jobs.some(job => job.id === jobId
                && job.kind === kind && liveStatuses.includes(job.status)))) {
                return [];
            }
            Object.assign(row, { status, job_id: jobId, correlation_id: correlationId });
            return [{ ...row }];
        }
        if (text.startsWith("SELECT status FROM external_service_results WHERE id = $1")) {
            return results.filter(row => row.id === params[0]).map(row => ({ status: row.status }));
        }
        if (text.startsWith("UPDATE external_service_results SET status = $2")) {
            const row = results.find(candidate => candidate.id === params[0]);
            if (row) {
                row.status = params[1];
            }
            return [];
        }
        // Hook jobs: updateJobStatus(), claimResult() advancing a hook job, and
        // createJob() from dispatchHook().
        if (text.startsWith("UPDATE external_service_jobs SET status = $2, updated_at = now()")) {
            const job = jobs.find(candidate => candidate.id === params[0]);
            if (job) {
                job.status = params[1];
            }
            return [];
        }
        if (text.startsWith("INSERT INTO external_service_jobs (id, service_id")) {
            const [serviceId, hookName, status, sessionId, phaseId] = params;
            const job = {
                id:         randomUUID(),
                service_id: serviceId,
                hook_name:  hookName,
                kind:       "hook",
                status,
                session_id: sessionId,
                phase_id:   phaseId,
                created_at: ++clock,
            };
            jobs.push(job);
            return [{ ...job }];
        }

        // ExternalServiceRoomJobsService
        if (text.startsWith("INSERT INTO external_service_jobs")) {
            const [serviceId, hookName, kind, status, sessionId, phaseId, questionId, groupId, room] = params;
            const job = {
                id:                 randomUUID(),
                service_id:         serviceId,
                hook_name:          hookName,
                kind,
                status,
                session_id:         sessionId,
                phase_id:           phaseId,
                question_id:        questionId,
                group_id:           groupId,
                user_id:            null,
                provider_reference: room,
                room_bound:         false,
                created_at:         ++clock,
            };
            jobs.push(job);
            return [{ ...job }];
        }
        if (text.startsWith("WITH target AS")) {
            const [jobId, bound, kind, pending, closed, liveStatuses, open] = params;
            const target = jobs.find(job => job.id === jobId && job.kind === kind && job.status === pending);
            if (!target) {
                return [];
            }
            for (const older of jobs) {
                if (older.kind === kind && older.id !== target.id && sameRoom(older, target)
                    && liveStatuses.includes(older.status) && older.created_at <= target.created_at) {
                    older.status = closed;
                }
            }
            Object.assign(target, { status: open, room_bound: bound });
            return [{ id: target.id }];
        }
        // failRoomJob() (from pending) and closeRoomJob() (from any live status).
        if (text.startsWith("UPDATE external_service_jobs SET status = $2, completed_at = now()")) {
            const [jobId, status, kind, from] = params;
            const allowed = Array.isArray(from) ? from : [from];
            const job = jobs.find(candidate => candidate.id === jobId && candidate.kind === kind
                && allowed.includes(candidate.status));
            if (job) {
                job.status = status;
            }
            return [];
        }
        if (text.startsWith("UPDATE external_service_jobs SET status = $4")) {
            const [serviceId, sessionId, phaseId, closed, kind, liveStatuses] = params;
            const closing = jobs.filter(job => job.kind === kind
                && (serviceId === null || job.service_id === serviceId)
                && job.session_id === sessionId && (phaseId === null || job.phase_id === phaseId)
                && liveStatuses.includes(job.status));
            closing.forEach(job => { job.status = closed; });
            return closing.map(job => ({ id: job.id }));
        }
        if (text.startsWith("SELECT EXISTS")) {
            const [serviceId, sessionId, phaseId, groupId, kind, open] = params;
            const bound = jobs.some(job => job.kind === kind && job.status === open && job.room_bound
                && job.service_id === serviceId && job.session_id === sessionId
                && job.phase_id === phaseId && job.group_id === groupId);
            return [{ bound }];
        }
        throw new Error(`Unexpected statement: ${text}`);
    };
    return database;
}

const VERSION = Object.freeze({ id: 2, allowedServiceIds: Object.freeze(["polyadic-agent"]) });
const IN_PROGRESS = 2;

// The policy gate and the verified-destination lookups (#815), over `world`:
// whether the AI Additions connection exists, each session's current phase
// (session 10 is in phase 2), and whether phase state reads fail. Groups 301
// and 302 belong to every phase; every phase enables the adapter.
function makeLookups(world) {
    return {
        policy: {
            getCurrentPolicyVersion:   async () => VERSION,
            getPolicyVersion:          async () => VERSION,
            getSessionPolicyVersionId: async () => 2,
        },
        isAiAdditionsConfigured:    async () => world.connected,
        callbackDestinationLookups: {
            loadPhaseState: async ({ sessionId, groupId }) => {
                if (world.failPhaseState) {
                    throw new Error("database unavailable");
                }
                return Object.hasOwn(world.currentPhase, sessionId)
                    ? {
                        current_stage:     world.currentPhase[sessionId],
                        status:            IN_PROGRESS,
                        launched:          true,
                        group_exists:      [301, 302].includes(groupId),
                        user_participates: false,
                    }
                    : null;
            },
            loadPhaseExternalServices: async () => ({ enabledServiceIds: [SERVICE_ID] }),
        },
    };
}

// `echo(room)` decides whether the fake Polyadic echoes the room correlation
// id; `failRooms` lists rooms whose creation fails. `database` lets a fresh
// registry and adapter (a restarted process) share the tables of another.
async function makeHarness({ echo = () => true, failRooms = [], database = makeDatabase() } = {}) {
    const world = { connected: true, currentPhase: { 10: 2 }, failPhaseState: false };
    const lookups = makeLookups(world);
    const roomJobsService = new ExternalServiceRoomJobsService({ dbQuery: database.dbQuery });
    const registry = new ExternalServicesRegistry({
        jobsService:                new ExternalServiceJobsService({ dbQuery: database.dbQuery }),
        roomJobsService,
        developmentAdapters:        false,
        aiServicePolicy:            lookups.policy,
        isAiAdditionsConfigured:    lookups.isAiAdditionsConfigured,
        callbackDestinationLookups: lookups.callbackDestinationLookups,
    });
    registry.initialized = true;
    registry.services.set(SERVICE_ID, {
        id:          SERVICE_ID,
        development: false,
        requires:    ["polyadic-agent"],
        hooks:       ["phase-started", "chat-message-received", "callback-received", "phase-ended",
            "activity-finished"],
        globalHooks:  [],
        scopes:       ["chat"],
        callbackAuth: null,
    });
    registry.callbackTargetResolvers.set(SERVICE_ID, getCallbackTarget);

    const sessionRequests = [];
    const closeRequests = [];
    const published = [];
    const client = {
        async getEndpoints() {
            return { baseUrl: "http://ai.local" };
        },
        async requestJson(pathname, { method, body }) {
            const room = decodeURIComponent(pathname.split("/")[2]);
            if (method === "DELETE") {
                closeRequests.push(room);
            }
            if (method === "POST" && pathname.endsWith("/sessions")) {
                sessionRequests.push({ room, body });
                await tick();
                if (failRooms.includes(room)) {
                    throw Object.assign(new Error("HTTP 500"), { statusCode: 500 });
                }
                return echo(room)
                    ? { status: "created", ethicapp_room_correlation_id: body.ethicapp_room_correlation_id }
                    : { status: "created" };
            }
            return { status: "ok" };
        },
    };

    await registerPolyadic({
        service:   { id: SERVICE_ID },
        subscribe: (hookName, handler) => registry.subscribe(SERVICE_ID, hookName, handler),
        async publishGroupChatMessage(payload) {
            await tick();
            published.push(payload);
            return { savedMessage: { id: published.length } };
        },
        aiAdditionsClient:          client,
        roomJobs:                   createRoomJobsAccess(roomJobsService, SERVICE_ID),
        polyadicBridgeDependencies: {
            getTeamIdsForPhase:         async () => [301, 302],
            getFirstQuestionIdForPhase: async () => 701,
            getFirstQuestionForPhase:   async () => ({ id: 701, title: "Q", tleft: "", tright: "" }),
            getCaseIdBySessionId:       async () => 51,
            getCaseDocumentRawText:     async () => "Case",
            getParticipantIdentity:     async () => null,
            getSessionLanguageCode:     async () => "es_CL",
        },
    });

    const hookResults = [];
    async function runHook(hookName, context) {
        const [{ handler }] = registry.hookSubscribers.get(hookName);
        await handler({ serviceId: SERVICE_ID, ...context }, {
            callback:            async result => { hookResults.push(result); return result; },
            reportInstantiation: async () => {},
        });
    }

    function callback({ room = "ethicapp-s10-p2-g301", correlationId = null, eventId = randomUUID() } = {}) {
        return registry.dispatchServiceHook("callback-received", SERVICE_ID, {
            correlationId,
            eventId,
            requestPayload: { room, evaluations: [{ agente: "ConversationGuide", respuesta: "Hi" }] },
        });
    }

    // A lifecycle hook as the platform sends it: through the real
    // dispatchHook(), with its policy and connection gate.
    async function dispatch(hookName, context) {
        const handlersBefore = handlerRuns.length;
        await registry.dispatchHook(hookName, context, { enabledServiceIds: [SERVICE_ID] });
        return handlerRuns.length - handlersBefore;
    }

    // Counts the adapter handlers that dispatchHook() actually runs.
    const handlerRuns = [];
    for (const subscribers of registry.hookSubscribers.values()) {
        for (const subscriber of subscribers) {
            const { handler } = subscriber;
            subscriber.handler = (context, tools) => {
                handlerRuns.push(context);
                return handler(context, tools);
            };
        }
    }

    const roomJobOf = room => database.jobs.filter(job => job.provider_reference === room).at(-1);

    return {
        registry,
        database,
        world,
        sessionRequests,
        closeRequests,
        published,
        hookResults,
        runHook,
        dispatch,
        callback,
        roomJobOf,
    };
}

function quietly(fn) {
    return async () => {
        const { warn, error } = console;
        console.warn = () => {};
        console.error = () => {};
        try {
            await fn();
        } finally {
            Object.assign(console, { warn, error });
        }
    };
}

test("room jobs: phase-started opens one room job per room and sends its id to Polyadic", async () => {
    const harness = await makeHarness();
    await harness.runHook("phase-started", { sessionId: 10, phaseId: 2 });

    assert.equal(harness.database.jobs.length, 2);
    for (const [index, room] of ["ethicapp-s10-p2-g301", "ethicapp-s10-p2-g302"].entries()) {
        const job = harness.roomJobOf(room);
        assert.equal(job.kind, JOB_KIND.ROOM);
        assert.equal(job.status, JOB_STATUS.OPEN);
        assert.equal(job.hook_name, "phase-started");
        assert.deepEqual([job.session_id, job.phase_id, job.group_id], [10, 2, 301 + index]);
        assert.equal(harness.sessionRequests[index].room, room);
        assert.equal(harness.sessionRequests[index].body.ethicapp_room_correlation_id, job.id);
    }
});

test("room jobs: a room is bound only when Polyadic echoes its id", async () => {
    const harness = await makeHarness({ echo: room => room.endsWith("g301") });
    await harness.runHook("phase-started", { sessionId: 10, phaseId: 2 });

    assert.equal(harness.roomJobOf("ethicapp-s10-p2-g301").room_bound, true);
    assert.equal(harness.roomJobOf("ethicapp-s10-p2-g302").room_bound, false);
    assert.equal(harness.roomJobOf("ethicapp-s10-p2-g302").status, JOB_STATUS.OPEN);
});

test("room jobs: repeated proactive callbacks are all delivered and the job stays open", async () => {
    const harness = await makeHarness();
    await harness.runHook("phase-started", { sessionId: 10, phaseId: 2 });
    const job = harness.roomJobOf("ethicapp-s10-p2-g301");

    for (let index = 0; index < 3; index++) {
        const { resultRecord, outcomes } = await harness.callback({ correlationId: job.id });
        assert.equal(resultRecord.job_id, job.id);
        assert.deepEqual(outcomes.map(outcome => outcome.status), ["fulfilled"]);
    }

    assert.equal(harness.published.length, 3);
    assert.ok(harness.published.every(message => message.groupId === 301 && message.sessionId === 10));
    assert.equal(job.status, JOB_STATUS.OPEN, "a callback outcome never completes a room job");
    assert.ok(harness.database.results.every(row => row.status === RESULT_STATUS.COMPLETED));
});

test("room jobs: a duplicate eventId is suppressed", async () => {
    const harness = await makeHarness();
    await harness.runHook("phase-started", { sessionId: 10, phaseId: 2 });
    const job = harness.roomJobOf("ethicapp-s10-p2-g301");
    const eventId = randomUUID();

    await harness.callback({ correlationId: job.id, eventId });
    const retry = await harness.callback({ correlationId: job.id, eventId });

    assert.equal(retry.resultRecord.is_duplicate, true);
    assert.deepEqual(retry.outcomes, []);
    assert.equal(harness.published.length, 1);
    assert.equal(job.status, JOB_STATUS.OPEN);
});

test("room jobs: concurrent callbacks deliver once per eventId", async () => {
    const harness = await makeHarness();
    await harness.runHook("phase-started", { sessionId: 10, phaseId: 2 });
    const job = harness.roomJobOf("ethicapp-s10-p2-g301");
    const [first, second] = [randomUUID(), randomUUID()];

    await Promise.all([first, first, first, second, second].map(eventId =>
        harness.callback({ correlationId: job.id, eventId })));

    assert.equal(harness.published.length, 2);
    assert.equal(harness.database.results.length, 2, "one row per event");
    assert.equal(job.status, JOB_STATUS.OPEN);
});

test("room jobs: a callback naming another room than its room job is refused", async () => {
    const harness = await makeHarness();
    await harness.runHook("phase-started", { sessionId: 10, phaseId: 2 });
    const job = harness.roomJobOf("ethicapp-s10-p2-g301");

    await assert.rejects(
        harness.callback({ correlationId: job.id, room: "ethicapp-s10-p2-g302" }),
        { statusCode: 409 }
    );
    assert.deepEqual(harness.published, []);
});

const roomJobsOf = harness => harness.database.jobs.filter(job => job.kind === JOB_KIND.ROOM);

test("room jobs: phase-ended closes them, and a later callback is refused with 409", async () => {
    const harness = await makeHarness();
    await harness.runHook("phase-started", { sessionId: 10, phaseId: 2 });
    await harness.runHook("phase-started", { sessionId: 10, phaseId: 3 });
    const job = harness.roomJobOf("ethicapp-s10-p2-g301");
    await harness.callback({ correlationId: job.id });

    assert.equal(await harness.dispatch("phase-ended", { sessionId: 10, phaseId: 2 }), 1);
    assert.deepEqual(roomJobsOf(harness).map(row => [row.phase_id, row.status]), [
        [2, JOB_STATUS.CLOSED], [2, JOB_STATUS.CLOSED], [3, JOB_STATUS.OPEN], [3, JOB_STATUS.OPEN],
    ]);

    await assert.rejects(harness.callback({ correlationId: job.id }), {
        statusCode: 409, code: "callback_room_job_closed",
    });
    assert.equal(harness.published.length, 1, "no handler ran");
    assert.equal(harness.database.results.at(-1).status, RESULT_STATUS.FAILED);
});

test("room jobs: activity-finished closes them in every phase of the session", async () => {
    const harness = await makeHarness();
    await harness.runHook("phase-started", { sessionId: 10, phaseId: 2 });
    await harness.runHook("phase-started", { sessionId: 10, phaseId: 3 });

    await harness.dispatch("activity-finished", { sessionId: 10, phaseId: 3 });

    assert.equal(roomJobsOf(harness).length, 4);
    assert.ok(roomJobsOf(harness).every(row => row.status === JOB_STATUS.CLOSED));
});

test("room jobs: phase-ended and activity-finished close them without a connection", quietly(async () => {
    const harness = await makeHarness();
    await harness.runHook("phase-started", { sessionId: 10, phaseId: 2 });
    const job = harness.roomJobOf("ethicapp-s10-p2-g301");

    // The connection is removed before the phase ends: the gate lets no
    // production adapter receive the lifecycle hooks.
    harness.world.connected = false;
    assert.equal(await harness.dispatch("phase-ended", { sessionId: 10, phaseId: 2 }), 0);
    assert.equal(await harness.dispatch("activity-finished", { sessionId: 10, phaseId: 2 }), 0);
    assert.deepEqual(harness.closeRequests, [], "no outbound call");
    assert.ok(roomJobsOf(harness).every(row => row.status === JOB_STATUS.CLOSED));

    // The connection returns; the fake still reports phase 2 as active, so
    // only the closure refuses the old room's fresh event.
    harness.world.connected = true;
    await assert.rejects(harness.callback({ correlationId: job.id }), {
        statusCode: 409, code: "callback_room_job_closed",
    });
    assert.deepEqual(harness.published, []);
    assert.equal(job.status, JOB_STATUS.CLOSED);
}));

test("room jobs: a restarted process closes them from the database", async () => {
    const harness = await makeHarness();
    await harness.runHook("phase-started", { sessionId: 10, phaseId: 2 });
    const job = harness.roomJobOf("ethicapp-s10-p2-g301");

    // A fresh registry and adapter, which track no rooms, over the same tables.
    const restarted = await makeHarness({ database: harness.database });
    await restarted.dispatch("phase-ended", { sessionId: 10, phaseId: 2 });

    assert.ok(roomJobsOf(restarted).every(row => row.status === JOB_STATUS.CLOSED));
    await assert.rejects(restarted.callback({ correlationId: job.id }), {
        statusCode: 409, code: "callback_room_job_closed",
    });
    assert.deepEqual(restarted.published, []);
});

test("room jobs: a callback whose phase is no longer active is refused and its job closed", async () => {
    const harness = await makeHarness();
    await harness.runHook("phase-started", { sessionId: 10, phaseId: 2 });
    const job = harness.roomJobOf("ethicapp-s10-p2-g301");

    // The session moved on, and phase-ended never reached the registry.
    harness.world.currentPhase[10] = 3;
    await assert.rejects(harness.callback({ correlationId: job.id }), {
        statusCode: 409, code: "callback_room_job_closed",
    });
    assert.deepEqual(harness.published, []);
    assert.equal(job.status, JOB_STATUS.CLOSED);
    assert.equal(harness.database.results[0].status, RESULT_STATUS.FAILED);

    // A finished activity has no active phase either.
    const other = harness.roomJobOf("ethicapp-s10-p2-g302");
    delete harness.world.currentPhase[10];
    await assert.rejects(harness.callback({ correlationId: other.id, room: "ethicapp-s10-p2-g302" }),
        { statusCode: 409, code: "callback_room_job_closed" });
    assert.equal(other.status, JOB_STATUS.CLOSED);
});

test("room jobs: a failed phase state read answers 503 and leaves the result pending", quietly(async () => {
    const harness = await makeHarness();
    await harness.runHook("phase-started", { sessionId: 10, phaseId: 2 });
    const job = harness.roomJobOf("ethicapp-s10-p2-g301");
    const eventId = randomUUID();

    harness.world.failPhaseState = true;
    await assert.rejects(harness.callback({ correlationId: job.id, eventId }), { statusCode: 503 });
    assert.equal(harness.database.results[0].status, RESULT_STATUS.PENDING);
    assert.equal(job.status, JOB_STATUS.OPEN);

    // The retry of the same event is delivered once the read works again.
    harness.world.failPhaseState = false;
    const retry = await harness.callback({ correlationId: job.id, eventId });
    assert.deepEqual(retry.outcomes.map(outcome => outcome.status), ["fulfilled"]);
    assert.equal(harness.published.length, 1);
}));

test("room jobs: a room job closed after authorization runs no handler (409)", async () => {
    const harness = await makeHarness();
    await harness.runHook("phase-started", { sessionId: 10, phaseId: 2 });
    const job = harness.roomJobOf("ethicapp-s10-p2-g301");
    harness.database.beforeClaim = async () => {
        harness.database.beforeClaim = null;
        await harness.dispatch("phase-ended", { sessionId: 10, phaseId: 2 });
    };

    await assert.rejects(harness.callback({ correlationId: job.id }), {
        statusCode: 409, code: "callback_room_job_closed",
    });
    assert.deepEqual(harness.published, []);
    assert.equal(harness.database.results[0].status, RESULT_STATUS.FAILED);
});

test("room jobs: a room created again lazily supersedes its previous room job", quietly(async () => {
    const harness = await makeHarness();
    await harness.runHook("phase-started", { sessionId: 10, phaseId: 2 });
    const previous = harness.roomJobOf("ethicapp-s10-p2-g301");

    // This process after a restart tracks no rooms; the jobs table persists.
    const restarted = await makeHarness({ database: harness.database });
    await restarted.runHook("chat-message-received", {
        sessionId: 10, phaseId: 2, groupId: 301, userId: 9, content: "Hello",
    });

    const current = restarted.roomJobOf("ethicapp-s10-p2-g301");
    assert.notEqual(current.id, previous.id);
    assert.equal(current.hook_name, "chat-message-received");
    assert.equal(current.status, JOB_STATUS.OPEN);
    assert.equal(previous.status, JOB_STATUS.CLOSED, "superseded");
    assert.equal(restarted.roomJobOf("ethicapp-s10-p2-g302").status, JOB_STATUS.OPEN, "other rooms untouched");
    assert.equal(restarted.sessionRequests[0].body.ethicapp_room_correlation_id, current.id);

    await assert.rejects(restarted.callback({ correlationId: previous.id }), { statusCode: 409 });
    const delivered = await restarted.callback({ correlationId: current.id });
    assert.deepEqual(delivered.outcomes.map(outcome => outcome.status), ["fulfilled"]);
}));

test("room jobs: concurrent lazy creations of one room share one room job", async () => {
    const harness = await makeHarness();
    const message = { sessionId: 10, phaseId: 2, groupId: 301, userId: 9, content: "Hello" };

    await Promise.all([harness.runHook("chat-message-received", message),
        harness.runHook("chat-message-received", message)]);

    assert.equal(harness.sessionRequests.length, 1);
    assert.equal(harness.database.jobs.length, 1);
    assert.equal(harness.database.jobs[0].status, JOB_STATUS.OPEN);
});

test("room jobs: a room that fails to be created leaves no open room job", quietly(async () => {
    const harness = await makeHarness({ failRooms: ["ethicapp-s10-p2-g302"] });
    await harness.runHook("phase-started", { sessionId: 10, phaseId: 2 });

    assert.equal(harness.roomJobOf("ethicapp-s10-p2-g301").status, JOB_STATUS.OPEN);
    const failed = harness.roomJobOf("ethicapp-s10-p2-g302");
    assert.equal(failed.status, JOB_STATUS.FAILED);
    assert.equal(harness.hookResults.at(-1).payload.roomsCreated, 1);

    await assert.rejects(harness.callback({ correlationId: failed.id, room: "ethicapp-s10-p2-g302" }),
        { statusCode: 409 });
}));

test("room jobs: a callback without a job naming a bound room is refused with 409", async () => {
    const harness = await makeHarness();
    await harness.runHook("phase-started", { sessionId: 10, phaseId: 2 });

    for (const correlationId of [null, randomUUID()]) {
        await assert.rejects(harness.callback({ correlationId }), {
            statusCode: 409, code: "callback_room_bound",
        });
    }
    assert.deepEqual(harness.published, []);
    assert.ok(harness.database.results.every(row => row.status === RESULT_STATUS.FAILED));
});

test("room jobs: a callback without a job naming an unbound room keeps option A", async () => {
    const harness = await makeHarness({ echo: () => false });
    await harness.runHook("phase-started", { sessionId: 10, phaseId: 2 });

    const delivered = await harness.callback({ correlationId: randomUUID() });
    assert.deepEqual(delivered.outcomes.map(outcome => outcome.status), ["fulfilled"]);
    assert.equal(harness.published.length, 1);
    assert.equal(harness.database.results[0].status, RESULT_STATUS.COMPLETED);

    // Option A still refuses a destination that fails its checks.
    await assert.rejects(harness.callback({ room: "ethicapp-s10-p9-g301" }), { statusCode: 409 });
});

test("room jobs: once its phase ended, a bound room no longer refuses callbacks as bound", async () => {
    const harness = await makeHarness();
    await harness.runHook("phase-started", { sessionId: 10, phaseId: 2 });
    await harness.dispatch("phase-ended", { sessionId: 10, phaseId: 2 });

    // Option A decides, and the fake keeps phase 2 active, so it is delivered;
    // in production the ended phase is no longer the active one.
    const delivered = await harness.callback();
    assert.deepEqual(delivered.outcomes.map(outcome => outcome.status), ["fulfilled"]);
});

test("room jobs: a failed bound lookup answers 503 and leaves the result pending", quietly(async () => {
    const harness = await makeHarness();
    harness.registry._roomJobsService = {
        hasOpenBoundRoomJob: async () => { throw new Error("database unavailable"); },
    };

    await assert.rejects(harness.callback(), { statusCode: 503 });
    assert.equal(harness.database.results[0].status, RESULT_STATUS.PENDING);
    assert.deepEqual(harness.published, []);
}));
