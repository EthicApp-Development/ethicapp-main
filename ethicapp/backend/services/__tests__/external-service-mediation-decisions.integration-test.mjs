// Integration tests for stored mediation decisions (#1222, V46), against a
// real PostgreSQL database with migrations V1-V46 applied: the uniqueness
// that makes a repeated callback store nothing, the record check, the
// resolution of the window's references through the jobs' sources and the
// report's read with the room job cannot be checked with fakes.
//
// Run with `npm run test:integration`, setting ETHICAPP_INTEGRATION_DATABASE_URL
// to a disposable database.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import pg from "pg";

import { ExternalServiceJobsService } from "../external-service-jobs.service.js";
import { ExternalServiceRoomJobsService } from "../external-service-room-jobs.service.js";
import { ExternalServiceMediationDecisionsService } from "../external-service-mediation-decisions.service.js";
import {
    createReportResultsReader,
    ExternalServiceReportResultsService,
} from "../external-service-report-results.service.js";

const DATABASE_URL = process.env.ETHICAPP_INTEGRATION_DATABASE_URL;
const SKIP_REASON = DATABASE_URL
    ? false
    : "ETHICAPP_INTEGRATION_DATABASE_URL is not set; integration tests skipped.";

const EXAMPLES_URL = new URL(
    "../../../../canonical-schemas/ai-additions/examples/mediation-decision.v1/",
    import.meta.url
);

let pool = null;

function getPool() {
    pool ??= new pg.Pool({ connectionString: DATABASE_URL, max: 5 });
    return pool;
}

const dbQuery = async (sql, params = []) => (await getPool().query(sql, params)).rows;

test.after(async () => {
    await pool?.end();
});

// A record of an example with fresh ids, so rows of earlier runs never match.
function freshRecord(name, correlationIds = []) {
    const record = JSON.parse(readFileSync(new URL(name, EXAMPLES_URL), "utf8"));
    record.decisionId = randomUUID();
    record.window.messages.forEach((reference, index) => {
        reference.correlationId = correlationIds[index] ?? null;
    });
    return record;
}

async function setup() {
    const serviceId = `svc-decisions-${randomUUID()}`;
    const sessionId = 900000 + Math.floor(Math.random() * 99999);
    const jobs = new ExternalServiceJobsService({ dbQuery });
    const roomJobs = new ExternalServiceRoomJobsService({ dbQuery });
    const roomJob = await roomJobs.createRoomJob({
        serviceId, hookName: "phase-started", sessionId, phaseId: 22, groupId: 301,
        room: `ethicapp-s${sessionId}-p22-g301`,
    });
    await roomJobs.openRoomJob(roomJob.id, {
        bound:  true,
        report: { warnings: [], caseInputs: [{ key: "discussion_topics", ids: ["T1", "T2"] }] },
    });
    // Two forwarded messages: their chat-message-received jobs name them.
    const messageJobs = [];
    for (const messageId of [5001, 5002]) {
        messageJobs.push(await jobs.createJob({
            serviceId, hookName: "chat-message-received", sessionId, phaseId: 22, groupId: 301,
            userId: null, source: { kind: "chat_message", id: messageId },
        }));
    }
    const result = await jobs.createResult({
        correlationId: roomJob.id, serviceId, hookName: "callback-received",
        rawPayload: { room: "r", evaluations: [] }, sessionId, phaseId: 22, groupId: 301,
    });
    return {
        serviceId, sessionId, roomJob, messageJobs, resultId: result.id,
        store:   new ExternalServiceMediationDecisionsService({ dbQuery }),
        reports: new ExternalServiceReportResultsService({ dbQuery }),
    };
}

test("decisions are stored once, with their references resolved and their room job",
    { skip: SKIP_REASON }, async () => {
        const context = await setup();
        const { serviceId, sessionId, roomJob, messageJobs, resultId, store } = context;
        const record = freshRecord("constructive.es_CL.json", [
            messageJobs[0].id, messageJobs[1].id.toUpperCase(), randomUUID(),
        ]);
        const args = {
            serviceId, sessionId, phaseId: 22, questionId: 701, groupId: 301,
            jobId: roomJob.id, resultId,
            decisions: [{ record, interventionChatMessageId: 6001 }],
        };

        assert.deepEqual(await store.recordDecisions(args), { stored: [record.decisionId], duplicates: [] });
        assert.deepEqual(await store.recordDecisions(args), { stored: [], duplicates: [record.decisionId] });

        const reader = createReportResultsReader(context.reports, { serviceId, sessionId });
        const decisions = await reader.mediationDecisions();
        assert.equal(decisions.length, 1);
        assert.deepEqual(decisions[0].record, record);
        assert.deepEqual(decisions[0].windowChatMessageIds, [5001, 5002, null, null]);
        assert.equal(decisions[0].interventionChatMessageId, 6001);
        assert.equal(decisions[0].decidedAt, new Date(record.decidedAt).toISOString());
        assert.equal(decisions[0].job.id, roomJob.id);
        assert.equal(decisions[0].job.kind, "room");
        assert.deepEqual(decisions[0].job.instantiationReport.caseInputs,
            [{ key: "discussion_topics", ids: ["T1", "T2"] }]);

        // Another session's reader sees none of them.
        const other = createReportResultsReader(context.reports, { serviceId, sessionId: sessionId + 1 });
        assert.deepEqual(await other.mediationDecisions(), []);
    });

test("a reference resolves only through the service's jobs of the session", { skip: SKIP_REASON }, async () => {
    const context = await setup();
    const other = await setup();
    const record = freshRecord("no-intervention.es_CL.json", [context.messageJobs[0].id, other.messageJobs[0].id]);

    await context.store.recordDecisions({
        serviceId: context.serviceId, sessionId: context.sessionId, phaseId: 22, groupId: 301,
        decisions: [{ record }],
    });

    const rows = await dbQuery(
        "SELECT window_chat_message_ids, job_id, result_id FROM external_service_mediation_decisions WHERE decision_id = $1",
        [record.decisionId]
    );
    assert.deepEqual(rows, [{ window_chat_message_ids: ["5001", null], job_id: null, result_id: null }]);
});

test("the table refuses a record whose id is not its decision id", { skip: SKIP_REASON }, async () => {
    const { serviceId, sessionId } = await setup();
    const record = freshRecord("unparsed.en_US.json");
    await assert.rejects(dbQuery(
        `INSERT INTO external_service_mediation_decisions
             (service_id, decision_id, session_id, phase_id, decided_at, record)
         VALUES ($1, $2, $3, 22, now(), $4::jsonb)`,
        [serviceId, randomUUID(), sessionId, JSON.stringify(record)]
    ), { code: "23514" });
});

test("the same decision id of two services is two rows", { skip: SKIP_REASON }, async () => {
    const first = await setup();
    const second = await setup();
    const record = freshRecord("unparsed.en_US.json");
    for (const { serviceId, sessionId, store } of [first, second]) {
        assert.deepEqual(
            await store.recordDecisions({ serviceId, sessionId, phaseId: 22, decisions: [{ record }] }),
            { stored: [record.decisionId], duplicates: [] }
        );
    }
});
