import assert from "node:assert/strict";
import test from "node:test";
import { dispatchPhaseHook } from "../external-service-dispatch.js";

function fakeRegistry() {
    const calls = [];
    return {
        calls,
        dispatchHook: async (hookName, context, options) => {
            calls.push({ hookName, context, options });
            return [{ status: "fulfilled" }];
        },
    };
}

test("dispatchPhaseHook: passes enabled services and their configurations (#734)", async () => {
    const registry = fakeRegistry();
    const loaded = [];
    const loadPhaseExternalServices = async (phaseId) => {
        loaded.push(phaseId);
        return {
            enabledServiceIds: ["polyadic-devils-advocate"],
            configurations:    { "polyadic-devils-advocate": { llm_tier: "advanced" } },
        };
    };
    const context = { sessionId: 3, phaseId: 12 };

    const outcomes = await dispatchPhaseHook("phase-started", context, {
        registry,
        loadPhaseExternalServices,
    });

    assert.deepEqual(loaded, [12]);
    assert.deepEqual(outcomes, [{ status: "fulfilled" }]);
    assert.deepEqual(registry.calls, [{
        hookName: "phase-started",
        context,
        options:  {
            enabledServiceIds:     ["polyadic-devils-advocate"],
            serviceConfigurations: { "polyadic-devils-advocate": { llm_tier: "advanced" } },
        },
    }]);
});

test("dispatchPhaseHook: does nothing when the phase enables no service", async () => {
    const registry = fakeRegistry();

    const outcomes = await dispatchPhaseHook("chat-message-received", { phaseId: 4 }, {
        registry,
        loadPhaseExternalServices: async () => ({ enabledServiceIds: [], configurations: {} }),
    });

    assert.deepEqual(outcomes, []);
    assert.equal(registry.calls.length, 0);
});

test("dispatchPhaseHook: phase-ended always reaches the registry, which closes room jobs (#833)", async () => {
    const registry = fakeRegistry();
    const originalError = console.error;
    console.error = () => {};
    try {
        await dispatchPhaseHook("phase-ended", { sessionId: 3, phaseId: 4 }, {
            registry,
            loadPhaseExternalServices: async () => ({ enabledServiceIds: [], configurations: {} }),
        });
        await dispatchPhaseHook("phase-ended", { sessionId: 3, phaseId: 5 }, {
            registry,
            loadPhaseExternalServices: async () => { throw new Error("database unavailable"); },
        });
    } finally {
        console.error = originalError;
    }

    assert.deepEqual(registry.calls.map(call => [call.hookName, call.context.phaseId,
        call.options.enabledServiceIds]), [["phase-ended", 4, []], ["phase-ended", 5, []]]);
});
