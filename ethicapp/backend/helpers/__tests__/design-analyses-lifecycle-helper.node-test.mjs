import assert from "node:assert/strict";
import test from "node:test";

import { NON_SESSION_HOOKS } from "../../services/external-services.service.js";
import {
    DESIGN_SAVED_HOOK,
    buildDesignSavedContext,
    dispatchDesignSavedHook,
} from "../design-analyses-lifecycle-helper.js";

const JOB_ID = "f1a2b3c4-0000-4000-8000-000000000071";

const DESIGN_ROW = {
    id:                 "5",
    creator:            3,
    case_id:            42,
    case_language_code: "es",
    locked:             false,
    design:             { phases: [{ type: "semantic_differential" }] },
};

test("design-saved fires outside sessions, under the current policy version", () => {
    assert.equal(DESIGN_SAVED_HOOK, "design-saved");
    assert.ok(NON_SESSION_HOOKS.includes(DESIGN_SAVED_HOOK));
});

test("buildDesignSavedContext: maps the design row into the hook context", () => {
    assert.deepEqual(buildDesignSavedContext(DESIGN_ROW, { userId: "7" }), {
        designId:     5,
        userId:       7,
        caseId:       42,
        languageCode: "es",
        design:       DESIGN_ROW.design,
    });
    assert.equal(buildDesignSavedContext(DESIGN_ROW).userId, 3, "the creator by default");
});

test("buildDesignSavedContext: nulls a missing case and invalid ids", () => {
    assert.deepEqual(buildDesignSavedContext({ id: "x" }), {
        designId:     null,
        userId:       null,
        caseId:       null,
        languageCode: null,
        design:       null,
    });
});

test("dispatchDesignSavedHook: dispatches each reservation under its job, then releases it", async () => {
    const calls = [];
    const released = [];
    const registry = {
        dispatchHook: async (hookName, context, options) => {
            calls.push({ hookName, context, options });
            return [{ status: "fulfilled", value: undefined }];
        },
    };

    const outcomes = await dispatchDesignSavedHook({ designId: 5 }, {
        reservations:       [{ design_id: 5, service_id: "svc-design", job_id: JOB_ID }],
        registry,
        releaseReservation: async args => { released.push(args); },
    });

    assert.deepEqual(calls, [{
        hookName: "design-saved",
        context:  { designId: 5 },
        options:  { enabledServiceIds: ["svc-design"], jobIds: { "svc-design": JOB_ID } },
    }]);
    assert.deepEqual(released, [{ designId: 5, serviceId: "svc-design", jobId: JOB_ID }]);
    assert.equal(outcomes.length, 1);
});

test("dispatchDesignSavedHook: a failed dispatch is logged and the reservation released", async () => {
    const released = [];
    const logged = [];
    const originalError = console.error;
    console.error = (...args) => { logged.push(args); };

    try {
        const outcomes = await dispatchDesignSavedHook({ designId: 5 }, {
            reservations:       [{ design_id: 5, service_id: "svc-design", job_id: JOB_ID }],
            registry:           { dispatchHook: async () => { throw new Error("boom"); } },
            releaseReservation: async args => { released.push(args); },
        });
        assert.deepEqual(outcomes, []);
    } finally {
        console.error = originalError;
    }

    assert.equal(released.length, 1);
    assert.match(logged[0][0], /Error dispatching design-saved hook/);
});

test("dispatchDesignSavedHook: nothing is dispatched without reservations", async () => {
    const registry = { dispatchHook: async () => assert.fail("no dispatch expected") };

    assert.deepEqual(await dispatchDesignSavedHook({ designId: 5 }, { registry }), []);
});
