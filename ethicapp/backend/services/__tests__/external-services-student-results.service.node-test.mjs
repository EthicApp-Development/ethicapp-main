// The student-results-reading hook (epic #1123, #1125): its collecting
// dispatch, which services it asks, the reader bound to one student and the
// validation of what adapters return.
import assert from "node:assert/strict";
import test from "node:test";

import { ExternalServicesRegistry } from "../external-services.service.js";
import { createStudentResultsReader } from "../external-service-report-results.service.js";
import {
    STUDENT_RESULTS_READING_HOOK,
    STUDENT_RESULTS_TIMEOUT_MS,
    validateStudentResults,
} from "../external-service-student-results.js";
import { captureWarnings } from "./capture-warnings.mjs";

const SESSION_ID = 12;
const USER_ID = 31;
const POLICY_VERSION_ID = 4;

// Student text that may appear in an adapter's error or entries, and must
// never reach a log.
const PRIVATE_MARKER = "private student argument 1125";

const RESULT_IDS = Object.freeze({
    tutorFirst:  "a0000000-0000-4000-8000-000000000001",
    tutorSecond: "a0000000-0000-4000-8000-000000000002",
    otherFirst:  "b0000000-0000-4000-8000-000000000001",
});

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

// Any job or result write fails the test: the collecting dispatch creates none.
const forbiddenJobsService = new Proxy({}, {
    get: (target, name) => async () => assert.fail(`the collecting dispatch must not call jobsService.${String(name)}`),
});

function resultRow(id, serviceId, { phaseId = 1, questionId = 7, userId = USER_ID, sessionId = SESSION_ID,
    receivedAt = "2026-11-05T10:00:00.000Z" } = {}) {
    return {
        id,
        job_id:         `job-${id}`,
        service_id:     serviceId,
        session_id:     sessionId,
        status:         "completed",
        phase_id:       phaseId,
        question_id:    questionId,
        group_id:       null,
        user_id:        userId,
        raw_payload:    { summary: PRIVATE_MARKER },
        adapter_result: { status: "completed" },
        received_at:    new Date(receivedAt),
        job_hook_name:  "student-response-submitted",
    };
}

// A store whose results are keyed by service id, and which, like a store that
// ignored its scope, returns them whatever the filters say.
function fakeResultsStore(resultsByService = {}) {
    const calls = [];
    return {
        calls,
        async listSessionServiceIds() {
            assert.fail("student results do not depend on the session's jobs");
        },
        async listResults(args) {
            calls.push(args);
            return resultsByService[args.serviceId] ?? [];
        },
    };
}

function serviceEntry(id, { hooks = [STUDENT_RESULTS_READING_HOOK], development = false,
    requires = ["argumentation-tutor"] } = {}) {
    return {
        id,
        development,
        requires:    development ? [] : requires,
        hooks,
        globalHooks: [],
        scopes:      ["response"],
        report:      null,
    };
}

function makeRegistry({
    services = [],
    resultsStore = fakeResultsStore(),
    sessionServiceIds = services.map(service => service.id),
    allowedServiceIds = ["argumentation-tutor", "polyadic-agent"],
    disabledAdapterIds = [],
    timeoutMs,
    developmentAdapters = true,
} = {}) {
    const reads = { sessions: [], pins: [] };
    const registry = new ExternalServicesRegistry({
        jobsService:             forbiddenJobsService,
        roomJobsService:         { closeRoomJobs: async () => 0 },
        reportResultsStore:      resultsStore,
        studentResultsTimeoutMs: timeoutMs,
        developmentAdapters,
        loadSessionServiceIds:   async sessionId => {
            reads.sessions.push(sessionId);
            if (sessionServiceIds instanceof Error) {
                throw sessionServiceIds;
            }
            return sessionServiceIds;
        },
        aiServicePolicy: {
            getCurrentPolicyVersion:   async () => assert.fail("the current policy is not read"),
            getSessionPolicyVersionId: async sessionId => {
                reads.pins.push(sessionId);
                return POLICY_VERSION_ID;
            },
            getPolicyVersion: async versionId => {
                assert.equal(versionId, POLICY_VERSION_ID);
                return { id: POLICY_VERSION_ID, allowedServiceIds, disabledAdapterIds };
            },
        },
        // Reading stored results calls no AI service.
        isAiAdditionsConfigured: async () => assert.fail("the connection must not be read"),
    });
    registry.initialized = true;
    for (const service of services) {
        registry.services.set(service.id, service);
    }
    return { registry, reads };
}

// A handler that returns one entry per result its reader returns, as an
// adapter rebuilding what it published would.
function echoHandler({ status = "completed" } = {}) {
    return async (context, { results }) => (await results.list()).map(result => ({
        resultId:    result.id,
        phaseId:     result.phaseId,
        questionId:  result.questionId,
        component:   { componentId: "argument-tutor-chat-feedback", title: "Argument Tutor Feedback" },
        payload:     { feedback: { summary: "Rebuilt" } },
        message:     "Your argument tutor feedback is now available.",
        status,
        publishedAt: result.receivedAt,
    }));
}

// ─── subscribe and dispatchHook ─────────────────────────────────────────────

test("subscribe accepts a student-results-reading handler only from a service that lists the hook, once", async () => {
    const { registry } = makeRegistry({
        services: [serviceEntry("tutor"), serviceEntry("undeclared", { hooks: ["phase-ended"] })],
    });

    const { warnings } = await captureWarnings(() => {
        registry.subscribe("tutor", STUDENT_RESULTS_READING_HOOK, async () => null);
        registry.subscribe("tutor", STUDENT_RESULTS_READING_HOOK, async () => null);
        registry.subscribe("undeclared", STUDENT_RESULTS_READING_HOOK, async () => null);
        registry.subscribe("unknown", STUDENT_RESULTS_READING_HOOK, async () => null);
    });

    assert.deepEqual(
        registry.hookSubscribers.get(STUDENT_RESULTS_READING_HOOK).map(({ serviceId }) => serviceId),
        ["tutor"]
    );
    assert.equal(warnings.length, 3);
    assert.ok(warnings[0].includes("second student-results-reading handler of tutor"));
    assert.ok(warnings[1].includes("its catalog entry must list the hook"));
});

test("dispatchHook ignores student-results-reading, so it creates no job", async () => {
    const { registry } = makeRegistry({ services: [serviceEntry("tutor")] });
    registry.subscribe("tutor", STUDENT_RESULTS_READING_HOOK, async () => assert.fail("not dispatched"));

    const { result, warnings } = await captureWarnings(() => registry.dispatchHook(
        STUDENT_RESULTS_READING_HOOK, { sessionId: SESSION_ID, userId: USER_ID }, { enabledServiceIds: ["tutor"] }
    ));

    assert.deepEqual(result, []);
    assert.ok(warnings[0].includes("student-results-reading is not dispatched through dispatchHook()"));
});

// ─── Which services are asked ───────────────────────────────────────────────

test("only the subscribed services the session's design enables and its pinned policy allows are asked", async () => {
    const services = [
        serviceEntry("tutor"),
        serviceEntry("not-in-design"),
        serviceEntry("disabled-by-pin"),
        serviceEntry("unallowed", { requires: ["case-analyst"] }),
        serviceEntry("mock", { development: true }),
        serviceEntry("unsubscribed"),
    ];
    const { registry, reads } = makeRegistry({
        services,
        sessionServiceIds:  ["tutor", "disabled-by-pin", "unallowed", "mock", "unsubscribed", "unregistered"],
        disabledAdapterIds: ["disabled-by-pin"],
    });
    const asked = [];
    for (const serviceId of ["tutor", "not-in-design", "disabled-by-pin", "unallowed", "mock"]) {
        registry.subscribe(serviceId, STUDENT_RESULTS_READING_HOOK, async context => {
            asked.push(context.serviceId);
            return [];
        });
    }

    const results = await registry.collectStudentResults({ sessionId: SESSION_ID, userId: USER_ID });

    assert.deepEqual(results, []);
    assert.deepEqual(asked.sort(), ["mock", "tutor"]);
    assert.deepEqual(reads, { sessions: [SESSION_ID], pins: [SESSION_ID] });
});

test("a session launched with its AI services off enables no service, so none is asked", async () => {
    // getEnabledExternalServiceIdsBySessionId() answers [] for it (#970).
    const { registry, reads } = makeRegistry({
        services:          [serviceEntry("tutor"), serviceEntry("mock", { development: true })],
        sessionServiceIds: [],
    });
    for (const serviceId of ["tutor", "mock"]) {
        registry.subscribe(serviceId, STUDENT_RESULTS_READING_HOOK, async () => assert.fail("not asked"));
    }

    assert.deepEqual(await registry.collectStudentResults({ sessionId: SESSION_ID, userId: USER_ID }), []);
    assert.deepEqual(reads.pins, [], "the pin is not read when no production adapter is left");
});

test("a pin that cannot be read allows development adapters only", async () => {
    const { registry } = makeRegistry({
        services: [serviceEntry("tutor"), serviceEntry("mock", { development: true })],
    });
    registry._aiServicePolicy = {
        getSessionPolicyVersionId: async () => { throw new Error("database down"); },
    };
    const asked = [];
    for (const serviceId of ["tutor", "mock"]) {
        registry.subscribe(serviceId, STUDENT_RESULTS_READING_HOOK, async context => {
            asked.push(context.serviceId);
            return [];
        });
    }

    await captureConsole(() => registry.collectStudentResults({ sessionId: SESSION_ID, userId: USER_ID }));

    assert.deepEqual(asked, ["mock"]);
});

test("no subscriber means no database read", async () => {
    const resultsStore = fakeResultsStore();
    const { registry, reads } = makeRegistry({ services: [serviceEntry("tutor")], resultsStore });

    assert.deepEqual(await registry.collectStudentResults({ sessionId: SESSION_ID, userId: USER_ID }), []);
    assert.deepEqual(reads, { sessions: [], pins: [] });
    assert.deepEqual(resultsStore.calls, []);
});

test("collectStudentResults rejects a context without positive integer ids, or when the session cannot be read", async () => {
    const { registry } = makeRegistry({
        services:          [serviceEntry("tutor")],
        sessionServiceIds: new Error("database down"),
    });
    registry.subscribe("tutor", STUDENT_RESULTS_READING_HOOK, async () => []);

    for (const context of [undefined, {}, { sessionId: SESSION_ID }, { sessionId: "12", userId: USER_ID },
        { sessionId: SESSION_ID, userId: 0 }, { sessionId: 1.5, userId: USER_ID }]) {
        await assert.rejects(() => registry.collectStudentResults(context), TypeError);
    }
    await assert.rejects(
        () => registry.collectStudentResults({ sessionId: SESSION_ID, userId: USER_ID }),
        /database down/u
    );
});

// ─── Handlers and the reader ────────────────────────────────────────────────

test("a handler receives a frozen context, a results reader and a signal, and no callback", async () => {
    const { registry } = makeRegistry({ services: [serviceEntry("tutor")] });
    let received;
    registry.subscribe("tutor", STUDENT_RESULTS_READING_HOOK, async (context, tools) => {
        received = { context, tools };
        return null;
    });

    await registry.collectStudentResults({ sessionId: SESSION_ID, userId: USER_ID, extra: "dropped" });

    const { context, tools } = received;
    assert.deepEqual(context, { serviceId: "tutor", sessionId: SESSION_ID, userId: USER_ID });
    assert.ok(Object.isFrozen(context));
    assert.deepEqual(Object.keys(tools).sort(), ["results", "signal"]);
    assert.ok(Object.isFrozen(tools.results));
    assert.equal(tools.signal.aborted, false);
});

test("the reader is bound to its service, the session and the student", async () => {
    const resultsStore = fakeResultsStore({
        tutor: [
            resultRow(RESULT_IDS.tutorFirst, "tutor"),
            // What a store that ignored its scope would add: another
            // service's, another session's and another student's results.
            resultRow(RESULT_IDS.otherFirst, "other"),
            resultRow("c0000000-0000-4000-8000-000000000001", "tutor", { sessionId: 99 }),
            resultRow("c0000000-0000-4000-8000-000000000002", "tutor", { userId: 32 }),
            resultRow("c0000000-0000-4000-8000-000000000003", "tutor", { userId: null }),
        ],
    });
    const { registry } = makeRegistry({ services: [serviceEntry("tutor")], resultsStore });
    let listed;
    registry.subscribe("tutor", STUDENT_RESULTS_READING_HOOK, async (context, { results }) => {
        listed = await results.list({ hookName: "student-response-submitted", phaseId: 1 });
        return null;
    });

    await registry.collectStudentResults({ sessionId: SESSION_ID, userId: USER_ID });

    assert.deepEqual(resultsStore.calls, [{
        serviceId: "tutor",
        sessionId: SESSION_ID,
        filters:   { hookName: "student-response-submitted", phaseId: 1, userId: USER_ID },
    }]);
    assert.deepEqual(listed.map(result => result.id), [RESULT_IDS.tutorFirst]);
    assert.deepEqual(listed[0], {
        id:            RESULT_IDS.tutorFirst,
        jobId:         `job-${RESULT_IDS.tutorFirst}`,
        hookName:      "student-response-submitted",
        status:        "completed",
        phaseId:       1,
        questionId:    7,
        groupId:       null,
        userId:        USER_ID,
        source:        null,
        rawPayload:    { summary: PRIVATE_MARKER },
        adapterResult: { status: "completed" },
        receivedAt:    "2026-11-05T10:00:00.000Z",
    });
    assert.ok(Object.isFrozen(listed[0]));
});

test("the reader rejects filters that would change its scope, and malformed ones", async () => {
    const reader = createStudentResultsReader(fakeResultsStore(), {
        serviceId: "tutor", sessionId: SESSION_ID, userId: USER_ID,
    });

    for (const key of ["userId", "groupId", "serviceId", "sessionId"]) {
        await assert.rejects(() => reader.list({ [key]: 1 }), new RegExp(`Unknown result filters: ${key}`, "u"));
    }
    await assert.rejects(() => reader.list({ questionId: "7" }), /questionId must be a positive integer/u);
    await assert.rejects(() => reader.list([]), TypeError);
    assert.deepEqual(await reader.list(), []);
});

// ─── Merging and validation ─────────────────────────────────────────────────

test("entries of every asked service are merged by publishedAt, with their service id, and frozen", async () => {
    const resultsStore = fakeResultsStore({
        tutor: [
            resultRow(RESULT_IDS.tutorFirst, "tutor", { receivedAt: "2026-11-05T10:00:00.000Z" }),
            resultRow(RESULT_IDS.tutorSecond, "tutor", { phaseId: 2, receivedAt: "2026-11-05T10:20:00.000Z" }),
        ],
        other: [resultRow(RESULT_IDS.otherFirst, "other", { receivedAt: "2026-11-05T10:10:00.000Z" })],
    });
    const { registry } = makeRegistry({
        services: [serviceEntry("tutor"), serviceEntry("other")],
        resultsStore,
    });
    let returnedPayload;
    registry.subscribe("tutor", STUDENT_RESULTS_READING_HOOK, async (context, tools) => {
        const entries = await echoHandler()(context, tools);
        returnedPayload = entries[0].payload;
        return entries;
    });
    registry.subscribe("other", STUDENT_RESULTS_READING_HOOK, echoHandler({ status: "failed" }));

    const results = await registry.collectStudentResults({ sessionId: SESSION_ID, userId: USER_ID });
    // The adapter cannot change what it returned.
    returnedPayload.feedback.summary = "changed later";

    assert.deepEqual(results.map(({ serviceId, resultId, phaseId, status }) => [serviceId, resultId, phaseId, status]), [
        ["tutor", RESULT_IDS.tutorFirst, 1, "completed"],
        ["other", RESULT_IDS.otherFirst, 1, "failed"],
        ["tutor", RESULT_IDS.tutorSecond, 2, "completed"],
    ]);
    assert.deepEqual(results[0], {
        serviceId:   "tutor",
        resultId:    RESULT_IDS.tutorFirst,
        phaseId:     1,
        questionId:  7,
        component:   { componentId: "argument-tutor-chat-feedback", title: "Argument Tutor Feedback" },
        payload:     { feedback: { summary: "Rebuilt" } },
        message:     "Your argument tutor feedback is now available.",
        status:      "completed",
        publishedAt: "2026-11-05T10:00:00.000Z",
    });
    assert.ok(Object.isFrozen(results) && Object.isFrozen(results[0]));
    assert.ok(Object.isFrozen(results[0].payload.feedback) && Object.isFrozen(results[0].component));
});

test("an entry citing another service's result, or one its reader never returned, is dropped", async () => {
    const resultsStore = fakeResultsStore({
        tutor: [resultRow(RESULT_IDS.tutorFirst, "tutor")],
        other: [resultRow(RESULT_IDS.otherFirst, "other")],
    });
    const { registry } = makeRegistry({
        services: [serviceEntry("tutor"), serviceEntry("other")],
        resultsStore,
    });
    registry.subscribe("other", STUDENT_RESULTS_READING_HOOK, echoHandler());
    registry.subscribe("tutor", STUDENT_RESULTS_READING_HOOK, async (context, tools) => {
        const [own] = await echoHandler()(context, tools);
        return [
            own,
            // The other service's result, whose id this adapter guessed.
            { ...own, resultId: RESULT_IDS.otherFirst },
            // A result of its own service it did not read.
            { ...own, resultId: RESULT_IDS.tutorSecond },
        ];
    });

    const { result, output } = await captureConsole(() => registry.collectStudentResults({
        sessionId: SESSION_ID, userId: USER_ID,
    }));

    // Both were published at the same time, so they keep the subscription order.
    assert.deepEqual(result.map(({ serviceId, resultId }) => [serviceId, resultId]), [
        ["other", RESULT_IDS.otherFirst],
        ["tutor", RESULT_IDS.tutorFirst],
    ]);
    const problem = "is not one of the results the service read for the student";
    assert.deepEqual(output, [
        "warn [external-services] Left out student results. " + JSON.stringify({
            serviceId: "tutor",
            sessionId: SESSION_ID,
            status:    "completed",
            kept:      1,
            dropped:   2,
            problems:  [`entries[1].resultId ${problem}`, `entries[2].resultId ${problem}`],
        }),
    ]);
});

test("an entry that repeats a result id is dropped, and a Date publishedAt is normalized", async () => {
    const resultsStore = fakeResultsStore({ tutor: [resultRow(RESULT_IDS.tutorFirst, "tutor")] });
    const { registry } = makeRegistry({ services: [serviceEntry("tutor")], resultsStore });
    registry.subscribe("tutor", STUDENT_RESULTS_READING_HOOK, async (context, { results }) => {
        await results.list({ phaseId: 1 });
        const [result] = await results.list({ questionId: 7 });
        return [result.id, result.id].map(resultId => ({
            resultId,
            phaseId:     1,
            questionId:  7,
            component:   { componentId: "c" },
            payload:     {},
            message:     null,
            status:      "completed",
            publishedAt: new Date("2026-11-05T10:00:00Z"),
        }));
    });

    const { result } = await captureConsole(() => registry.collectStudentResults({
        sessionId: SESSION_ID, userId: USER_ID,
    }));

    assert.deepEqual(result.map(entry => [entry.resultId, entry.publishedAt]), [
        [RESULT_IDS.tutorFirst, "2026-11-05T10:00:00.000Z"],
    ]);
});

test("malformed entries are dropped one by one, and their problems name paths only", () => {
    const result = Object.freeze({ id: RESULT_IDS.tutorFirst, phaseId: 1, questionId: 7 });
    const jobless = Object.freeze({ id: RESULT_IDS.tutorSecond, phaseId: null, questionId: null });
    const readResults = new Map([[result.id, result], [jobless.id, jobless]]);
    const valid = {
        resultId:    result.id,
        phaseId:     1,
        questionId:  7,
        component:   { componentId: "argument-tutor-chat-feedback" },
        payload:     { feedback: {} },
        message:     null,
        status:      "completed",
        publishedAt: "2026-11-05T10:00:00Z",
    };
    const cases = [
        ["text", "entries[0] must be an object"],
        [{ ...valid, extra: PRIVATE_MARKER }, "entries[0] has unknown keys"],
        [{ ...valid, resultId: 5 }, "entries[0].resultId is not one of the results"],
        [{ ...valid, phaseId: "1" }, "entries[0].phaseId must be a positive integer"],
        [{ ...valid, phaseId: 2 }, "entries[0].phaseId is not the phase of its result"],
        [{ ...valid, questionId: 0 }, "entries[0].questionId must be a positive integer or null"],
        [{ ...valid, questionId: null }, "entries[0].questionId is not the question of its result"],
        [{ ...valid, component: { title: PRIVATE_MARKER } }, "entries[0].component must be plain data with a componentId"],
        [{ ...valid, component: { componentId: "c", render: () => null } }, "entries[0].component must be plain data"],
        [{ ...valid, payload: [PRIVATE_MARKER] }, "entries[0].payload must be a plain data object"],
        [{ ...valid, payload: null }, "entries[0].payload must be a plain data object"],
        [{ ...valid, message: 3 }, "entries[0].message must be a string or null"],
        [{ ...valid, status: "" }, "entries[0].status must be a non-empty string"],
        [{ ...valid, publishedAt: "yesterday" }, "entries[0].publishedAt must be a date"],
        [{ ...valid, publishedAt: undefined }, "entries[0].publishedAt must be a date"],
    ];

    for (const [entry, fragment] of cases) {
        const checked = validateStudentResults([entry], { readResults });
        assert.equal(checked.valid, true);
        assert.deepEqual(checked.entries, [], fragment);
        assert.ok(checked.problems.some(problem => problem.startsWith(fragment)),
            `expected "${fragment}", got ${JSON.stringify(checked.problems)}`);
        assert.ok(checked.problems.every(problem => !problem.includes(PRIVATE_MARKER)));
    }

    // A result without a phase or question (no job) takes the entry's.
    const kept = validateStudentResults([
        { ...valid, resultId: jobless.id, phaseId: 3, questionId: undefined, message: "Done" },
    ], { readResults });
    assert.deepEqual(kept.problems, []);
    assert.deepEqual(kept.entries.map(({ phaseId, questionId, message }) => [phaseId, questionId, message]), [
        [3, null, "Done"],
    ]);

    assert.deepEqual(validateStudentResults(undefined, { readResults }), { valid: true, entries: [], problems: [] });
    assert.deepEqual(validateStudentResults({ entries: [] }, { readResults }).valid, false);
});

test("a failing, slow or non-list handler contributes nothing and the others still answer", async () => {
    const services = ["valid", "throws", "slow", "not-a-list"].map(id => serviceEntry(id));
    const resultsStore = fakeResultsStore({ valid: [resultRow(RESULT_IDS.tutorFirst, "valid")] });
    const { registry } = makeRegistry({ services, resultsStore, timeoutMs: 20 });
    let slowSignal;
    registry.subscribe("valid", STUDENT_RESULTS_READING_HOOK, echoHandler());
    registry.subscribe("throws", STUDENT_RESULTS_READING_HOOK, () => {
        throw Object.assign(new TypeError(`Cannot rebuild ${PRIVATE_MARKER}`), { code: "ERR_REBUILD" });
    });
    registry.subscribe("slow", STUDENT_RESULTS_READING_HOOK, (context, { signal }) => {
        slowSignal = signal;
        // It rejects after its timeout, once aborted, quoting student text.
        return new Promise((resolve, reject) => signal.addEventListener("abort", () => setTimeout(
            () => reject(new Error(`Aborted while rebuilding ${PRIVATE_MARKER}`)), 5
        )));
    });
    registry.subscribe("not-a-list", STUDENT_RESULTS_READING_HOOK, async () => ({ text: PRIVATE_MARKER }));

    const { result, output } = await captureConsole(async () => {
        const collected = await registry.collectStudentResults({ sessionId: SESSION_ID, userId: USER_ID });
        // Let the timed-out handler settle while the console is captured.
        await new Promise(resolve => setTimeout(resolve, 30));
        return collected;
    });

    assert.deepEqual(result.map(({ serviceId, resultId }) => [serviceId, resultId]), [
        ["valid", RESULT_IDS.tutorFirst],
    ]);
    assert.equal(slowSignal.aborted, true, "a timed-out handler's signal is aborted");

    const leftOut = "warn [external-services] Left out student results.";
    assert.deepEqual(output, [
        `${leftOut} {"serviceId":"throws","sessionId":12,"status":"failed",`
            + "\"errorName\":\"TypeError\",\"errorCode\":\"ERR_REBUILD\"}",
        `${leftOut} {"serviceId":"not-a-list","sessionId":12,"status":"invalid",`
            + "\"problems\":[\"the handler must return a list\"]}",
        `${leftOut} {"serviceId":"slow","sessionId":12,"status":"timed_out","timeoutMs":20}`,
    ]);
    assert.ok(output.every(line => !line.includes(PRIVATE_MARKER)),
        "no log line carries text from a handler, its error or its entries");
});

test("a reader that fails makes only its own handler fail", async () => {
    const resultsStore = fakeResultsStore({ valid: [resultRow(RESULT_IDS.tutorFirst, "valid")] });
    const failingStore = {
        ...resultsStore,
        async listResults(args) {
            if (args.serviceId === "broken") {
                throw new Error("connection reset");
            }
            return resultsStore.listResults(args);
        },
    };
    const { registry } = makeRegistry({
        services:     [serviceEntry("valid"), serviceEntry("broken")],
        resultsStore: failingStore,
    });
    registry.subscribe("valid", STUDENT_RESULTS_READING_HOOK, echoHandler());
    registry.subscribe("broken", STUDENT_RESULTS_READING_HOOK, echoHandler());

    const { result } = await captureConsole(() => registry.collectStudentResults({
        sessionId: SESSION_ID, userId: USER_ID,
    }));

    assert.deepEqual(result.map(({ serviceId }) => serviceId), ["valid"]);
});

test("the hook is student-results-reading and its default timeout is three seconds", () => {
    assert.equal(STUDENT_RESULTS_READING_HOOK, "student-results-reading");
    assert.equal(STUDENT_RESULTS_TIMEOUT_MS, 3000);
});
