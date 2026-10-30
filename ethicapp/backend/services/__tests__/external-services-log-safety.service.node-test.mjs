// Container logs outlive the forgetting of a student (#876), so the
// external-services path never logs payload, result or AI Additions error
// text: only ids, the service, the hook, statuses, counts and sizes.
import assert from "node:assert/strict";
import { inspect } from "node:util";
import test from "node:test";

import { ExternalServicesRegistry } from "../external-services.service.js";
import { describeError, summarizeCallbackResult } from "../../helpers/log-safety.js";
import { register as registerPolyadic } from "../../external-services/adapters/polyadic-bridge.adapter.js";

const STUDENT_TEXT = "Distinctive-student-sentence about the pharmacy price";
const RATIONALE = "Distinctive-rationale paraphrasing the student";
const JOB_ID = "c1d2e3f4-0000-4000-8000-000000000876";
const RESULT_ID = "c1d2e3f4-0000-4000-8000-000000000877";

// Runs `fn` with every console method captured, and returns what was logged,
// formatted as Node would print it.
async function captureLogs(fn) {
    const lines = [];
    const methods = ["log", "info", "warn", "error", "debug"];
    const originals = Object.fromEntries(methods.map(method => [method, console[method]]));
    for (const method of methods) {
        console[method] = (...args) => {
            lines.push(args.map(arg => (typeof arg === "string" ? arg : inspect(arg, { depth: 10 }))).join(" "));
        };
    }
    try {
        await fn();
    } finally {
        Object.assign(console, originals);
    }
    return lines;
}

function makeRegistry({ handler, updateResultFails = false }) {
    const updates = [];
    const registry = new ExternalServicesRegistry({
        developmentAdapters:     false,
        isAiAdditionsConfigured: async () => true,
        aiServicePolicy:         {
            getCurrentPolicyVersion:   async () => ({ id: 1, allowedServiceIds: ["argumentation-tutor"] }),
            getPolicyVersion:          async () => ({ id: 1, allowedServiceIds: ["argumentation-tutor"] }),
            getSessionPolicyVersionId: async () => 1,
        },
        roomJobsService: { hasOpenBoundRoomJob: async () => false },
        jobsService:     {
            createResult: async ({ correlationId, serviceId }) => ({
                id:               RESULT_ID,
                job_id:           correlationId,
                correlation_id:   correlationId,
                service_id:       serviceId,
                status:           "pending",
                job_prior_status: "dispatched",
                job:              {
                    id: correlationId, sessionId: 10, phaseId: 2, questionId: 4, groupId: null,
                    userId: 42, kind: "hook", status: "dispatched",
                },
            }),
            claimResult:     async result => ({ ...result, status: "callback-received" }),
            updateResult:    async (id, values) => {
                if (updateResultFails) {
                    throw Object.assign(new Error("invalid input syntax for type json"), {
                        where: `JSON data, line 1: ${RATIONALE}`,
                    });
                }
                updates.push(values);
            },
            updateJobStatus: async () => {},
        },
    });
    registry.initialized = true;
    registry.services.set("svc-tutor", {
        id: "svc-tutor", development: false, requires: ["argumentation-tutor"],
        hooks: ["callback-received"], globalHooks: [], scopes: ["response"], callbackAuth: null,
    });
    registry.hookSubscribers.set("callback-received", [{ serviceId: "svc-tutor", handler }]);
    return { registry, updates };
}

function tutorCallback(registry) {
    return registry.dispatchServiceHook("callback-received", "svc-tutor", {
        correlationId:  JOB_ID,
        eventId:        null,
        requestPayload: { argumentPreview: STUDENT_TEXT, userId: 42 },
    });
}

const tutorHandler = async (context, { callback }) => callback({
    hook:    "callback-received",
    status:  "completed",
    payload: {
        publishedToUserId:  42,
        claimTypeRationale: RATIONALE,
        echoed:             context.requestPayload.argumentPreview,
    },
});

test("a callback's raw payload and adapter result are stored, but never logged", async () => {
    const { registry, updates } = makeRegistry({ handler: tutorHandler });

    const lines = await captureLogs(() => tutorCallback(registry));

    assert.equal(updates.at(-1).adapterResult.payload.claimTypeRationale, RATIONALE, "the result is stored");
    const callbackLine = lines.find(line => line.includes("Callback received from svc-tutor"));
    assert.ok(callbackLine, "the callback is still logged");
    assert.match(callbackLine, /"status":"completed"/);
    assert.match(callbackLine, /"payloadKeys":\["publishedToUserId","claimTypeRationale","echoed"\]/);
    for (const line of lines) {
        assert.equal(line.includes(STUDENT_TEXT), false, line);
        assert.equal(line.includes(RATIONALE), false, line);
    }
});

test("a failure to store the result logs the error without the database's echo of the data", async () => {
    const { registry } = makeRegistry({ handler: tutorHandler, updateResultFails: true });

    const lines = await captureLogs(() => tutorCallback(registry));

    assert.ok(lines.some(line => line.includes("Failed to persist callback result")));
    for (const line of lines) {
        assert.equal(line.includes(RATIONALE), false, line);
        assert.equal(line.includes(STUDENT_TEXT), false, line);
    }
});

test("a failed Polyadic forward logs the error without the response body that echoes the message", async () => {
    const subscribers = new Map();
    await registerPolyadic({
        service:                    { id: "polyadic-devils-advocate" },
        subscribe:                  (hookName, handler) => subscribers.set(hookName, handler),
        publishGroupChatMessage:    async () => ({ savedMessage: { id: 1 } }),
        polyadicBridgeDependencies: {
            getTeamIdsForPhase:         async () => [],
            getFirstQuestionIdForPhase: async () => 701,
            getFirstQuestionForPhase:   async () => ({ id: 701, title: "Q", tleft: "A", tright: "B" }),
            getCaseIdBySessionId:       async () => 51,
            getCaseDocumentRawText:     async () => "Case text.",
            getParticipantIdentity:     async () => null,
            getSessionLanguageCode:     async () => "es_CL",
        },
        aiAdditionsClient: {
            async getEndpoints() {
                return { baseUrl: "http://ai.local" };
            },
            async requestJson(pathname, options) {
                if (pathname.endsWith("/messages")) {
                    throw Object.assign(new Error("HTTP 422 request failed on http://ai.local/rooms/x/messages."), {
                        statusCode:   422,
                        responseBody: { detail: [{ input: options.body.content }] },
                    });
                }
                return { status: "ok" };
            },
        },
    });

    const lines = await captureLogs(() => subscribers.get("chat-message-received")({
        sessionId: 11, phaseId: 22, questionId: 701, groupId: 301, userId: 9001,
        correlationId: "corr", content: STUDENT_TEXT,
    }, { callback: async result => result, reportInstantiation: async report => report }));

    assert.ok(lines.some(line => line.includes("Failed to forward message")));
    for (const line of lines) {
        assert.equal(line.includes(STUDENT_TEXT), false, line);
    }
});

test("describeError keeps the name, code, status and message, never the response body", () => {
    const error = Object.assign(new Error("HTTP 400 request failed on http://ai.local/x."), {
        statusCode:   400,
        code:         "bad_request",
        responseBody: { detail: STUDENT_TEXT },
    });

    assert.deepEqual(describeError(error), {
        name:       "Error",
        code:       "bad_request",
        statusCode: 400,
        message:    "HTTP 400 request failed on http://ai.local/x.",
    });
    assert.equal(describeError("x".repeat(500)).message, null);
    assert.equal(describeError(new Error("y".repeat(500))).message.length, 301);
});

test("summarizeCallbackResult reports ids, status, payload field names and size only", () => {
    const summary = summarizeCallbackResult({
        serviceId: "svc-tutor",
        hookName:  "callback-received",
        result:    { status: "completed", payload: { claimTypeRationale: RATIONALE } },
        context:   { jobId: JOB_ID, userId: 42, requestPayload: { text: STUDENT_TEXT } },
    });

    assert.equal(JSON.stringify(summary).includes(RATIONALE), false);
    assert.equal(JSON.stringify(summary).includes(STUDENT_TEXT), false);
    assert.deepEqual(summary.payloadKeys, ["claimTypeRationale"]);
    assert.equal(summary.userId, 42);
    assert.ok(summary.resultBytes > RATIONALE.length);
});
