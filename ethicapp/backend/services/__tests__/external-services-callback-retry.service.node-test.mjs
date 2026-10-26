import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { ExternalServicesRegistry } from "../external-services.service.js";
import { ExternalServiceJobsService, RESULT_STATUS } from "../external-service-jobs.service.js";
import { getCallbackTarget } from "../../external-services/adapters/polyadic-bridge.adapter.js";

// Callback idempotency with retryable refusals (#815). A callback refused for
// a transient cause before any handler ran (503) is stored as 'retryable'; a
// retry with the same (service_id, event_id) claims it back and is processed
// again, exactly once. Every other refusal, and every delivered event, stays a
// terminal duplicate.

const normalize = sql => sql.replace(/\s+/g, " ").trim();
const tick = () => new Promise(resolve => setImmediate(resolve));

// An in-memory stand-in for the two tables, enforcing the partial unique
// index on (service_id, event_id). Each statement yields to the event loop
// first, so concurrent requests interleave between statements, and runs
// atomically, as a single Postgres statement does.
function makeDatabase({ jobs = [] } = {}) {
    const results = [];
    async function dbQuery(sql, params = []) {
        await tick();
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
        if (text.startsWith("UPDATE external_service_results SET status = $3, job_id = $4")) {
            const [serviceId, eventId, status, jobId, correlationId, retryable] = params;
            const row = results.find(candidate => candidate.service_id === serviceId
                && candidate.event_id === eventId && candidate.status === retryable);
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
    }
    return { dbQuery, results };
}

const VERSION = Object.freeze({ id: 2, allowedServiceIds: Object.freeze(["polyadic-agent"]) });
const ACTIVE = Object.freeze({
    current_stage: 2, status: 2, launched: true, group_exists: true, user_participates: false,
});

// Each lookup can fail a given number of times before it answers.
function makeFlakyLookups(failures = {}) {
    const remaining = { ...failures };
    const failOnce = (name) => {
        if (remaining[name] > 0) {
            remaining[name] -= 1;
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

function makeRegistry({ failures = {}, jobs = [] } = {}) {
    const database = makeDatabase({ jobs });
    const lookups = makeFlakyLookups(failures);
    const registry = new ExternalServicesRegistry({
        jobsService:                new ExternalServiceJobsService({ dbQuery: database.dbQuery }),
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
        handler:   async (context, { callback }) => {
            await tick();
            published.push({ room: context.requestPayload.room, sessionId: context.sessionId });
            return callback({ status: "completed" });
        },
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
    test(`retry: a transient ${lookup} failure leaves the event retryable, and the retry delivers it once`, quietly(async () => {
        const { registry, database, published } = makeRegistry({ failures: { [lookup]: 1 } });
        const eventId = randomUUID();

        await assert.rejects(deliver(registry, eventId), { statusCode: 503 });
        assert.deepEqual(published, []);
        assert.equal(database.results[0].status, RESULT_STATUS.RETRYABLE);

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
}

test("retry: a retry that fails again stays retryable", quietly(async () => {
    const { registry, database, published } = makeRegistry({ failures: { phaseState: 2 } });
    const eventId = randomUUID();

    await assert.rejects(deliver(registry, eventId), { statusCode: 503 });
    await assert.rejects(deliver(registry, eventId), { statusCode: 503 });
    assert.equal(database.results[0].status, RESULT_STATUS.RETRYABLE);

    await deliver(registry, eventId);
    assert.equal(published.length, 1);
}));

test("retry: of two concurrent retries exactly one claims and publishes", quietly(async () => {
    const { registry, published } = makeRegistry({ failures: { design: 1 } });
    const eventId = randomUUID();
    await assert.rejects(deliver(registry, eventId), { statusCode: 503 });

    const [first, second] = await Promise.all([deliver(registry, eventId), deliver(registry, eventId)]);

    assert.equal(published.length, 1);
    const retries = [first, second].filter(({ resultRecord }) => resultRecord.is_retry === true);
    const duplicates = [first, second].filter(({ resultRecord }) => resultRecord.is_duplicate === true);
    assert.equal(retries.length, 1);
    assert.equal(duplicates.length, 1);
    assert.deepEqual(duplicates[0].outcomes, []);
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

test("retry: a delivered event is a duplicate on retry, as before", async () => {
    const { registry, published } = makeRegistry();
    const eventId = randomUUID();

    await deliver(registry, eventId);
    const retry = await deliver(registry, eventId);

    assert.equal(retry.resultRecord.is_duplicate, true);
    assert.equal(published.length, 1);
});

test("retry: job-matched callbacks are unchanged", async () => {
    const jobId = randomUUID();
    const { registry, published } = makeRegistry({
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
});
