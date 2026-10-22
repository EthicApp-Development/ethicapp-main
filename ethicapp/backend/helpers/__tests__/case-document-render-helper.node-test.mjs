import assert from "node:assert/strict";
import test from "node:test";
import { createCaseDocumentRender } from "../case-document-render-helper.js";

const REQUESTED_AT = new Date("2026-10-04T12:00:00.000Z");

function createRender({ renderStates = [], overrides = {} } = {}) {
    const states = [...renderStates];
    let clock = 0;
    const sleeps = [];

    const render = createCaseDocumentRender({
        getRenderJobState: async () => (states.length > 1 ? states.shift() : states[0] ?? null),
        getCaseText:       async () => "The case text.",
        sleep:             async ms => {
            sleeps.push(ms);
            clock += ms;
        },
        now:            () => clock,
        pollIntervalMs: 1000,
        waitTimeoutMs:  5000,
        ...overrides,
    });

    return { render, sleeps };
}

test("waitForCaseDocumentText waits for the render to complete", async () => {
    const { render, sleeps } = createRender({
        renderStates: [
            { status: "pending", requested_at: REQUESTED_AT },
            { status: "processing", requested_at: REQUESTED_AT },
            { status: "completed", requested_at: REQUESTED_AT },
        ],
    });

    const outcome = await render.waitForCaseDocumentText(7);

    assert.deepEqual(outcome, { status: "ready", text: "The case text." });
    assert.deepEqual(sleeps, [1000, 1000]);
});

test("waitForCaseDocumentText returns at once when the document is already rendered", async () => {
    const { render, sleeps } = createRender({
        renderStates: [{ status: "completed", requested_at: REQUESTED_AT }],
    });

    const outcome = await render.waitForCaseDocumentText(7);

    assert.equal(outcome.status, "ready");
    assert.deepEqual(sleeps, []);
});

test("waitForCaseDocumentText stops when a newer document replaced the render", async () => {
    const { render } = createRender({
        renderStates: [
            { status: "pending", requested_at: REQUESTED_AT },
            { status: "completed", requested_at: new Date("2026-10-04T12:05:00.000Z") },
        ],
    });

    assert.deepEqual(await render.waitForCaseDocumentText(7), { status: "superseded" });
});

test("waitForCaseDocumentText stops when the render failed", async () => {
    const { render } = createRender({
        renderStates: [{ status: "failed", requested_at: REQUESTED_AT }],
    });

    assert.deepEqual(await render.waitForCaseDocumentText(7), { status: "render-failed" });
});

test("waitForCaseDocumentText reports a case without a document", async () => {
    const { render } = createRender({ renderStates: [] });

    assert.deepEqual(await render.waitForCaseDocumentText(7), { status: "no-document" });
});

test("waitForCaseDocumentText gives up after the timeout", async () => {
    const { render, sleeps } = createRender({
        renderStates: [{ status: "pending", requested_at: REQUESTED_AT }],
    });

    assert.deepEqual(await render.waitForCaseDocumentText(7), { status: "timeout" });
    assert.equal(sleeps.length, 5);
});
