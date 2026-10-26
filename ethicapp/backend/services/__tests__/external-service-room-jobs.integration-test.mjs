// Integration tests for room-scoped jobs (#833), against a real PostgreSQL
// database with migrations V1-V24 applied: the status and kind CHECKs, the
// supersession statement and the conditional claim cannot be checked with
// fakes.
//
// Run with `npm run test:integration`, setting ETHICAPP_INTEGRATION_DATABASE_URL
// to a disposable database.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";

import {
    ExternalServiceJobsService,
    JOB_STATUS,
    RESULT_STATUS,
} from "../external-service-jobs.service.js";
import { ExternalServiceRoomJobsService } from "../external-service-room-jobs.service.js";
import { ExternalServicesRegistry } from "../external-services.service.js";
import { getCallbackTarget } from "../../external-services/adapters/polyadic-bridge.adapter.js";

const DATABASE_URL = process.env.ETHICAPP_INTEGRATION_DATABASE_URL;
const SKIP_REASON = DATABASE_URL
    ? false
    : "ETHICAPP_INTEGRATION_DATABASE_URL is not set; integration tests skipped.";

let pool = null;

function getPool() {
    pool ??= new pg.Pool({ connectionString: DATABASE_URL, max: 10 });
    return pool;
}

const dbQuery = async (sql, params = []) => (await getPool().query(sql, params)).rows;

test.after(async () => {
    await pool?.end();
});

// A service id per test, so rows of earlier runs never match.
function makeServices() {
    return {
        serviceId: `svc-room-${randomUUID()}`,
        jobs:      new ExternalServiceJobsService({ dbQuery }),
        roomJobs:  new ExternalServiceRoomJobsService({ dbQuery }),
    };
}

async function jobRow(id) {
    return (await dbQuery(
        "SELECT kind, status, room_bound, provider_reference FROM external_service_jobs WHERE id = $1",
        [id]
    ))[0];
}

function createRoomJob({ roomJobs, serviceId }, groupId = 301) {
    return roomJobs.createRoomJob({
        serviceId,
        hookName:  "phase-started",
        sessionId: 10,
        phaseId:   2,
        groupId,
        room:      `ethicapp-s10-p2-g${groupId}`,
    });
}

test("room jobs: pending, open and bound, then closed with the phase", { skip: SKIP_REASON }, async () => {
    const services = makeServices();
    const job = await createRoomJob(services);
    assert.deepEqual(await jobRow(job.id), {
        kind: "room", status: "pending", room_bound: false, provider_reference: "ethicapp-s10-p2-g301",
    });

    assert.equal(await services.roomJobs.openRoomJob(job.id, { bound: true }), true);
    assert.equal((await jobRow(job.id)).status, JOB_STATUS.OPEN);
    assert.equal(await services.roomJobs.hasOpenBoundRoomJob({
        serviceId: services.serviceId, sessionId: 10, phaseId: 2, groupId: 301,
    }), true);
    assert.equal(await services.roomJobs.hasOpenBoundRoomJob({
        serviceId: services.serviceId, sessionId: 10, phaseId: 2, groupId: 302,
    }), false);

    assert.equal(await services.roomJobs.closeRoomJobs({
        serviceId: services.serviceId, sessionId: 10, phaseId: 2,
    }), 1);
    assert.equal((await jobRow(job.id)).status, JOB_STATUS.CLOSED);
    assert.equal(await services.roomJobs.hasOpenBoundRoomJob({
        serviceId: services.serviceId, sessionId: 10, phaseId: 2, groupId: 301,
    }), false);
    assert.equal(await services.roomJobs.openRoomJob(job.id, { bound: true }), false,
        "a closed room job never reopens");
});

test("room jobs: a newer room job supersedes the room's older ones only", { skip: SKIP_REASON }, async () => {
    const services = makeServices();
    const older = await createRoomJob(services);
    await services.roomJobs.openRoomJob(older.id, { bound: false });
    const otherRoom = await createRoomJob(services, 302);
    await services.roomJobs.openRoomJob(otherRoom.id, { bound: false });

    const newer = await createRoomJob(services);
    assert.equal(await services.roomJobs.openRoomJob(newer.id, { bound: true }), true);

    assert.equal((await jobRow(older.id)).status, JOB_STATUS.CLOSED);
    assert.equal((await jobRow(newer.id)).status, JOB_STATUS.OPEN);
    assert.equal((await jobRow(otherRoom.id)).status, JOB_STATUS.OPEN);
});

test("room jobs: a failed room creation leaves no open room job", { skip: SKIP_REASON }, async () => {
    const services = makeServices();
    const job = await createRoomJob(services);
    await services.roomJobs.failRoomJob(job.id);

    assert.equal((await jobRow(job.id)).status, JOB_STATUS.FAILED);
    assert.equal(await services.roomJobs.openRoomJob(job.id, { bound: true }), false);
});

test("room jobs: the CHECKs accept open and closed, and bound only on room jobs", { skip: SKIP_REASON }, async () => {
    const services = makeServices();
    const hookJob = await services.jobs.createJob({ serviceId: services.serviceId, hookName: "phase-started" });

    await assert.rejects(
        dbQuery("UPDATE external_service_jobs SET room_bound = true WHERE id = $1", [hookJob.id]),
        { code: "23514" }
    );
    await assert.rejects(
        dbQuery("UPDATE external_service_jobs SET kind = 'other' WHERE id = $1", [hookJob.id]),
        { code: "23514" }
    );
    await assert.rejects(
        dbQuery("UPDATE external_service_jobs SET status = 'reopened' WHERE id = $1", [hookJob.id]),
        { code: "23514" }
    );
    assert.equal((await jobRow(hookJob.id)).kind, "hook");
});

test("room jobs: callbacks claim against an open room job and leave it open", { skip: SKIP_REASON }, async () => {
    const services = makeServices();
    const job = await createRoomJob(services);
    await services.roomJobs.openRoomJob(job.id, { bound: true });

    for (let index = 0; index < 3; index++) {
        const result = await services.jobs.createResult({
            correlationId: job.id, serviceId: services.serviceId, rawPayload: {}, eventId: randomUUID(),
        });
        assert.equal(result.job.kind, "room");
        const claimed = await services.jobs.claimResult(result);
        assert.equal(claimed.status, RESULT_STATUS.CALLBACK_RECEIVED);
    }
    assert.equal((await jobRow(job.id)).status, JOB_STATUS.OPEN);
});

test("room jobs: a claim after the room job closed is refused and stays pending", { skip: SKIP_REASON }, async () => {
    const services = makeServices();
    const job = await createRoomJob(services);
    await services.roomJobs.openRoomJob(job.id, { bound: true });

    const result = await services.jobs.createResult({
        correlationId: job.id, serviceId: services.serviceId, rawPayload: {}, eventId: randomUUID(),
    });
    await services.roomJobs.closeRoomJobs({ serviceId: services.serviceId, sessionId: 10, phaseId: 2 });

    await assert.rejects(services.jobs.claimResult(result), {
        statusCode: 409, code: "callback_room_job_closed",
    });
    const [row] = await dbQuery("SELECT status FROM external_service_results WHERE id = $1", [result.id]);
    assert.equal(row.status, RESULT_STATUS.PENDING);
});

test("room jobs: the registry refuses a callback to a closed room job (409)", { skip: SKIP_REASON }, async () => {
    const services = makeServices();
    const registry = new ExternalServicesRegistry({
        jobsService:                services.jobs,
        roomJobsService:            services.roomJobs,
        developmentAdapters:        false,
        // Session 10 is not a real session: its phase 2 is reported active.
        callbackDestinationLookups: {
            loadPhaseState: async () => ({ launched: true, status: 2, current_stage: 2 }),
        },
    });
    registry.initialized = true;
    registry.services.set(services.serviceId, {
        id:           services.serviceId,
        development:  false,
        requires:     ["polyadic-agent"],
        hooks:        ["callback-received"],
        globalHooks:  [],
        scopes:       ["chat"],
        callbackAuth: null,
    });
    registry.callbackTargetResolvers.set(services.serviceId, getCallbackTarget);
    const delivered = [];
    registry.subscribe(services.serviceId, "callback-received", async (context, { callback }) => {
        delivered.push(context.groupId);
        return callback({ status: "completed" });
    });

    const job = await createRoomJob(services);
    await services.roomJobs.openRoomJob(job.id, { bound: true });
    const send = () => registry.dispatchServiceHook("callback-received", services.serviceId, {
        correlationId:  job.id,
        eventId:        randomUUID(),
        requestPayload: { room: "ethicapp-s10-p2-g301", evaluations: [] },
    });

    await send();
    await send();
    assert.deepEqual(delivered, [301, 301]);
    assert.equal((await jobRow(job.id)).status, JOB_STATUS.OPEN);

    await services.roomJobs.closeRoomJobs({ serviceId: services.serviceId, sessionId: 10 });
    await assert.rejects(send(), { statusCode: 409, code: "callback_room_job_closed" });
    assert.deepEqual(delivered, [301, 301], "no handler ran");

    const rows = await dbQuery(
        "SELECT status FROM external_service_results WHERE job_id = $1 ORDER BY received_at",
        [job.id]
    );
    assert.deepEqual(rows.map(row => row.status),
        [RESULT_STATUS.COMPLETED, RESULT_STATUS.COMPLETED, RESULT_STATUS.FAILED]);
});

const randomSessionId = () => 100000 + Math.floor(Math.random() * 1000000);

test("room jobs: closing without a service closes every service's, per phase or session", { skip: SKIP_REASON }, async () => {
    const sessionId = randomSessionId();
    const first = makeServices();
    const second = makeServices();
    const create = (services, phaseId) => services.roomJobs.createRoomJob({
        serviceId: services.serviceId, hookName: "phase-started", sessionId, phaseId, groupId: 301,
    });
    const a2 = await create(first, 2);
    const b2 = await create(second, 2);
    const a3 = await create(first, 3);
    await first.roomJobs.openRoomJob(a2.id, { bound: true });

    assert.equal(await first.roomJobs.closeRoomJobs({ sessionId, phaseId: 2 }), 2);
    assert.equal((await jobRow(a2.id)).status, JOB_STATUS.CLOSED);
    assert.equal((await jobRow(b2.id)).status, JOB_STATUS.CLOSED);
    assert.equal((await jobRow(a3.id)).status, JOB_STATUS.PENDING);
    assert.equal(await first.roomJobs.closeRoomJobs({ sessionId, phaseId: 2 }), 0, "idempotent");

    assert.equal(await first.roomJobs.closeRoomJobs({ sessionId }), 1);
    assert.equal((await jobRow(a3.id)).status, JOB_STATUS.CLOSED);
});

test("room jobs: closeRoomJob closes one live room job only", { skip: SKIP_REASON }, async () => {
    const services = makeServices();
    const job = await createRoomJob(services);
    const failed = await createRoomJob(services, 302);
    await services.roomJobs.openRoomJob(job.id, { bound: true });
    await services.roomJobs.failRoomJob(failed.id);

    await services.roomJobs.closeRoomJob(job.id);
    await services.roomJobs.closeRoomJob(failed.id);

    assert.equal((await jobRow(job.id)).status, JOB_STATUS.CLOSED);
    assert.equal((await jobRow(failed.id)).status, JOB_STATUS.FAILED);
});

test("room jobs: dispatchHook closes them without a connection", { skip: SKIP_REASON }, async () => {
    const services = makeServices();
    const sessionId = randomSessionId();
    const job = await services.roomJobs.createRoomJob({
        serviceId: services.serviceId, hookName: "phase-started", sessionId, phaseId: 2, groupId: 301,
    });
    await services.roomJobs.openRoomJob(job.id, { bound: true });

    const registry = new ExternalServicesRegistry({
        jobsService:             services.jobs,
        roomJobsService:         services.roomJobs,
        developmentAdapters:     false,
        isAiAdditionsConfigured: async () => false,
    });
    registry.initialized = true;
    registry.services.set(services.serviceId, {
        id:          services.serviceId,
        development: false,
        requires:    ["polyadic-agent"],
        hooks:       ["phase-ended"],
    });
    let handled = 0;
    registry.subscribe(services.serviceId, "phase-ended", async () => { handled += 1; });

    await registry.dispatchHook("phase-ended", { sessionId, phaseId: 2 }, {
        enabledServiceIds: [services.serviceId],
    });

    assert.equal(handled, 0);
    assert.equal((await jobRow(job.id)).status, JOB_STATUS.CLOSED);
});
