// The argumentation tutor's student-results-reading handler (epic #1123,
// #1126): the feedback it published to a student, rebuilt from the stored
// callbacks, equals what it published live, and the live payload carries the
// stored result's id.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { register } from "../ats-feedback.adapter.js";
import { readStudentResults } from "../ats-feedback.student-results.js";
import { ExternalServicesRegistry } from "../../../services/external-services.service.js";
import {
    STUDENT_RESULT_KEYS,
    STUDENT_RESULTS_READING_HOOK,
    validateStudentResults,
} from "../../../services/external-service-student-results.js";

const SERVICE_ID = "argumentation-tutor-system";
const manifestUrl = new URL("../../manifest.json", import.meta.url);
const manifest = JSON.parse(await fs.readFile(manifestUrl, "utf8"));
const tutorEntry = manifest.services.find(service => service.id === SERVICE_ID);

const SESSION_ID = 5;
const PHASE_ID = 20;
const QUESTION_ID = 101;
const STUDENT_ID = 31;
const OTHER_STUDENT_ID = 32;

const ARGUMENT = "The company should disclose the defect because people trust it.";

// The callback payload the tutor sends for a first analysis
// (ethicapp-ai-additions, ethicapp_callback.py).
function analysisPayload(overrides = {}) {
    return {
        sessionId:  SESSION_ID,
        phaseId:    PHASE_ID,
        questionId: QUESTION_ID,
        groupId:    7,
        userId:     String(STUDENT_ID),
        taskId:     "task-1",
        title:      "Argument Tutor Feedback",
        summary:    "The claim is clear; the evidence is thin.",
        mode:       "analysis",
        criteria:   [
            { key: "claim", label: "Claim", score: 1, value: "In favor (1)" },
            { key: "evidence", label: "Evidence", score: 1, value: "1/3" },
            { key: "warrant", label: "Warrant", score: 2, value: "2/3" },
            { key: "qualifier", label: "Qualifier", score: 0, value: "0/3" },
        ],
        bullets:            ["State your evidence.", "Link it to the claim."],
        argumentPreview:    ARGUMENT,
        comparison:         null,
        claimTypeId:        "AF2",
        claimTypeRationale: "Argues for disclosure.",
        tutorMode:          "enhanced",
        requestedMode:      "enhanced",
        evidenceFactIds:    ["EV1"],
        unsupportedClaims:  [{ statement: "The CEO knew.", exclusionId: "EX1" }],
        ...overrides,
    };
}

// The callback payload of a comparison with the student's previous argument.
function comparisonPayload(overrides = {}) {
    return {
        sessionId:  SESSION_ID,
        phaseId:    PHASE_ID,
        questionId: QUESTION_ID,
        groupId:    7,
        userId:     String(STUDENT_ID),
        taskId:     "task-2",
        title:      "Argument Tutor Feedback",
        summary:    "The revision adds evidence.",
        mode:       "comparison",
        criteria:   [
            { key: "claim", label: "Claim", score: 1, value: "In favor (1)" },
            { key: "evidence", label: "Evidence", score: 3, value: "3/3" },
        ],
        bullets:         ["Good use of the report."],
        argumentPreview: `${ARGUMENT} The safety report shows it.`,
        comparison:      {
            initialArgument: ARGUMENT,
            revisedArgument: `${ARGUMENT} The safety report shows it.`,
            scores:          {
                claim:    { initial: 1, revised: 1, delta: 0 },
                evidence: { initial: 1, revised: 3, delta: 2 },
            },
        },
        ...overrides,
    };
}

// As PostgreSQL stores and returns a jsonb value.
function asJson(value) {
    return JSON.parse(JSON.stringify(value));
}

let nextResult = 1;
function resultId() {
    return `a0000000-0000-4000-8000-${String(nextResult++).padStart(12, "0")}`;
}

// Registers the adapter with a fake registry and dispatches one callback, as
// the registry does: `context` holds the job's trusted destination and the
// stored result's id.
async function publishLive(requestPayload, {
    id = resultId(),
    userId = STUDENT_ID,
    publishStudentResult = null,
} = {}) {
    const handlers = new Map();
    const published = [];
    await register({
        subscribe:            (hookName, handler) => handlers.set(hookName, handler),
        publishStudentResult: async payload => {
            if (publishStudentResult) {
                return publishStudentResult(payload);
            }
            published.push(payload);
            return true;
        },
        atsFeedbackDependencies: { resolveGroupId: async () => 7 },
    });

    const callbacks = [];
    await handlers.get("callback-received")({
        serviceId:  SERVICE_ID,
        requestPayload,
        sessionId:  SESSION_ID,
        phaseId:    PHASE_ID,
        questionId: QUESTION_ID,
        groupId:    7,
        userId,
        jobId:      `job-${id}`,
        resultId:   id,
    }, { callback: async result => { callbacks.push(result); } });

    return { id, published, callback: callbacks[0], handlers };
}

// The stored result of a callback, as the student results reader returns it.
function storedResult({ id, requestPayload, callback, userId = STUDENT_ID,
    receivedAt = "2026-11-05T10:00:00.000Z", status }) {
    return Object.freeze({
        id,
        jobId:         `job-${id}`,
        hookName:      "student-response-submitted",
        status:        status ?? (callback?.status === "failed" ? "failed" : "completed"),
        phaseId:       PHASE_ID,
        questionId:    QUESTION_ID,
        groupId:       7,
        userId,
        source:        { kind: "response", id: 900 },
        rawPayload:    asJson(requestPayload),
        adapterResult: callback ? asJson(callback) : null,
        receivedAt,
    });
}

function readerOf(stored) {
    const calls = [];
    return {
        calls,
        results: {
            list: async filters => {
                calls.push(filters);
                return stored;
            },
        },
    };
}

function context(userId = STUDENT_ID) {
    return Object.freeze({ serviceId: SERVICE_ID, sessionId: SESSION_ID, userId });
}

// What publishStudentResult received, without the keys an entry does not
// carry (the student, who is the reader's, and the session, which is the
// route's).
function publishedEntry(payload) {
    assert.equal(payload.userId, STUDENT_ID);
    assert.equal(payload.sessionId, SESSION_ID);
    const entry = { ...payload };
    delete entry.userId;
    delete entry.sessionId;
    return entry;
}

function withoutPublishedAt(entry) {
    const rest = { ...entry };
    delete rest.publishedAt;
    return rest;
}

// ─── The live payload ───────────────────────────────────────────────────────

test("the feedback published live carries the stored result's id", async () => {
    const { id, published, callback } = await publishLive(analysisPayload());

    assert.equal(published.length, 1);
    assert.equal(published[0].resultId, id);
    assert.equal(callback.status, "completed");
    assert.equal(callback.payload.publishedToUserId, STUDENT_ID);
    assert.deepEqual(published[0], {
        userId:     STUDENT_ID,
        sessionId:  SESSION_ID,
        resultId:   id,
        phaseId:    PHASE_ID,
        questionId: QUESTION_ID,
        component:  {
            componentId: "argument-tutor-chat-feedback",
            title:       "Argument Tutor Feedback",
        },
        payload: { feedback: published[0].payload.feedback },
        message: "Your argument tutor feedback is now available.",
        status:  "completed",
    });
});

test("a callback without a stored result publishes a null result id", async () => {
    const { published } = await publishLive(analysisPayload(), { id: null });

    assert.equal(published[0].resultId, null);
});

// ─── The rebuild ────────────────────────────────────────────────────────────

test("the manifest lists student-results-reading and the adapter subscribes to it", async () => {
    assert.ok(tutorEntry.hooks.includes(STUDENT_RESULTS_READING_HOOK));

    const { handlers } = await publishLive(analysisPayload());
    assert.equal(handlers.get(STUDENT_RESULTS_READING_HOOK), readStudentResults);
});

test("a rebuilt analysis and comparison equal the feedback published live", async () => {
    const analysis = await publishLive(analysisPayload());
    const comparison = await publishLive(comparisonPayload());
    const stored = [
        storedResult({
            id:             analysis.id,
            requestPayload: analysisPayload(),
            callback:       analysis.callback,
        }),
        storedResult({
            id:             comparison.id,
            requestPayload: comparisonPayload(),
            callback:       comparison.callback,
            receivedAt:     "2026-11-05T10:05:00.000Z",
        }),
    ];
    const reader = readerOf(stored);

    const rebuilt = await readStudentResults(context(), { results: reader.results });

    assert.deepEqual(reader.calls, [undefined]);
    assert.equal(rebuilt.length, 2);
    for (const [index, live] of [analysis, comparison].entries()) {
        assert.deepEqual(Object.keys(rebuilt[index]).sort(), [...STUDENT_RESULT_KEYS].sort());
        assert.deepEqual(withoutPublishedAt(rebuilt[index]), publishedEntry(live.published[0]));
        assert.equal(rebuilt[index].publishedAt, stored[index].receivedAt);
    }
    assert.equal(rebuilt[0].payload.feedback.mode, "analysis");
    assert.equal(rebuilt[1].payload.feedback.mode, "comparison");
    assert.deepEqual(rebuilt[1].payload.feedback.comparison, comparisonPayload().comparison);

    // The registry keeps every entry, unchanged.
    const { entries, problems } = validateStudentResults(rebuilt, {
        readResults: new Map(stored.map(result => [result.id, result])),
    });
    assert.deepEqual(problems, []);
    assert.deepEqual(entries, rebuilt);
});

test("a callback that names no ids is rebuilt with its stored ids, as published live", async () => {
    const requestPayload = analysisPayload({
        sessionId: null, phaseId: null, questionId: undefined, userId: null,
    });
    const live = await publishLive(requestPayload);
    const stored = [storedResult({ id: live.id, requestPayload, callback: live.callback })];

    const rebuilt = await readStudentResults(context(), readerOf(stored));

    assert.deepEqual(live.published[0].payload.feedback.meta, {
        sessionId: SESSION_ID, phaseId: PHASE_ID, questionId: QUESTION_ID, userId: STUDENT_ID,
    });
    assert.deepEqual(withoutPublishedAt(rebuilt[0]), publishedEntry(live.published[0]));
});

test("failed, unfinished, pending and other students' results are left out", async () => {
    const published = await publishLive(analysisPayload());
    const failed = await publishLive(analysisPayload(), {
        publishStudentResult: async () => { throw new Error("socket down"); },
    });
    assert.equal(failed.callback.status, "failed");
    const otherStudent = await publishLive(analysisPayload({ userId: OTHER_STUDENT_ID }), {
        userId: OTHER_STUDENT_ID,
    });
    assert.equal(otherStudent.callback.payload.publishedToUserId, OTHER_STUDENT_ID);

    const stored = [
        storedResult({
            id:             published.id,
            requestPayload: analysisPayload(),
            callback:       published.callback,
        }),
        // The adapter failed to publish it.
        storedResult({
            id:             failed.id,
            requestPayload: analysisPayload(),
            callback:       failed.callback,
        }),
        // Marked failed after its handler recorded a publication (the
        // registry does so when a handler throws afterwards).
        storedResult({
            id:             resultId(),
            requestPayload: analysisPayload(),
            callback:       published.callback,
            status:         "failed",
        }),
        // Refused by the registry before any handler ran.
        storedResult({
            id:             resultId(),
            requestPayload: analysisPayload(),
            callback:       null,
            status:         "failed",
        }),
        // Claimed, but its handler never recorded an outcome.
        storedResult({
            id:             resultId(),
            requestPayload: analysisPayload(),
            callback:       null,
            status:         "callback-received",
        }),
        // Never claimed; the reader leaves these out, and so does the handler.
        storedResult({
            id:             resultId(),
            requestPayload: analysisPayload(),
            callback:       null,
            status:         "pending",
        }),
        // Completed, but published to another student.
        storedResult({
            id:             otherStudent.id,
            requestPayload: analysisPayload({ userId: OTHER_STUDENT_ID }),
            callback:       otherStudent.callback,
        }),
        // Completed with no record of a publication.
        storedResult({
            id:             resultId(),
            requestPayload: analysisPayload(),
            callback:       { hook: "callback-received", status: "completed", payload: {} },
        }),
    ];

    const rebuilt = await readStudentResults(context(), readerOf(stored));
    assert.deepEqual(rebuilt.map(entry => entry.resultId), [published.id]);

    const forOther = await readStudentResults(context(OTHER_STUDENT_ID), readerOf(stored));
    assert.deepEqual(forOther.map(entry => entry.resultId), [otherStudent.id]);
});

test("no stored results rebuild nothing", async () => {
    assert.deepEqual(await readStudentResults(context(), readerOf([])), []);
});

// ─── Through the registry ───────────────────────────────────────────────────

// One student-response job per student, and the results their callbacks
// leave, as the jobs service and the results reader see them.
function memoryStore(jobs) {
    const rows = [];

    function rowOf(id) {
        return rows.find(row => row.id === id);
    }

    return {
        rows,
        async createResult({ correlationId, serviceId, hookName, rawPayload, eventId }) {
            const job = jobs.find(candidate => candidate.id === correlationId
                && candidate.serviceId === serviceId) ?? null;
            const row = {
                id:              resultId(),
                job_id:          job?.id ?? null,
                correlation_id:  correlationId,
                service_id:      serviceId,
                hook_name:       hookName,
                status:          "pending",
                session_id:      job?.sessionId ?? null,
                phase_id:        job?.phaseId ?? null,
                question_id:     job?.questionId ?? null,
                group_id:        job?.groupId ?? null,
                user_id:         job?.userId ?? null,
                raw_payload:     asJson(rawPayload),
                adapter_result:  null,
                event_id:        eventId,
                received_at:     new Date(Date.UTC(2026, 10, 5, 10, rows.length)),
                job_hook_name:   job ? "student-response-submitted" : null,
                job_source_kind: job ? "response" : null,
                job_source_id:   job ? 900 + rows.length : null,
            };
            rows.push(row);
            return {
                id:          row.id,
                job_id:      row.job_id,
                service_id:  serviceId,
                status:      row.status,
                received_at: row.received_at,
                job:         job
                    ? { ...job, kind: "hook", status: "pending", source: null }
                    : undefined,
            };
        },
        async claimResult(record) {
            const row = rowOf(record.id);
            row.status = row.job_id ? "callback-received" : "unknown-correlation";
            return { id: row.id, job_id: row.job_id, status: row.status };
        },
        async updateResult(id, { status, adapterResult }) {
            const row = rowOf(id);
            row.status = status;
            if (adapterResult !== undefined) {
                row.adapter_result = asJson(adapterResult);
            }
        },
        async updateJobStatus() {},
        async listSessionServiceIds() {
            return [...new Set(rows.map(row => row.service_id))];
        },
        async listResults({ serviceId, sessionId, filters = {} }) {
            const columns = {
                hookName:   "job_hook_name",
                phaseId:    "phase_id",
                questionId: "question_id",
                userId:     "user_id",
                groupId:    "group_id",
            };
            return rows
                .filter(row => row.service_id === serviceId && row.session_id === sessionId
                    && row.status !== "pending"
                    && Object.entries(filters).every(([key, value]) => row[columns[key]] === value))
                .map(row => ({
                    ...row,
                    raw_payload:    asJson(row.raw_payload),
                    adapter_result: asJson(row.adapter_result),
                }));
        },
    };
}

function studentJob(id, userId) {
    return {
        id,
        serviceId:  SERVICE_ID,
        sessionId:  SESSION_ID,
        phaseId:    PHASE_ID,
        questionId: QUESTION_ID,
        groupId:    7,
        userId,
    };
}

async function quietly(run) {
    const channels = ["log", "info", "warn", "error"];
    const originals = Object.fromEntries(channels.map(channel => [channel, console[channel]]));
    const output = [];
    for (const channel of channels) {
        console[channel] = (...args) => { output.push(`${channel} ${args.join(" ")}`); };
    }
    try {
        return { result: await run(), output };
    } finally {
        Object.assign(console, originals);
    }
}

test("through the registry, the student reads back the live feedback by its id", async () => {
    const jobs = [
        studentJob("job-first", STUDENT_ID),
        studentJob("job-second", STUDENT_ID),
        studentJob("job-other", OTHER_STUDENT_ID),
        studentJob("job-refused", STUDENT_ID),
    ];
    const store = memoryStore(jobs);
    const registry = new ExternalServicesRegistry({
        jobsService:     store,
        roomJobsService: {
            closeRoomJobs:       async () => 0,
            hasOpenBoundRoomJob: async () => false,
        },
        reportResultsStore:    store,
        developmentAdapters:   false,
        loadSessionServiceIds: async () => [SERVICE_ID],
        aiServicePolicy:       {
            getSessionPolicyVersionId: async () => 4,
            getPolicyVersion:          async () => ({
                id: 4, allowedServiceIds: ["argumentation-tutor"], disabledAdapterIds: [],
            }),
        },
        isAiAdditionsConfigured: async () => true,
    });
    const events = [];
    registry.publishStudentResult = async (serviceId, payload) => {
        events.push({ ...payload, serviceId, receivedAt: new Date().toISOString() });
        return true;
    };
    await quietly(() => registry.initialize(fileURLToPath(manifestUrl)));
    assert.ok((registry.hookSubscribers.get(STUDENT_RESULTS_READING_HOOK) ?? [])
        .some(subscriber => subscriber.serviceId === SERVICE_ID),
    "the registry accepts the tutor's handler");

    const callback = (correlationId, payload) => quietly(() => registry
        .dispatchServiceHook("callback-received", SERVICE_ID, {
            serviceId:      SERVICE_ID,
            eventType:      "result",
            correlationId,
            eventId:        null,
            requestPayload: payload,
        })
        .catch(error => error));
    await callback("job-first", analysisPayload());
    await callback("job-second", comparisonPayload());
    await callback("job-other", analysisPayload({ userId: OTHER_STUDENT_ID }));
    // Names another phase than its job's: refused, nothing published.
    const refused = await callback("job-refused", analysisPayload({ phaseId: PHASE_ID + 1 }));
    assert.equal(refused.result.statusCode, 409);

    assert.deepEqual(store.rows.map(row => row.status),
        ["completed", "completed", "completed", "failed"]);
    const studentEvents = events.filter(event => event.userId === STUDENT_ID);
    assert.equal(studentEvents.length, 2);
    assert.deepEqual(studentEvents.map(event => event.resultId),
        store.rows.slice(0, 2).map(row => row.id));

    const { result: entries, output } = await quietly(() => registry.collectStudentResults({
        sessionId: SESSION_ID,
        userId:    STUDENT_ID,
    }));

    assert.deepEqual(output.filter(line => line.includes("Left out")), [],
        "no entry is dropped by the registry");
    assert.equal(entries.length, 2);
    for (const [index, event] of studentEvents.entries()) {
        const live = { ...event };
        delete live.receivedAt;
        assert.deepEqual(withoutPublishedAt(entries[index]), publishedEntry(live));
        assert.equal(entries[index].publishedAt, store.rows[index].received_at.toISOString());
    }
    assert.ok(output.every(line => !line.includes(ARGUMENT)), "no student text is logged");

    const other = await quietly(() => registry.collectStudentResults({
        sessionId: SESSION_ID,
        userId:    OTHER_STUDENT_ID,
    }));
    assert.deepEqual(other.result.map(entry => entry.resultId), [store.rows[2].id]);
});
