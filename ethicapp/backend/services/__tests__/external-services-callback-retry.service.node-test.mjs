import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { ExternalServicesRegistry } from "../external-services.service.js";
import { ExternalServiceJobsService, RESULT_STATUS } from "../external-service-jobs.service.js";
import { getCallbackTarget } from "../../external-services/adapters/polyadic-bridge.adapter.js";

// Callback idempotency (#815). Every callback is recorded 'pending'
// (received, not consumed). Authorization writes nothing; the result is
// consumed by one conditional UPDATE right before handlers run. So a
// transient failure, even one that also takes the database down, never
// consumes the event: the sender's retry with the same eventId is authorized
// again and delivered exactly once. Consumed events stay duplicates.

const normalize = sql => sql.replace(/\s+/g, " ").trim();
const tick = () => new Promise(resolve => setImmediate(resolve));

// An in-memory stand-in for the two tables, enforcing the partial unique
// index on (service_id, event_id). Each statement yields to the event loop
// first, so concurrent requests interleave between statements, and runs
// atomically, as a single Postgres statement does. `down` fails every
// statement; `failClaims` fails only the claim.
function makeDatabase({ jobs = [] } = {}) {
    const results = [];
    const database = { results, down: false, failClaims: 0 };
    database.dbQuery = async (sql, params = []) => {
        await tick();
        if (database.down) {
            throw new Error("database unavailable");
        }
        const text = normalize(sql);

        if (text.startsWith("SELECT id, status, session_id")) {
            return jobs.filter(job => job.id === params[0] && job.service_id === params[1]);
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
                id:             randomUUID(), job_id:         jobId, correlation_id: correlationId,
                service_id:     serviceId, hook_name:      hookName, status, event_id:       eventId,
            };
            results.push(row);
            return [{ ...row }];
        }
        if (text.startsWith("UPDATE external_service_results SET status = $2, job_id = $3")) {
            if (database.failClaims > 0) {
                database.failClaims -= 1;
                throw new Error("claim failed");
            }
            const [id, status, jobId, correlationId, pending] = params;
            const row = results.find(candidate => candidate.id === id && candidate.status === pending);
            if (!row) {
                return [];
            }
            Object.assign(row, { status, job_id: jobId, correlation_id: correlationId });
            return [{ ...row }];
        }
        if (text.startsWith("SELECT id, job_id, correlation_id, service_id, hook_name, status")) {
            return results.filter(row => row.service_id === params[0] && row.event_id === params[1])
                .map(row => ({ ...row }));
        }
        if (text.startsWith("UPDATE external_service_results SET status = $2")) {
            const row = results.find(candidate => candidate.id === params[0]);
            if (row) {
                row.status = params[1];
            }
            return [];
        }
        if (text.startsWith("UPDATE external_service_jobs")) {
            return [];
        }
        throw new Error(`Unexpected statement: ${text}`);
    };
    return database;
}

const VERSION = Object.freeze({ id: 2, allowedServiceIds: Object.freeze(["polyadic-agent"]) });
const ACTIVE = Object.freeze({
    current_stage: 2, status: 2, launched: true, group_exists: true, user_participates: false,
});

// Each lookup can fail a given number of times before it answers; with
// `outage`, its failure also takes the database down.
function makeFlakyLookups(failures, database, { outage = false } = {}) {
    const remaining = { ...failures };
    const failOnce = (name) => {
        if (remaining[name] > 0) {
            remaining[name] -= 1;
            if (outage) {
                database.down = true;
            }
            throw new Error(`${name} unavailable`);
        }
    };
    return {
        policy: {
            getCurrentPolicyVersion:   async () => VERSION,
            getPolicyVersion:          async () => VERSION,
            getSessionPolicyVersionId: async () => { failOnce("policy"); return 2; },
        },
        isAiAdditionsConfigured:    async () => { failOnce("connection"); return true; },
        callbackDestinationLookups: {
            loadPhaseState:            async () => { failOnce("phaseState"); return ACTIVE; },
            loadPhaseExternalServices: async () => {
                failOnce("design");
                return { enabledServiceIds: ["svc-polyadic"] };
            },
        },
    };
}

function makeRegistry({ failures = {}, jobs = [], outage = false, handler = null } = {}) {
    const database = makeDatabase({ jobs });
    const lookups = makeFlakyLookups(failures, database, { outage });
    const registry = new ExternalServicesRegistry({
        jobsService:                new ExternalServiceJobsService({ dbQuery: database.dbQuery }),
        // No room is bound to a room job (#833): option A applies.
        roomJobsService:            { hasOpenBoundRoomJob: async () => false },
        developmentAdapters:        false,
        aiServicePolicy:            lookups.policy,
        isAiAdditionsConfigured:    lookups.isAiAdditionsConfigured,
        callbackDestinationLookups: lookups.callbackDestinationLookups,
    });
    registry.initialized = true;
    registry.services.set("svc-polyadic", {
        id:           "svc-polyadic", development:  false, requires:     ["polyadic-agent"],
        hooks:        ["callback-received"], globalHooks:  [], scopes:       ["chat"], callbackAuth: null,
    });
    registry.callbackTargetResolvers.set("svc-polyadic", getCallbackTarget);

    const published = [];
    registry.hookSubscribers.set("callback-received", [{
        serviceId: "svc-polyadic",
        handler:   handler ?? (async (context, { callback }) => {
            await tick();
            published.push({ room: context.requestPayload.room, sessionId: context.sessionId });
            return callback({ status: "completed" });
        }),
    }]);
    return { registry, database, published };
}

function deliver(registry, eventId, { room = "ethicapp-s10-p2-g3", correlationId } = {}) {
    return registry.dispatchServiceHook("callback-received", "svc-polyadic", {
        correlationId:  correlationId ?? randomUUID(),
        eventId,
        requestPayload: { room, evaluations: [{}] },
    });
}

function quietly(fn) {
    return async () => {
        const originalError = console.error;
        console.error = () => {};
        try {
            await fn();
        } finally {
            console.error = originalError;
        }
    };
}

for (const lookup of ["policy", "connection", "phaseState", "design"]) {
    test(`retry: a transient ${lookup} failure writes nothing, and the retry delivers the event once`, quietly(async () => {
        const { registry, database, published } = makeRegistry({ failures: { [lookup]: 1 } });
        const eventId = randomUUID();

        await assert.rejects(deliver(registry, eventId), { statusCode: 503 });
        assert.deepEqual(published, []);
        assert.equal(database.results[0].status, RESULT_STATUS.PENDING);

        // The retry, with a fresh correlation id as Polyadic sends, is
        // authorized again and delivered.
        const retry = await deliver(registry, eventId);
        assert.equal(retry.resultRecord.is_retry, true);
        assert.deepEqual(retry.outcomes.map(outcome => outcome.status), ["fulfilled"]);
        assert.deepEqual(published, [{ room: "ethicapp-s10-p2-g3", sessionId: 10 }]);
        assert.equal(database.results.length, 1, "one row per event");
        assert.equal(database.results[0].status, RESULT_STATUS.COMPLETED);

        // Any later duplicate is suppressed.
        const later = await deliver(registry, eventId);
        assert.equal(later.resultRecord.is_duplicate, true);
        assert.deepEqual(later.outcomes, []);
        assert.equal(published.length, 1);
    }));

    test(`retry: when the ${lookup} failure also takes the database down, the retry after recovery delivers once`, quietly(async () => {
        const { registry, database, published } = makeRegistry({
            failures: { [lookup]: 1 },
            outage:   true,
        });
        const eventId = randomUUID();

        await assert.rejects(deliver(registry, eventId), { statusCode: 503 });
        assert.equal(database.results[0].status, RESULT_STATUS.PENDING, "nothing to recover");

        database.down = false;
        await deliver(registry, eventId);
        await deliver(registry, eventId);
        assert.equal(published.length, 1);
    }));
}

test("retry: a failed claim answers 503 and the event stays recoverable", quietly(async () => {
    const { registry, database, published } = makeRegistry();
    database.failClaims = 1;
    const eventId = randomUUID();

    await assert.rejects(deliver(registry, eventId), { statusCode: 503 });
    assert.deepEqual(published, []);
    assert.equal(database.results[0].status, RESULT_STATUS.PENDING);

    await deliver(registry, eventId);
    assert.equal(published.length, 1);
}));

test("retry: a retry that fails again stays pending", quietly(async () => {
    const { registry, database, published } = makeRegistry({ failures: { phaseState: 2 } });
    const eventId = randomUUID();

    await assert.rejects(deliver(registry, eventId), { statusCode: 503 });
    await assert.rejects(deliver(registry, eventId), { statusCode: 503 });
    assert.equal(database.results[0].status, RESULT_STATUS.PENDING);

    await deliver(registry, eventId);
    assert.equal(published.length, 1);
}));

test("retry: of concurrent attempts at one event exactly one claims and publishes", quietly(async () => {
    const { registry, published } = makeRegistry({ failures: { design: 1 } });
    const eventId = randomUUID();
    await assert.rejects(deliver(registry, eventId), { statusCode: 503 });

    const attempts = await Promise.all([1, 2, 3].map(() => deliver(registry, eventId)));

    assert.equal(published.length, 1);
    const delivered = attempts.filter(({ outcomes }) => outcomes.length === 1);
    const duplicates = attempts.filter(({ resultRecord }) => resultRecord.is_duplicate === true);
    assert.equal(delivered.length, 1);
    assert.equal(duplicates.length, 2);
}));

test("retry: an event refused for a non-transient reason (409) stays refused", async () => {
    const { registry, database, published } = makeRegistry();
    const eventId = randomUUID();

    // The room names phase 9, which is not the session's active phase.
    await assert.rejects(deliver(registry, eventId, { room: "ethicapp-s10-p9-g3" }), { statusCode: 409 });
    assert.equal(database.results[0].status, RESULT_STATUS.FAILED);

    const retry = await deliver(registry, eventId, { room: "ethicapp-s10-p9-g3" });
    assert.equal(retry.resultRecord.is_duplicate, true);
    assert.deepEqual(retry.outcomes, []);
    assert.deepEqual(published, []);
});

test("retry: a 409 whose failed mark is lost is simply refused again", async () => {
    const { registry, database, published } = makeRegistry();
    const eventId = randomUUID();
    const updateResult = registry._jobsService.updateResult.bind(registry._jobsService);
    registry._jobsService.updateResult = async () => { throw new Error("database unavailable"); };

    await assert.rejects(deliver(registry, eventId, { room: "ethicapp-s10-p9-g3" }), { statusCode: 409 });
    assert.equal(database.results[0].status, RESULT_STATUS.PENDING);

    registry._jobsService.updateResult = updateResult;
    await assert.rejects(deliver(registry, eventId, { room: "ethicapp-s10-p9-g3" }), { statusCode: 409 });
    assert.equal(database.results[0].status, RESULT_STATUS.FAILED);
    assert.deepEqual(published, []);
});

test("retry: a delivered event is a duplicate on retry, as before", async () => {
    const { registry, published } = makeRegistry();
    const eventId = randomUUID();

    await deliver(registry, eventId);
    const retry = await deliver(registry, eventId);

    assert.equal(retry.resultRecord.is_duplicate, true);
    assert.equal(published.length, 1);
});

test("retry: a crash after the claim leaves the event consumed (at most once)", quietly(async () => {
    let runs = 0;
    const holder = {};
    const { registry, database } = makeRegistry({
        handler: async () => {
            runs += 1;
            // The process dies mid-handler: nothing else is written.
            holder.database.down = true;
            throw new Error("crash");
        },
    });
    holder.database = database;
    const eventId = randomUUID();

    await deliver(registry, eventId);
    assert.equal(database.results[0].status, RESULT_STATUS.UNKNOWN_CORRELATION, "claimed");

    database.down = false;
    const retry = await deliver(registry, eventId);
    assert.equal(retry.resultRecord.is_duplicate, true);
    assert.equal(runs, 1);
}));

test("retry: job-matched callbacks are unchanged", async () => {
    const jobId = randomUUID();
    const { registry, database, published } = makeRegistry({
        jobs: [{
            id:          jobId, service_id:  "svc-polyadic", status:      "dispatched",
            session_id:  10, phase_id:    2, question_id: 4, group_id:    3, user_id:     5,
        }],
        // The destination lookups would fail, but a job needs none of them.
        failures: { policy: 5, connection: 5, phaseState: 5, design: 5 },
    });
    const eventId = randomUUID();

    const first = await deliver(registry, eventId, { correlationId: jobId });
    const retry = await deliver(registry, eventId, { correlationId: jobId });

    assert.deepEqual(first.outcomes.map(outcome => outcome.status), ["fulfilled"]);
    assert.equal(retry.resultRecord.is_duplicate, true);
    assert.equal(published.length, 1);
    assert.equal(database.results[0].job_id, jobId);
});
