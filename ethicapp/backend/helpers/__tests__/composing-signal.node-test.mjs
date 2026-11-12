// The composing signal's names and timing (epic #601, #654).
import assert from "node:assert/strict";
import test from "node:test";

import {
    CHAT_COMPOSING_EVENT,
    CHAT_COMPOSING_NOTICE_EVENT,
    CHAT_COMPOSING_PAYLOAD_FIELDS,
    COMPOSING_CLIENT_INTERVAL_MS,
    COMPOSING_IDLE_MS,
    COMPOSING_KINDS,
    COMPOSING_NOTICE_TTL_MS,
    COMPOSING_RATE_WINDOW_MS,
    COMPOSING_SERVICE_INTERVAL_MS,
    COMPOSING_SERVICE_TTL_MAX_SECONDS,
    COMPOSING_SERVICE_TTL_SECONDS,
    COMPOSING_SIGNALS_PER_WINDOW,
    isComposingKind,
} from "../composing-signal.js";

test("the contract names its events, payload fields and kinds", () => {
    assert.equal(CHAT_COMPOSING_EVENT, "chatComposing");
    assert.equal(CHAT_COMPOSING_NOTICE_EVENT, "onChatComposing");
    assert.deepEqual(CHAT_COMPOSING_PAYLOAD_FIELDS, ["phaseId", "questionId", "groupId", "kind"]);
    assert.deepEqual(COMPOSING_KINDS, ["composing", "stopped"]);
    assert.ok(Object.isFrozen(CHAT_COMPOSING_PAYLOAD_FIELDS));
    assert.ok(Object.isFrozen(COMPOSING_KINDS));
});

test("the timing is the one the epic agreed", () => {
    assert.equal(COMPOSING_CLIENT_INTERVAL_MS, 5000);
    assert.equal(COMPOSING_IDLE_MS, 8000);
    assert.equal(COMPOSING_NOTICE_TTL_MS, 10000);
    assert.equal(COMPOSING_SERVICE_INTERVAL_MS, 12000);
    assert.equal(COMPOSING_SERVICE_TTL_SECONDS, 30);
    assert.equal(COMPOSING_SIGNALS_PER_WINDOW, 20);
    assert.equal(COMPOSING_RATE_WINDOW_MS, 60000);
});

test("the timing holds together", () => {
    // A writer who keeps typing refreshes the notice before it expires.
    assert.ok(COMPOSING_CLIENT_INTERVAL_MS < COMPOSING_NOTICE_TTL_MS);
    // A service hears from a writer who keeps typing before its TTL runs out.
    assert.ok(COMPOSING_SERVICE_INTERVAL_MS < COMPOSING_SERVICE_TTL_SECONDS * 1000);
    assert.ok(COMPOSING_SERVICE_TTL_SECONDS <= COMPOSING_SERVICE_TTL_MAX_SECONDS);
    // A well-behaved client (a composing every interval plus one stopped)
    // stays under the rate limit.
    const clientSignalsPerWindow = Math.ceil(COMPOSING_RATE_WINDOW_MS / COMPOSING_CLIENT_INTERVAL_MS) + 1;
    assert.equal(clientSignalsPerWindow, 13);
    assert.ok(clientSignalsPerWindow <= COMPOSING_SIGNALS_PER_WINDOW);
});

test("isComposingKind accepts only composing and stopped", () => {
    assert.equal(isComposingKind("composing"), true);
    assert.equal(isComposingKind("stopped"), true);
    for (const kind of ["typing", "Composing", "", null, undefined, 1]) {
        assert.equal(isComposingKind(kind), false);
    }
});
