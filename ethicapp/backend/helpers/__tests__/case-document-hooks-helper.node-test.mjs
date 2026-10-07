import assert from "node:assert/strict";
import test from "node:test";
import {
    CASE_DOCUMENT_READY_HOOK,
    createCaseDocumentHooks,
} from "../case-document-hooks-helper.js";

const REQUESTED_AT = new Date("2026-10-04T12:00:00.000Z");

function createRegistry({ subscribers = ["svc-case"] } = {}) {
    const dispatched = [];
    return {
        dispatched,
        getEnabledServiceIdsForHook: hookName => (hookName === CASE_DOCUMENT_READY_HOOK ? subscribers : []),
        async dispatchHook(hookName, context, options) {
            dispatched.push({ hookName, context, options });
            return [];
        },
    };
}

function createHooks({ registry = createRegistry(), renderStates = [], overrides = {} } = {}) {
    const states = [...renderStates];
    let clock = 0;
    const sleeps = [];

    const hooks = createCaseDocumentHooks({
        getRegistry:            async () => registry,
        getRenderJobState:      async () => (states.length > 1 ? states.shift() : states[0] ?? null),
        getCaseDocumentContext: async caseId => ({
            id:            caseId,
            case_uuid:     "6a1c5b31-9837-49c2-80bb-817319c600e7",
            title:         "Caso Sebastián",
            language_code: "es_CL",
            creator:       42,
        }),
        getCaseText:    async () => "Texto del caso.",
        sleep:          async ms => {
            sleeps.push(ms);
            clock += ms;
        },
        now:            () => clock,
        pollIntervalMs: 1000,
        waitTimeoutMs:  5000,
        ...overrides,
    });

    return { hooks, registry, sleeps };
}

test("dispatchCaseDocumentReady sends the case context to enabled subscribers", async () => {
    const { hooks, registry } = createHooks();

    await hooks.dispatchCaseDocumentReady(7);

    assert.deepEqual(registry.dispatched, [{
        hookName: "case-document-ready",
        context:  {
            caseId:       7,
            caseUuid:     "6a1c5b31-9837-49c2-80bb-817319c600e7",
            caseTitle:    "Caso Sebastián",
            languageCode: "es_CL",
            userId:       42,
            caseText:     "Texto del caso.",
        },
        options: { enabledServiceIds: ["svc-case"] },
    }]);
});

test("dispatchCaseDocumentReady can target specific services", async () => {
    const { hooks, registry } = createHooks();

    await hooks.dispatchCaseDocumentReady(7, { serviceIds: ["svc-other"] });

    assert.deepEqual(registry.dispatched[0].options, { enabledServiceIds: ["svc-other"] });
});

test("dispatchCaseDocumentReadyWhenRendered waits for the render to complete", async () => {
    const { hooks, registry, sleeps } = createHooks({
        renderStates: [
            { status: "pending", requested_at: REQUESTED_AT },
            { status: "processing", requested_at: REQUESTED_AT },
            { status: "completed", requested_at: REQUESTED_AT },
        ],
    });

    const outcome = await hooks.dispatchCaseDocumentReadyWhenRendered({ caseId: 7, requestedAt: REQUESTED_AT });

    assert.equal(outcome, "dispatched");
    assert.deepEqual(sleeps, [1000, 1000]);
    assert.equal(registry.dispatched.length, 1);
});

test("dispatchCaseDocumentReadyWhenRendered stops when a newer document replaced the render", async () => {
    const { hooks, registry } = createHooks({
        renderStates: [
            { status: "pending", requested_at: REQUESTED_AT },
            { status: "completed", requested_at: new Date("2026-10-04T12:05:00.000Z") },
        ],
    });

    const outcome = await hooks.dispatchCaseDocumentReadyWhenRendered({ caseId: 7, requestedAt: REQUESTED_AT });

    assert.equal(outcome, "superseded");
    assert.equal(registry.dispatched.length, 0);
});

test("dispatchCaseDocumentReadyWhenRendered stops when the render failed", async () => {
    const { hooks, registry } = createHooks({
        renderStates: [{ status: "failed", requested_at: REQUESTED_AT }],
    });

    const outcome = await hooks.dispatchCaseDocumentReadyWhenRendered({ caseId: 7, requestedAt: REQUESTED_AT });

    assert.equal(outcome, "render-failed");
    assert.equal(registry.dispatched.length, 0);
});

test("dispatchCaseDocumentReadyWhenRendered gives up after the timeout", async () => {
    const { hooks, registry, sleeps } = createHooks({
        renderStates: [{ status: "pending", requested_at: REQUESTED_AT }],
    });

    const outcome = await hooks.dispatchCaseDocumentReadyWhenRendered({ caseId: 7, requestedAt: REQUESTED_AT });

    assert.equal(outcome, "timeout");
    assert.equal(sleeps.length, 5);
    assert.equal(registry.dispatched.length, 0);
});

test("dispatchCaseDocumentReadyWhenRendered does not wait when nobody subscribes", async () => {
    let renderChecks = 0;
    const { hooks } = createHooks({
        registry:  createRegistry({ subscribers: [] }),
        overrides: {
            getRenderJobState: async () => {
                renderChecks += 1;
                return null;
            },
        },
    });

    const outcome = await hooks.dispatchCaseDocumentReadyWhenRendered({ caseId: 7, requestedAt: REQUESTED_AT });

    assert.equal(outcome, "no-subscribers");
    assert.equal(renderChecks, 0);
});
