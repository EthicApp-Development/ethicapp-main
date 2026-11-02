// The report-building hook (epic #620, #944): its collecting dispatch, the
// scoped results reader and the contribution contract.
import assert from "node:assert/strict";
import test from "node:test";

import { ExternalServicesRegistry } from "../external-services.service.js";
import {
    CONTRIBUTION_STATUS,
    MAX_CONTRIBUTION_STRING_LENGTH,
    REPORT_BUILDING_HOOK,
    REPORT_CONTRIBUTION_TIMEOUT_MS,
    validateReportContribution,
} from "../external-service-report-contributions.js";
import {
    createReportResultsReader,
    ExternalServiceReportResultsService,
} from "../external-service-report-results.service.js";
import { captureWarnings } from "./capture-warnings.mjs";

const SESSION_ID = 12;

const RESPONSE_ROWS = [
    { responseId: 101, phaseId: 1, questionId: 7, userId: 31, groupId: null },
    { responseId: 102, phaseId: 1, questionId: 7, userId: 32, groupId: null },
];

const CHAT_ROWS = [{
    messageId:         501,
    phaseId:           2,
    questionId:        7,
    groupId:           4,
    userId:            31,
    externalServiceId: null,
    time:              "2026-10-01T10:00:00.000Z",
}];

// Any job or result write fails the test: the collecting dispatch creates none.
const forbiddenJobsService = new Proxy({}, {
    get: (target, name) => async () => assert.fail(`the collecting dispatch must not call jobsService.${String(name)}`),
});

// Any policy read fails the test: the policy does not decide who is asked.
const forbiddenPolicy = {
    getCurrentPolicyVersion:   async () => assert.fail("the policy must not be read"),
    getPolicyVersion:          async () => assert.fail("the policy must not be read"),
    getSessionPolicyVersionId: async () => assert.fail("the policy must not be read"),
};

function fakeResultsStore({ sessionServiceIds = [], results = [] } = {}) {
    const calls = [];
    return {
        calls,
        async listSessionServiceIds(sessionId) {
            calls.push({ name: "listSessionServiceIds", sessionId });
            return sessionServiceIds;
        },
        async listResults(args) {
            calls.push({ name: "listResults", ...args });
            return results;
        },
    };
}

function serviceEntry(id, { prefix = `${id.replace(/[^a-z0-9]/gu, "")}_`, hooks = [REPORT_BUILDING_HOOK] } = {}) {
    return {
        id,
        development: false,
        requires:    ["argumentation-tutor"],
        hooks,
        globalHooks: [],
        scopes:      ["response"],
        report:      prefix ? { columnPrefix: prefix } : null,
    };
}

function makeRegistry({ services = [], resultsStore = fakeResultsStore(), timeoutMs } = {}) {
    const registry = new ExternalServicesRegistry({
        jobsService:                 forbiddenJobsService,
        roomJobsService:             { closeRoomJobs: async () => 0 },
        aiServicePolicy:             forbiddenPolicy,
        isAiAdditionsConfigured:     async () => assert.fail("the connection must not be read"),
        reportResultsStore:          resultsStore,
        reportContributionTimeoutMs: timeoutMs,
    });
    registry.initialized = true;
    for (const service of services) {
        registry.services.set(service.id, service);
    }
    return registry;
}

// ─── subscribe ──────────────────────────────────────────────────────────────

test("subscribe accepts a report-building handler only from a service that declares the hook and its prefix", async () => {
    const registry = makeRegistry({
        services: [
            serviceEntry("tutor"),
            serviceEntry("undeclared", { hooks: ["phase-ended"] }),
            serviceEntry("unprefixed", { prefix: null }),
        ],
    });

    const { warnings } = await captureWarnings(() => {
        registry.subscribe("tutor", REPORT_BUILDING_HOOK, async () => null);
        registry.subscribe("tutor", REPORT_BUILDING_HOOK, async () => null);
        registry.subscribe("undeclared", REPORT_BUILDING_HOOK, async () => null);
        registry.subscribe("unprefixed", REPORT_BUILDING_HOOK, async () => null);
        registry.subscribe("unknown", REPORT_BUILDING_HOOK, async () => null);
    });

    assert.deepEqual(registry.hookSubscribers.get(REPORT_BUILDING_HOOK).map(({ serviceId }) => serviceId), ["tutor"]);
    assert.equal(warnings.length, 4);
    assert.ok(warnings[0].includes("second report-building handler of tutor"));
});

test("dispatchHook ignores report-building, so it creates no job", async () => {
    const registry = makeRegistry({ services: [serviceEntry("tutor")] });
    let called = false;
    registry.subscribe("tutor", REPORT_BUILDING_HOOK, async () => { called = true; });

    const { result, warnings } = await captureWarnings(() => registry.dispatchHook(
        REPORT_BUILDING_HOOK, { sessionId: SESSION_ID }, { enabledServiceIds: ["tutor"] }
    ));

    assert.deepEqual(result, []);
    assert.equal(called, false);
    assert.ok(warnings[0].includes("is not dispatched through dispatchHook()"));
});

// ─── Selection ──────────────────────────────────────────────────────────────

test("only registered subscribers with a job in the session are asked, whatever the policy", async () => {
    const resultsStore = fakeResultsStore({ sessionServiceIds: ["tutor", "polyadic", "silent"] });
    const registry = makeRegistry({
        services: [serviceEntry("tutor"), serviceEntry("polyadic"), serviceEntry("idle"), serviceEntry("silent")],
        resultsStore,
    });
    const asked = [];
    for (const serviceId of ["tutor", "polyadic", "idle"]) {
        registry.subscribe(serviceId, REPORT_BUILDING_HOOK, async context => {
            asked.push(context.serviceId);
            return null;
        });
    }
    // A subscriber whose service is no longer registered.
    registry.hookSubscribers.get(REPORT_BUILDING_HOOK).push({
        serviceId: "gone",
        handler:   async () => assert.fail("an unregistered service is not asked"),
    });

    const outcomes = await registry.collectReportContributions("responses", {
        sessionId: SESSION_ID, designType: "semantic_differential", rows: RESPONSE_ROWS,
    });

    assert.deepEqual(asked.sort(), ["polyadic", "tutor"]);
    assert.deepEqual(outcomes.map(({ serviceId, status }) => [serviceId, status]), [
        ["tutor", CONTRIBUTION_STATUS.COMPLETED],
        ["polyadic", CONTRIBUTION_STATUS.COMPLETED],
    ]);
    assert.deepEqual(resultsStore.calls, [{ name: "listSessionServiceIds", sessionId: SESSION_ID }]);
});

test("no subscriber means no database read", async () => {
    const resultsStore = fakeResultsStore();
    const registry = makeRegistry({ services: [serviceEntry("tutor")], resultsStore });

    assert.deepEqual(await registry.collectReportContributions("responses", {
        sessionId: SESSION_ID, rows: [],
    }), []);
    assert.deepEqual(resultsStore.calls, []);
});

test("collectReportContributions rejects an unknown report type or a missing session or rows", async () => {
    const registry = makeRegistry();

    await assert.rejects(() => registry.collectReportContributions("ranking", { sessionId: 1, rows: [] }), TypeError);
    await assert.rejects(() => registry.collectReportContributions("responses", { rows: [] }), TypeError);
    await assert.rejects(() => registry.collectReportContributions("responses", { sessionId: 1 }), TypeError);
});

// ─── Handlers ───────────────────────────────────────────────────────────────

test("a handler receives a frozen context, a results reader and a signal, and no callback", async () => {
    const registry = makeRegistry({
        services:     [serviceEntry("tutor")],
        resultsStore: fakeResultsStore({ sessionServiceIds: ["tutor"] }),
    });
    let received;
    registry.subscribe("tutor", REPORT_BUILDING_HOOK, async (context, tools) => {
        received = { context, tools };
        return null;
    });

    await registry.collectReportContributions("chat_transcript", {
        sessionId: SESSION_ID, designType: "semantic_differential", rows: CHAT_ROWS, extra: "dropped",
    });

    const { context, tools } = received;
    assert.deepEqual(Object.keys(tools).sort(), ["results", "signal"]);
    assert.equal(typeof tools.results.list, "function");
    assert.equal(tools.signal.aborted, false);
    assert.deepEqual(context, {
        reportType: "chat_transcript",
        serviceId:  "tutor",
        sessionId:  SESSION_ID,
        designType: "semantic_differential",
        rows:       CHAT_ROWS,
    });
    assert.ok(Object.isFrozen(context) && Object.isFrozen(context.rows) && Object.isFrozen(context.rows[0]));
    assert.notEqual(context.rows[0], CHAT_ROWS[0], "the rows are copies");
});

test("a failing, slow or invalid handler yields its own outcome and the others are still returned", async () => {
    const registry = makeRegistry({
        services:     ["valid", "throws", "slow", "invalid"].map(id => serviceEntry(id)),
        resultsStore: fakeResultsStore({ sessionServiceIds: ["valid", "throws", "slow", "invalid"] }),
        timeoutMs:    20,
    });
    let slowSignal;
    registry.subscribe("valid", REPORT_BUILDING_HOOK, async () => ({
        columns: [{ id: "valid_score", label: "Score" }],
        values:  [{ rowKey: 101, values: { valid_score: 3 } }],
    }));
    registry.subscribe("throws", REPORT_BUILDING_HOOK, () => {
        throw new Error("Private student text in an error");
    });
    registry.subscribe("slow", REPORT_BUILDING_HOOK, (context, { signal }) => {
        slowSignal = signal;
        return new Promise(resolve => setTimeout(() => resolve(null), 200));
    });
    registry.subscribe("invalid", REPORT_BUILDING_HOOK, async () => ({
        columns: [{ id: "invalid_note" }],
        values:  [{ rowKey: 999, values: { invalid_note: "Private student text" } }],
    }));

    const { result: outcomes, warnings } = await captureWarnings(() => registry.collectReportContributions(
        "responses", { sessionId: SESSION_ID, rows: RESPONSE_ROWS }
    ));

    assert.deepEqual(outcomes, [
        {
            serviceId:    "valid",
            status:       CONTRIBUTION_STATUS.COMPLETED,
            contribution: {
                columns: [{ id: "valid_score", label: "Score" }],
                values:  [{ rowKey: 101, values: { valid_score: 3 } }],
                rows:    [],
            },
        },
        { serviceId: "throws", status: CONTRIBUTION_STATUS.FAILED, reason: "the handler failed" },
        { serviceId: "slow", status: CONTRIBUTION_STATUS.TIMED_OUT, reason: "timed out after 20 ms" },
        {
            serviceId: "invalid",
            status:    CONTRIBUTION_STATUS.INVALID,
            reason:    "the contribution is invalid",
            problems:  ["values[0].rowKey is not a row of the report"],
        },
    ]);
    assert.equal(slowSignal.aborted, true, "a timed-out handler's signal is aborted");

    assert.equal(warnings.length, 3);
    for (const serviceId of ["throws", "slow", "invalid"]) {
        assert.ok(warnings.some(warning => warning.includes(`contribution of ${serviceId} for the responses report`)));
    }
    assert.ok(!warnings.find(warning => warning.includes("contribution of invalid")).includes("Private student text"),
        "an invalid contribution is logged without its values");
});

test("the default timeout is five seconds", () => {
    assert.equal(REPORT_CONTRIBUTION_TIMEOUT_MS, 5000);
});

test("a service registered without a prefix is invalid, not asked", async () => {
    const registry = makeRegistry({
        services:     [serviceEntry("tutor")],
        resultsStore: fakeResultsStore({ sessionServiceIds: ["tutor"] }),
    });
    registry.subscribe("tutor", REPORT_BUILDING_HOOK, async () => assert.fail("not asked"));
    registry.services.get("tutor").report = null;

    const { result } = await captureWarnings(() => registry.collectReportContributions(
        "responses", { sessionId: SESSION_ID, rows: [] }
    ));

    assert.equal(result[0].status, CONTRIBUTION_STATUS.INVALID);
});

test("reserved report columns cannot be reused", async () => {
    const registry = makeRegistry({
        services:     [serviceEntry("ats", { prefix: "ats_" })],
        resultsStore: fakeResultsStore({ sessionServiceIds: ["ats"] }),
    });
    registry.subscribe("ats", REPORT_BUILDING_HOOK, async () => ({ columns: [{ id: "ats_user" }] }));

    const { result } = await captureWarnings(() => registry.collectReportContributions(
        "responses", { sessionId: SESSION_ID, rows: RESPONSE_ROWS }, { reservedColumnIds: ["ats_user"] }
    ));

    assert.deepEqual(result[0].problems, ["columns[0].id ats_user is a report column"]);
});

// ─── Results reader ─────────────────────────────────────────────────────────

test("the reader handed to a handler is bound to its service and the report's session", async () => {
    const resultsStore = fakeResultsStore({
        sessionServiceIds: ["tutor"],
        results:           [
            {
                id:             "r1",
                job_id:         "j1",
                service_id:     "tutor",
                session_id:     SESSION_ID,
                status:         "completed",
                phase_id:       1,
                question_id:    7,
                group_id:       null,
                user_id:        31,
                raw_payload:    { summary: "ok" },
                adapter_result: { status: "completed" },
                received_at:    new Date("2026-10-01T10:00:00.000Z"),
                job_hook_name:  "student-response-submitted",
            },
            // A store that ignored the scope: these never reach the adapter.
            { id: "r2", service_id: "polyadic", session_id: SESSION_ID, status: "completed" },
            { id: "r3", service_id: "tutor", session_id: 99, status: "completed" },
        ],
    });
    const registry = makeRegistry({ services: [serviceEntry("tutor")], resultsStore });
    let listed;
    registry.subscribe("tutor", REPORT_BUILDING_HOOK, async (context, { results }) => {
        listed = await results.list({ hookName: "student-response-submitted", questionId: 7 });
        return null;
    });

    await registry.collectReportContributions("responses", { sessionId: SESSION_ID, rows: RESPONSE_ROWS });

    assert.deepEqual(resultsStore.calls[1], {
        name:      "listResults",
        serviceId: "tutor",
        sessionId: SESSION_ID,
        filters:   { hookName: "student-response-submitted", questionId: 7 },
    });
    assert.deepEqual(listed, [{
        id:            "r1",
        jobId:         "j1",
        hookName:      "student-response-submitted",
        status:        "completed",
        phaseId:       1,
        questionId:    7,
        groupId:       null,
        userId:        31,
        source:        null,
        rawPayload:    { summary: "ok" },
        adapterResult: { status: "completed" },
        receivedAt:    "2026-10-01T10:00:00.000Z",
    }]);
});

test("the reader rejects unknown or malformed filters, including attempts to change its scope", async () => {
    const reader = createReportResultsReader(fakeResultsStore(), { serviceId: "tutor", sessionId: SESSION_ID });

    await assert.rejects(() => reader.list({ serviceId: "polyadic" }), /Unknown result filters: serviceId/u);
    await assert.rejects(() => reader.list({ sessionId: 99 }), /Unknown result filters: sessionId/u);
    await assert.rejects(() => reader.list({ phaseId: "1" }), /phaseId must be a positive integer/u);
    await assert.rejects(() => reader.list({ hookName: "" }), /hookName must be a hook name/u);
    await assert.rejects(() => reader.list([]), TypeError);
    assert.deepEqual(await reader.list(), []);
    assert.deepEqual(await reader.list({ userId: undefined }), []);
});

test("listResults binds the service, the session and the filters, and leaves out pending results", async () => {
    const queries = [];
    const store = new ExternalServiceReportResultsService({
        dbQuery: async (sql, params) => { queries.push({ sql, params }); return []; },
    });

    await store.listResults({
        serviceId: "tutor", sessionId: SESSION_ID, filters: { hookName: "phase-ended", userId: 31 },
    });
    await store.listSessionServiceIds(SESSION_ID);

    const [{ sql, params }, sessionQuery] = queries;
    assert.match(sql, /WHERE r\.service_id = \$1 AND r\.session_id = \$2 AND r\.status <> \$3 AND j\.hook_name = \$4 AND r\.user_id = \$5/u);
    assert.match(sql, /ORDER BY r\.received_at ASC, r\.id ASC/u);
    assert.deepEqual(params, ["tutor", SESSION_ID, "pending", "phase-ended", 31]);
    assert.match(sessionQuery.sql, /SELECT DISTINCT service_id\s+FROM external_service_jobs\s+WHERE session_id = \$1/u);
    assert.deepEqual(sessionQuery.params, [SESSION_ID]);
    assert.ok(queries.every(({ sql: text }) => !/INSERT|UPDATE|DELETE/u.test(text)), "the store only reads");
});

// ─── Contribution contract ──────────────────────────────────────────────────

function validate(contribution, { reportType = "responses", rows = RESPONSE_ROWS, reserved = [] } = {}) {
    const keyName = reportType === "responses" ? "responseId" : "messageId";
    return validateReportContribution(contribution, {
        reportType,
        rowKeys:           new Map(rows.map(row => [String(row[keyName]), row[keyName]])),
        columnPrefix:      "ats_",
        reservedColumnIds: new Set(reserved),
    });
}

test("an empty or absent contribution is valid", () => {
    for (const contribution of [undefined, null, {}]) {
        assert.deepEqual(validate(contribution), {
            valid: true, contribution: { columns: [], values: [], rows: [] }, problems: [],
        });
    }
});

test("values accept scalars on declared columns, keyed by the report's rows", () => {
    const { valid, contribution } = validate({
        columns: [{ id: "ats_title", label: "Title" }, { id: "ats_score" }, { id: "ats_ok" }],
        values:  [
            { rowKey: "101", values: { ats_title: "A", ats_score: 2.5, ats_ok: true } },
            { rowKey: 102, values: { ats_title: null } },
        ],
    });

    assert.equal(valid, true);
    assert.deepEqual(contribution.columns, [
        { id: "ats_title", label: "Title" }, { id: "ats_score", label: null }, { id: "ats_ok", label: null },
    ]);
    assert.deepEqual(contribution.values.map(entry => entry.rowKey), [101, 102], "row keys keep the report's type");
});

test("the contract rejects what the generator could not merge", () => {
    const cases = [
        [{ extra: 1 }, "the contribution has unknown keys"],
        ["text", "the contribution must be an object"],
        [{ columns: [{ id: "other_title" }] }, "columns[0].id must be a snake_case id that starts with ats_"],
        [{ columns: [{ id: "ats_" }] }, "columns[0].id must be a snake_case id that starts with ats_"],
        [{ columns: [{ id: "ats_a" }, { id: "ats_a" }] }, "columns[1].id ats_a is repeated"],
        [{ columns: [{ id: "ats_a", label: 3 }] }, "columns[0].label must be a string"],
        [{ values: [{ rowKey: 999, values: {} }] }, "values[0].rowKey is not a row of the report"],
        [{ values: [{ rowKey: 101, values: {} }, { rowKey: "101", values: {} }] },
            "values[1].rowKey repeats an earlier entry"],
        [{ values: [{ rowKey: 101, values: { ats_unknown: 1 } }] }, "names undeclared column ats_unknown"],
        [{ columns: [{ id: "ats_a" }], values: [{ rowKey: 101, values: { ats_a: { nested: true } } }] },
            "values[0].values.ats_a must be a string"],
        [{ columns: [{ id: "ats_a" }], values: [{ rowKey: 101, values: { ats_a: [1] } }] },
            "values[0].values.ats_a must be a string"],
        [{ columns: [{ id: "ats_a" }], values: [{ rowKey: 101, values: { ats_a: Number.NaN } }] },
            "values[0].values.ats_a must be a string"],
        [{ columns: [{ id: "ats_a" }],
            values:  [{ rowKey: 101, values: { ats_a: "x".repeat(MAX_CONTRIBUTION_STRING_LENGTH + 1) } }] },
        "values[0].values.ats_a must be a string"],
        [{ rows: [] }, "rows are not accepted by the responses report"],
    ];

    for (const [contribution, fragment] of cases) {
        const { valid, contribution: normalized, problems } = validate(contribution);
        assert.equal(valid, false, fragment);
        assert.equal(normalized, null);
        assert.ok(problems.some(problem => problem.includes(fragment)),
            `expected "${fragment}", got ${JSON.stringify(problems)}`);
    }
});

test("the chat transcript accepts contributed rows and normalizes them", () => {
    const { valid, contribution, problems } = validate({
        columns: [{ id: "ats_visible" }],
        values:  [{ rowKey: 501, values: { ats_visible: true } }],
        rows:    [{
            phaseId:    2,
            questionId: 7,
            groupId:    4,
            time:       "2026-10-01T10:05:00Z",
            message:    "Evaluation",
            values:     { ats_visible: false },
        }],
    }, { reportType: "chat_transcript", rows: CHAT_ROWS });

    assert.deepEqual(problems, []);
    assert.equal(valid, true);
    assert.deepEqual(contribution.rows, [{
        phaseId:    2,
        questionId: 7,
        groupId:    4,
        time:       "2026-10-01T10:05:00.000Z",
        message:    "Evaluation",
        values:     { ats_visible: false },
    }]);
});

test("contributed chat rows need a phase and a time, and carry only declared scalars", () => {
    const { valid, problems } = validate({
        rows: [
            { phaseId: 0, time: "not a date", message: 5, values: { ats_x: 1 }, userId: 31 },
        ],
    }, { reportType: "chat_transcript", rows: CHAT_ROWS });

    assert.equal(valid, false);
    assert.deepEqual(problems, [
        "rows[0] has unknown keys",
        "rows[0].phaseId must be a positive integer",
        "rows[0].time must be a date",
        `rows[0].message must be a string of at most ${MAX_CONTRIBUTION_STRING_LENGTH} characters or null`,
        "rows[0].values names undeclared column ats_x",
    ]);
});
