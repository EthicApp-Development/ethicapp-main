// Documents published to students (epic #1124, #1131): publishStudentResult()
// and the student-results-reading hook emit a document only when it validates
// against the schema copy and the service declared its schema for the
// `response` scope; the legacy `component` path keeps working.
import assert from "node:assert/strict";
import test from "node:test";

import { CapabilityDescriptorsClient } from "../capability-descriptors.service.js";
import { ExternalServicesRegistry } from "../external-services.service.js";
import { STUDENT_RESULTS_READING_HOOK } from "../external-service-student-results.js";

const SERVICE_ID = "argumentation-tutor-system";
const PLAIN_SERVICE_ID = "mock-ai-response-review";
const DESCRIPTOR_LINK = Object.freeze({
    serviceId: "argumentation-tutor",
    path:      "/argumentation-tutor/api/capabilities",
});
const SESSION_ID = 12;
const USER_ID = 31;
const PHASE_ID = 20;
const QUESTION_ID = 30;
const RESULT_ID = "a0000000-0000-4000-8000-000000000001";
const OTHER_RESULT_ID = "a0000000-0000-4000-8000-000000000002";
const LEGACY_RESULT_ID = "a0000000-0000-4000-8000-000000000003";

// Student text that may appear in a document, and must never reach a log.
const PRIVATE_MARKER = "private student argument 1131";

function studentDocument(overrides = {}) {
    return {
        schemaVersion: "student-result/v1",
        locale:        "en-US",
        title:         "Feedback on your argument",
        summary:       "You take a clear position.",
        sections:      [
            {
                kind:  "criteria",
                title: "Criteria",
                items: [
                    { key: "claim", label: "Claim", value: "3 of 3", score: 3, minScore: 1, maxScore: 3 },
                    { key: "evidence", label: "Evidence", value: "2 of 3", score: 2, minScore: 1, maxScore: 3 },
                ],
            },
            { kind: "text", title: "Your argument", text: PRIVATE_MARKER },
        ],
        ...overrides,
    };
}

function argumentFeedbackOutput(scopes = ["response"]) {
    return {
        id:              "argument-feedback",
        document_schema: "student-result/v1",
        scopes,
        display:         { label: "Argument feedback", description: "Feedback on each argument." },
    };
}

function tutorDescriptor(studentOutputs = [argumentFeedbackOutput()]) {
    return {
        contract_version:       "1",
        service:                { id: "argumentation-tutor", name: "Argumentation Tutor", uses_llm: true },
        instance_configuration: { fields: [] },
        runtime_configuration:  { fields: [] },
        student_outputs:        studentOutputs,
    };
}

// A descriptor that predates student_outputs, such as an older tutor's.
function withoutStudentOutputs() {
    const { student_outputs: omitted, ...descriptor } = tutorDescriptor();
    assert.ok(omitted);
    return descriptor;
}

// Runs fn and returns its result with every console line it wrote, on any
// channel, as "<channel> <text>".
async function captureConsole(fn) {
    const channels = ["log", "info", "warn", "error", "debug"];
    const originals = Object.fromEntries(channels.map(channel => [channel, console[channel]]));
    const output = [];
    for (const channel of channels) {
        console[channel] = (...args) => { output.push(`${channel} ${args.join(" ")}`); };
    }
    try {
        return { result: await fn(), output };
    } finally {
        Object.assign(console, originals);
    }
}

function assertNoStudentText(output) {
    assert.doesNotMatch(output.join("\n"), /private student/u);
}

function refusals(output) {
    return output
        .filter(line => line.includes("Refused a student result document."))
        .map(line => JSON.parse(line.slice(line.indexOf("{"))));
}

function leftOut(output) {
    return output
        .filter(line => line.includes("Left out student results."))
        .map(line => JSON.parse(line.slice(line.indexOf("{"))));
}

function resultRow(id, { receivedAt = "2026-11-05T10:00:00.000Z" } = {}) {
    return {
        id,
        job_id:         `job-${id}`,
        service_id:     SERVICE_ID,
        session_id:     SESSION_ID,
        status:         "completed",
        phase_id:       PHASE_ID,
        question_id:    QUESTION_ID,
        group_id:       null,
        user_id:        USER_ID,
        raw_payload:    { summary: PRIVATE_MARKER },
        adapter_result: { status: "completed" },
        received_at:    new Date(receivedAt),
        job_hook_name:  "student-response-submitted",
    };
}

/**
 * A registry with the tutor's catalog entry (which links a descriptor) and a
 * plain one (which links none), a descriptor client over `responses`, and a
 * notifier that records what it sends.
 *
 * `responses` are what the descriptor route answers in turn (the last one
 * repeats); an Error is thrown, a function is called.
 */
function makeRegistry({ responses = [tutorDescriptor()], storedResults = [], handlers = {} } = {}) {
    const requests = [];
    const sent = [];
    const queue = [...responses];
    let clock = 0;
    let registry = null;

    const capabilityDescriptors = new CapabilityDescriptorsClient({
        getDescriptorLink: serviceId => registry.getServiceDescriptor(serviceId),
        requestJson:       async (path) => {
            requests.push(path);
            const next = queue.length > 1 ? queue.shift() : queue[0];
            if (next instanceof Error) {
                throw next;
            }
            return typeof next === "function" ? next() : structuredClone(next);
        },
        now:     () => clock,
        ttlMs:   1000,
        retryMs: 100,
        logger:  { warn: () => {} },
    });

    registry = new ExternalServicesRegistry({
        jobsService: new Proxy({}, {
            get: (target, name) => async () => assert.fail(`no job write expected (${String(name)})`),
        }),
        roomJobsService:    { closeRoomJobs: async () => 0 },
        loadSessionLocale:  async () => "es_CL",
        reportResultsStore: {
            async listSessionServiceIds() {
                assert.fail("student results do not depend on the session's jobs");
            },
            async listResults({ serviceId }) {
                return storedResults.map(row => ({ ...row, service_id: serviceId }));
            },
        },
        developmentAdapters:   true,
        loadSessionServiceIds: async () => [SERVICE_ID, PLAIN_SERVICE_ID],
        aiServicePolicy:       {
            getCurrentPolicyVersion:   async () => assert.fail("the current policy is not read"),
            getSessionPolicyVersionId: async () => 4,
            getPolicyVersion:          async () => ({
                id: 4, allowedServiceIds: ["argumentation-tutor"], disabledAdapterIds: [],
            }),
        },
        isAiAdditionsConfigured: async () => assert.fail("the connection must not be read"),
        capabilityDescriptors,
        notifyStudentResult:     (userId, event) => {
            sent.push({ userId, event });
            return true;
        },
        now: () => clock,
    });
    registry.initialized = true;
    registry.services.set(SERVICE_ID, {
        id:          SERVICE_ID,
        development: false,
        requires:    ["argumentation-tutor"],
        hooks:       [STUDENT_RESULTS_READING_HOOK],
        globalHooks: [],
        scopes:      ["response"],
        report:      null,
        descriptor:  { ...DESCRIPTOR_LINK },
    });
    registry.services.set(PLAIN_SERVICE_ID, {
        id:          PLAIN_SERVICE_ID,
        development: true,
        requires:    [],
        hooks:       [STUDENT_RESULTS_READING_HOOK],
        globalHooks: [],
        scopes:      ["response", "chat"],
        report:      null,
        descriptor:  null,
    });
    for (const [serviceId, handler] of Object.entries(handlers)) {
        registry.subscribe(serviceId, STUDENT_RESULTS_READING_HOOK, handler);
    }

    return {
        registry,
        requests,
        sent,
        capabilityDescriptors,
        advance: ms => { clock += ms; },
    };
}

function publishDocument(registry, overrides = {}, serviceId = SERVICE_ID) {
    return registry.publishStudentResult(serviceId, {
        userId:         USER_ID,
        sessionId:      SESSION_ID,
        phaseId:        PHASE_ID,
        questionId:     QUESTION_ID,
        resultId:       RESULT_ID,
        message:        "Your feedback is ready.",
        status:         "completed",
        documentSchema: "student-result/v1",
        document:       studentDocument(),
        ...overrides,
    });
}

// ─── publishStudentResult ────────────────────────────────────────────────────

test("a valid document of a declared schema is emitted as component.documentSchema and payload", async () => {
    const { registry, sent, requests } = makeRegistry();
    const document = studentDocument();

    const { result, output } = await captureConsole(() => publishDocument(registry, {
        document,
        // Not part of the document form: never reaches the student.
        claimTypeId: "AF1",
    }));

    assert.equal(result, true);
    assert.deepEqual(requests, [DESCRIPTOR_LINK.path], "the declaration was fetched once");
    assert.equal(sent.length, 1);
    const { userId, event } = sent[0];
    assert.equal(userId, USER_ID);
    assert.deepEqual(Object.keys(event).sort(), [
        "component", "message", "payload", "phaseId", "questionId", "receivedAt", "resultId",
        "serviceId", "sessionId", "status", "userId",
    ]);
    assert.deepEqual(event.component, { documentSchema: "student-result/v1" });
    assert.deepEqual(event.payload, studentDocument());
    assert.notEqual(event.payload, document, "the emitted document is a copy");
    assert.equal(event.serviceId, SERVICE_ID);
    assert.equal(event.resultId, RESULT_ID);
    assert.ok(!Number.isNaN(Date.parse(event.receivedAt)));
    assert.deepEqual(refusals(output), []);
});

test("the declaration is cached between publications and refreshed after the TTL", async () => {
    const { registry, requests, sent, advance } = makeRegistry();

    await publishDocument(registry);
    await publishDocument(registry);
    assert.equal(requests.length, 1);

    advance(1000);
    await publishDocument(registry);
    assert.equal(requests.length, 2);
    assert.equal(sent.length, 3);
});

test("an invalid document is refused and logged with codes and paths only", async () => {
    const { registry, sent } = makeRegistry();
    const document = studentDocument({ tutorMode: PRIVATE_MARKER });
    document.sections[0].items[1].value = `${PRIVATE_MARKER}\nsecond line`;

    const { result, output } = await captureConsole(() => publishDocument(registry, { document }));

    assert.equal(result, false);
    assert.deepEqual(sent, []);
    assert.deepEqual(refusals(output), [{
        serviceId:      SERVICE_ID,
        userId:         USER_ID,
        resultId:       RESULT_ID,
        documentSchema: "student-result/v1",
        scope:          "response",
        declaration:    "known",
        problems:       [
            { code: "schema_violation", keyword: "not", path: "sections[0].items[1].value" },
            { code: "schema_violation", keyword: "not_allowed", path: "tutorMode" },
        ],
    }]);
    assertNoStudentText(output);
});

test("the two integrity rules refuse a document the schema accepts", async () => {
    const { registry, sent } = makeRegistry();
    const duplicate = studentDocument();
    duplicate.sections[0].items[1].key = "claim";
    const outOfRange = studentDocument();
    outOfRange.sections[0].items[0].score = 4;

    const { output } = await captureConsole(async () => {
        assert.equal(await publishDocument(registry, { document: duplicate }), false);
        assert.equal(await publishDocument(registry, { document: outOfRange }), false);
    });

    assert.deepEqual(sent, []);
    assert.deepEqual(refusals(output).map(refusal => refusal.problems), [
        [{ code: "duplicate_criterion_key", path: "sections[0].items[1].key" }],
        [{ code: "score_out_of_range", path: "sections[0].items[0].score" }],
    ]);
});

test("a valid document of a schema the service did not declare for the response scope is refused", async () => {
    const cases = [
        { label: "no student_outputs", responses: [withoutStudentOutputs()] },
        { label: "declared for chat only", responses: [tutorDescriptor([argumentFeedbackOutput(["chat"])])] },
    ];

    for (const { label, responses } of cases) {
        const { registry, sent } = makeRegistry({ responses });
        const { result, output } = await captureConsole(() => publishDocument(registry));

        assert.equal(result, false, label);
        assert.deepEqual(sent, [], label);
        const [refusal] = refusals(output);
        assert.equal(refusal.declaration, "known", label);
        assert.deepEqual(refusal.problems, [{ code: "undeclared_document_schema", path: "<root>" }], label);
        assertNoStudentText(output);
    }
});

test("a service without a capability descriptor or a catalog declaration declares nothing, so its documents are refused", async () => {
    const { registry, sent, requests } = makeRegistry();

    const { result, output } = await captureConsole(() => publishDocument(registry, {}, PLAIN_SERVICE_ID));

    assert.equal(result, false);
    assert.deepEqual(sent, []);
    assert.deepEqual(requests, []);
    const [refusal] = refusals(output);
    assert.equal(refusal.declaration, "no_descriptor");
    assert.deepEqual(refusal.problems, [{ code: "undeclared_document_schema", path: "<root>" }]);
});

// ─── Declarations in the catalog entry of a development adapter (#1134) ─────

// The normalized declaration a development adapter's catalog entry holds.
function manifestOutput(scopes = ["response"]) {
    return {
        id:             "mock-review",
        documentSchema: "student-result/v1",
        scopes,
        label:          "Mock review",
        description:    "Development review of each response.",
    };
}

function declareInCatalog(registry, serviceId, studentOutputs) {
    registry.services.set(serviceId, { ...registry.services.get(serviceId), studentOutputs });
}

test("a development adapter's catalog declaration lets its documents through, with no descriptor request", async () => {
    const { registry, sent, requests } = makeRegistry();
    declareInCatalog(registry, PLAIN_SERVICE_ID, [manifestOutput()]);

    const { result, output } = await captureConsole(() => publishDocument(registry, {}, PLAIN_SERVICE_ID));

    assert.equal(result, true, output.join("\n"));
    assert.deepEqual(requests, []);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].event.component, { documentSchema: "student-result/v1" });
    assert.deepEqual(sent[0].event.payload, studentDocument());
    assert.equal(sent[0].event.serviceId, PLAIN_SERVICE_ID);
});

test("a development adapter's documents are refused when its catalog declaration does not cover them", async () => {
    for (const studentOutputs of [[], [manifestOutput(["chat"])]]) {
        const { registry, sent } = makeRegistry();
        declareInCatalog(registry, PLAIN_SERVICE_ID, studentOutputs);

        const { result, output } = await captureConsole(() => publishDocument(registry, {}, PLAIN_SERVICE_ID));

        assert.equal(result, false);
        assert.deepEqual(sent, []);
        const [refusal] = refusals(output);
        assert.equal(refusal.declaration, "known");
        assert.deepEqual(refusal.problems, [{ code: "undeclared_document_schema", path: "<root>" }]);
        assertNoStudentText(output);
    }
});

test("a catalog declaration counts only on a development adapter without a descriptor link", async () => {
    // A production entry is rejected by the catalog when it declares there
    // (catalog.node-test.mjs); the registry ignores such a value anyway.
    const { registry, sent } = makeRegistry();
    registry.services.set(PLAIN_SERVICE_ID, {
        ...registry.services.get(PLAIN_SERVICE_ID),
        development:    false,
        studentOutputs: [manifestOutput()],
    });

    const { result, output } = await captureConsole(() => publishDocument(registry, {}, PLAIN_SERVICE_ID));

    assert.equal(result, false);
    assert.deepEqual(sent, []);
    assert.equal(refusals(output)[0].declaration, "no_descriptor");
});

test("a service with a descriptor link is judged by its descriptor only", async () => {
    const { registry, sent, requests } = makeRegistry({ responses: [withoutStudentOutputs()] });
    declareInCatalog(registry, SERVICE_ID, [manifestOutput()]);

    const { result, output } = await captureConsole(() => publishDocument(registry));

    assert.equal(result, false);
    assert.deepEqual(sent, []);
    assert.deepEqual(requests, [DESCRIPTOR_LINK.path]);
    const [refusal] = refusals(output);
    assert.equal(refusal.declaration, "known");
    assert.deepEqual(refusal.problems, [{ code: "undeclared_document_schema", path: "<root>" }]);
});

test("a document is refused while no declaration of the service has ever been fetched", async () => {
    const { registry, sent } = makeRegistry({ responses: [new Error("connect ECONNREFUSED")] });

    const { result, output } = await captureConsole(() => publishDocument(registry));

    assert.equal(result, false);
    assert.deepEqual(sent, []);
    const [refusal] = refusals(output);
    assert.equal(refusal.declaration, "unavailable");
    assert.deepEqual(refusal.problems, [{ code: "declaration_unavailable", path: "<root>" }]);
});

test("the last declaration fetched is used while the service is down", async () => {
    const { registry, sent, requests, advance } = makeRegistry({
        responses: [tutorDescriptor(), new Error("connect ECONNREFUSED")],
    });

    assert.equal(await publishDocument(registry), true);
    advance(1000);
    assert.equal(await publishDocument(registry), true);
    assert.equal(requests.length, 2, "it asked again, and the service was down");
    assert.equal(sent.length, 2);
});

test("the document is checked and sent in its JSON form", async () => {
    const { registry, sent } = makeRegistry();
    const document = studentDocument({ summary: undefined, status: undefined });

    assert.equal(await publishDocument(registry, { document }), true);

    const { summary: omittedSummary, ...expected } = studentDocument();
    assert.ok(omittedSummary);
    assert.deepEqual(sent[0].event.payload, expected);
    assert.equal(Object.hasOwn(sent[0].event.payload, "status"), false);
});

test("an unknown schema, a missing document and a mixed form are refused", async () => {
    const { registry, sent } = makeRegistry();

    const { output } = await captureConsole(async () => {
        assert.equal(await publishDocument(registry, { documentSchema: "student-result/v2" }), false);
        assert.equal(await publishDocument(registry, { documentSchema: PRIVATE_MARKER }), false);
        assert.equal(await publishDocument(registry, { document: undefined }), false);
        assert.equal(await publishDocument(registry, {
            component: { componentId: "argument-tutor-report" },
        }), false);
        assert.equal(await publishDocument(registry, { payload: studentDocument() }), false);
    });

    assert.deepEqual(sent, []);
    const logged = refusals(output);
    assert.deepEqual(logged.map(refusal => refusal.documentSchema),
        ["student-result/v2", null, "student-result/v1", "student-result/v1", "student-result/v1"]);
    assert.deepEqual(logged[0].problems.map(problem => problem.code),
        ["undeclared_document_schema", "unknown_document_schema"]);
    assert.ok(logged[2].problems.every(problem => problem.code === "schema_violation"));
    assert.deepEqual(logged[3].problems, [{ code: "ambiguous_result" }]);
    assert.deepEqual(logged[4].problems, [{ code: "ambiguous_result" }]);
    assertNoStudentText(output);
});

test("a legacy component that names a documentSchema is refused: documents take the document form", async () => {
    const { registry, sent, requests } = makeRegistry();

    const { result, output } = await captureConsole(() => registry.publishStudentResult(SERVICE_ID, {
        userId:    USER_ID,
        phaseId:   PHASE_ID,
        component: { documentSchema: "student-result/v1" },
        payload:   studentDocument(),
    }));

    assert.equal(result, false);
    assert.deepEqual(sent, []);
    assert.deepEqual(requests, []);
    assert.deepEqual(refusals(output)[0].problems, [{ code: "document_in_component" }]);
});

test("the legacy component path is emitted as passed, without a descriptor", async () => {
    const { registry, sent, requests } = makeRegistry({ responses: [new Error("down")] });
    const payload = {
        userId:     USER_ID,
        sessionId:  SESSION_ID,
        phaseId:    PHASE_ID,
        questionId: QUESTION_ID,
        resultId:   RESULT_ID,
        component:  { componentId: "argument-tutor-chat-feedback", title: "Argument Tutor Feedback" },
        payload:    { feedback: { summary: PRIVATE_MARKER } },
        message:    "Your argument tutor feedback is now available.",
        status:     "completed",
    };

    for (const serviceId of [SERVICE_ID, PLAIN_SERVICE_ID]) {
        assert.equal(await registry.publishStudentResult(serviceId, payload), true);
    }

    assert.deepEqual(requests, []);
    assert.deepEqual(sent.map(({ userId, event }) => {
        const { receivedAt, ...rest } = event;
        assert.ok(!Number.isNaN(Date.parse(receivedAt)));
        return { userId, event: rest };
    }), [
        { userId: USER_ID, event: { ...payload, serviceId: SERVICE_ID } },
        { userId: USER_ID, event: { ...payload, serviceId: PLAIN_SERVICE_ID } },
    ]);
});

test("without a valid userId or a student socket service nothing is sent", async () => {
    const { registry, sent } = makeRegistry();

    const { output } = await captureConsole(async () => {
        assert.equal(await publishDocument(registry, { userId: 0 }), false);
        assert.equal(await registry.publishStudentResult(SERVICE_ID, null), false);
    });
    assert.deepEqual(sent, []);
    assert.equal(output.filter(line => line.includes("without a valid userId")).length, 2);

    const offline = new ExternalServicesRegistry({ notifyStudentResult: () => false });
    const { result, output: offlineOutput } = await captureConsole(() => offline.publishStudentResult(
        SERVICE_ID,
        { userId: USER_ID, component: { componentId: "argument-tutor-report" }, payload: {} }
    ));
    assert.equal(result, false);
    assert.ok(offlineOutput.some(line => line.includes("notification service is not initialized")));
});

// ─── student-results-reading ─────────────────────────────────────────────────

function rebuiltEntry(resultId, overrides = {}) {
    return {
        resultId,
        phaseId:     PHASE_ID,
        questionId:  QUESTION_ID,
        component:   { documentSchema: "student-result/v1" },
        payload:     studentDocument(),
        message:     "Your feedback is ready.",
        status:      "completed",
        publishedAt: "2026-11-05T10:00:00.000Z",
        ...overrides,
    };
}

// A tutor handler that returns `entries(stored)` for the stored results.
function tutorHandler(entries) {
    return async (context, { results }) => entries(await results.list());
}

const STORED = [
    resultRow(RESULT_ID),
    resultRow(OTHER_RESULT_ID, { receivedAt: "2026-11-05T10:01:00.000Z" }),
    resultRow(LEGACY_RESULT_ID, { receivedAt: "2026-11-05T10:02:00.000Z" }),
];

test("rebuilt documents and legacy entries that pass are returned, and invalid documents dropped", async () => {
    const { registry, requests } = makeRegistry({
        storedResults: STORED,
        handlers:      {
            [SERVICE_ID]: tutorHandler(() => {
                const invalid = studentDocument({ claimTypeId: "AF1" });
                return [
                    rebuiltEntry(RESULT_ID),
                    rebuiltEntry(OTHER_RESULT_ID, { payload: invalid }),
                    rebuiltEntry(LEGACY_RESULT_ID, {
                        component: { componentId: "argument-tutor-chat-feedback" },
                        payload:   { feedback: { summary: PRIVATE_MARKER } },
                    }),
                ];
            }),
        },
    });
    // A live publication fetched the declaration earlier in the process.
    await publishDocument(registry);
    assert.equal(requests.length, 1);

    const { result, output } = await captureConsole(() => registry.collectStudentResults({
        sessionId: SESSION_ID, userId: USER_ID,
    }));

    assert.equal(requests.length, 1, "reading made no descriptor request");
    assert.deepEqual(result.map(entry => [entry.resultId, entry.component]), [
        [RESULT_ID, { documentSchema: "student-result/v1" }],
        [LEGACY_RESULT_ID, { componentId: "argument-tutor-chat-feedback" }],
    ]);
    assert.deepEqual(result[0].payload, studentDocument());
    assert.deepEqual(leftOut(output), [{
        serviceId: SERVICE_ID,
        sessionId: SESSION_ID,
        status:    "completed",
        kept:      2,
        dropped:   1,
        problems:  [
            "entries[1].payload (student-result/v1) is refused: schema_violation (not_allowed) at claimTypeId",
        ],
    }]);
    assertNoStudentText(output);
});

test("a rebuilt document of a schema the service no longer declares is dropped", async () => {
    const { registry, advance } = makeRegistry({
        responses:     [tutorDescriptor(), tutorDescriptor([argumentFeedbackOutput(["chat"])])],
        storedResults: STORED,
        handlers:      { [SERVICE_ID]: tutorHandler(() => [rebuiltEntry(RESULT_ID)]) },
    });
    await publishDocument(registry);
    advance(1000);
    // The published one was declared; the declaration changed since.
    await publishDocument(registry).catch(() => null);

    const { result, output } = await captureConsole(() => registry.collectStudentResults({
        sessionId: SESSION_ID, userId: USER_ID,
    }));

    assert.deepEqual(result, []);
    assert.deepEqual(leftOut(output)[0].problems, [
        "entries[0].payload (student-result/v1) is refused: undeclared_document_schema at <root>",
    ]);
});

test("rebuilt documents of a service without a descriptor are dropped, its legacy entries kept", async () => {
    const { registry, requests } = makeRegistry({
        storedResults: STORED,
        handlers:      {
            [PLAIN_SERVICE_ID]: tutorHandler(() => [
                rebuiltEntry(RESULT_ID),
                rebuiltEntry(LEGACY_RESULT_ID, {
                    component: { componentId: "argument-tutor-report" },
                    payload:   { summary: PRIVATE_MARKER },
                }),
            ]),
        },
    });

    const { result, output } = await captureConsole(() => registry.collectStudentResults({
        sessionId: SESSION_ID, userId: USER_ID,
    }));

    assert.deepEqual(result.map(entry => [entry.serviceId, entry.resultId]),
        [[PLAIN_SERVICE_ID, LEGACY_RESULT_ID]]);
    assert.deepEqual(requests, []);
    assert.deepEqual(leftOut(output)[0].problems, [
        "entries[0].payload (student-result/v1) is refused: undeclared_document_schema at <root>",
    ]);
    assertNoStudentText(output);
});

test("rebuilt documents of a development adapter are checked against its catalog declaration", async () => {
    const { registry, requests } = makeRegistry({
        storedResults: STORED,
        handlers:      {
            [PLAIN_SERVICE_ID]: tutorHandler(() => [
                rebuiltEntry(RESULT_ID),
                rebuiltEntry(OTHER_RESULT_ID, { payload: studentDocument({ claimTypeId: "AF1" }) }),
            ]),
        },
    });
    declareInCatalog(registry, PLAIN_SERVICE_ID, [manifestOutput()]);

    const { result, output } = await captureConsole(() => registry.collectStudentResults({
        sessionId: SESSION_ID, userId: USER_ID,
    }));

    assert.deepEqual(result.map(entry => [entry.serviceId, entry.resultId]), [[PLAIN_SERVICE_ID, RESULT_ID]]);
    assert.deepEqual(requests, []);
    assert.deepEqual(leftOut(output)[0].problems, [
        "entries[1].payload (student-result/v1) is refused: schema_violation (not_allowed) at claimTypeId",
    ]);
    assertNoStudentText(output);
});

test("reading never waits for the descriptor: with none fetched yet, documents are dropped and a refresh starts", async () => {
    let answer;
    const pending = new Promise(resolve => { answer = resolve; });
    const { registry, requests } = makeRegistry({
        responses:     [() => pending],
        storedResults: STORED,
        handlers:      { [SERVICE_ID]: tutorHandler(() => [rebuiltEntry(RESULT_ID)]) },
    });

    const first = await captureConsole(() => registry.collectStudentResults({
        sessionId: SESSION_ID, userId: USER_ID,
    }));

    assert.deepEqual(first.result, [], "the read did not wait for the descriptor");
    assert.deepEqual(leftOut(first.output)[0].problems, [
        "entries[0].payload (student-result/v1) is refused: declaration_unavailable at <root>",
    ]);
    // The refresh started in the background.
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(requests, [DESCRIPTOR_LINK.path]);

    answer(tutorDescriptor());
    await new Promise(resolve => setImmediate(resolve));

    const second = await registry.collectStudentResults({ sessionId: SESSION_ID, userId: USER_ID });
    assert.deepEqual(second.map(entry => entry.resultId), [RESULT_ID]);
    assert.equal(requests.length, 1);
});

test("a stale declaration still serves reads while a refresh runs in the background", async () => {
    const { registry, requests, advance } = makeRegistry({
        responses:     [tutorDescriptor(), new Error("connect ECONNREFUSED")],
        storedResults: STORED,
        handlers:      { [SERVICE_ID]: tutorHandler(() => [rebuiltEntry(RESULT_ID)]) },
    });
    await publishDocument(registry);
    advance(1000);

    const results = await registry.collectStudentResults({ sessionId: SESSION_ID, userId: USER_ID });
    assert.deepEqual(results.map(entry => entry.resultId), [RESULT_ID]);

    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests.length, 2, "the stale declaration was refreshed in the background");

    const again = await registry.collectStudentResults({ sessionId: SESSION_ID, userId: USER_ID });
    assert.deepEqual(again.map(entry => entry.resultId), [RESULT_ID], "kept while the service is down");
});

test("a rebuilt document's component holds documentSchema only, and its payload is an object", async () => {
    const { registry } = makeRegistry({
        storedResults: STORED,
        handlers:      {
            [SERVICE_ID]: tutorHandler(() => [
                rebuiltEntry(RESULT_ID, {
                    component: { documentSchema: "student-result/v1", componentId: "argument-tutor-report" },
                }),
                rebuiltEntry(OTHER_RESULT_ID, { payload: [] }),
            ]),
        },
    });
    await publishDocument(registry);

    const { result, output } = await captureConsole(() => registry.collectStudentResults({
        sessionId: SESSION_ID, userId: USER_ID,
    }));

    assert.deepEqual(result, []);
    assert.deepEqual(leftOut(output)[0].problems, [
        "entries[0].component of a document must hold documentSchema only",
        "entries[1].payload must be a plain data object",
    ]);
});
