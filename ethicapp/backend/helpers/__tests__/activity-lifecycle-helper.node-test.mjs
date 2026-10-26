import assert from "node:assert/strict";
import test from "node:test";
import { shouldDispatchActivityStarted, unionEnabledServiceIds } from "../activity-lifecycle-helper.js";
import * as StatusCodes from "../../../common/modules/session-status.js";

const INITIATED   = StatusCodes.getStatusCode("initiated");
const IN_PROGRESS = StatusCodes.getStatusCode("in_progress");
const FINISHED    = StatusCodes.getStatusCode("finished");

test("shouldDispatchActivityStarted: fires when entering in_progress from initiated", () => {
    assert.equal(shouldDispatchActivityStarted(INITIATED), true);
});

test("shouldDispatchActivityStarted: fires when previous status is null/unknown", () => {
    assert.equal(shouldDispatchActivityStarted(null), true);
});

test("shouldDispatchActivityStarted: does not fire on ordinary phase advance (already in_progress)", () => {
    assert.equal(shouldDispatchActivityStarted(IN_PROGRESS), false);
});

test("shouldDispatchActivityStarted: fires when re-opening a finished activity into in_progress", () => {
    assert.equal(shouldDispatchActivityStarted(FINISHED), true);
});

test("unionEnabledServiceIds: unions ids across phases and de-duplicates", () => {
    const phases = [
        { externalServices: { enabledServiceIds: ["polyadic-devils-advocate"] } },
        { externalServices: { enabledServiceIds: ["argumentation-tutor-system", "polyadic-devils-advocate"] } },
        { externalServices: { enabledServiceIds: ["mock-ai-response-review"] } },
    ];
    assert.deepEqual(unionEnabledServiceIds(phases), [
        "polyadic-devils-advocate",
        "argumentation-tutor-system",
        "mock-ai-response-review",
    ]);
});

test("unionEnabledServiceIds: includes services only enabled in intermediate phases", () => {
    const phases = [
        { externalServices: { enabledServiceIds: [] } },
        { externalServices: { enabledServiceIds: ["polyadic-devils-advocate"] } },
        { /* final reflection phase, no external services */ },
    ];
    assert.deepEqual(unionEnabledServiceIds(phases), ["polyadic-devils-advocate"]);
});

test("unionEnabledServiceIds: trims and drops empty ids", () => {
    const phases = [
        { externalServices: { enabledServiceIds: ["  polyadic-devils-advocate  ", "", "   "] } },
    ];
    assert.deepEqual(unionEnabledServiceIds(phases), ["polyadic-devils-advocate"]);
});

test("unionEnabledServiceIds: returns empty array for missing/invalid phases", () => {
    assert.deepEqual(unionEnabledServiceIds(undefined), []);
    assert.deepEqual(unionEnabledServiceIds(null), []);
    assert.deepEqual(unionEnabledServiceIds([]), []);
    assert.deepEqual(unionEnabledServiceIds([{}, { externalServices: {} }]), []);
});
