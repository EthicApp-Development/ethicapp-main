import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    createDismissibleTipState,
    createEscapeListeners,
    isEscapeKey,
} from "../dismissible-tip.js";
import { fakeKeyTarget } from "./fake-dismissible-tip.mjs";

describe("isEscapeKey", () => {
    it("tells Escape from the other keys", () => {
        assert.equal(isEscapeKey({ key: "Escape" }), true);
        assert.equal(isEscapeKey({ key: "Esc" }), true);
        assert.equal(isEscapeKey({ key: "Enter" }), false);
        assert.equal(isEscapeKey({}), false);
        assert.equal(isEscapeKey(null), false);
    });
});

describe("dismissible tooltip state", () => {
    it("hides a hovered tooltip on Escape, and shows it again once the pointer leaves", () => {
        const state = createDismissibleTipState();
        state.pointerEnter();

        assert.equal(state.escape(), true);
        assert.equal(state.dismissed, true);
        assert.equal(state.escape(), false, "a second Escape hides nothing more");

        state.pointerLeave();
        assert.equal(state.dismissed, false);
        state.pointerEnter();
        assert.equal(state.dismissed, false, "back on it, the tooltip shows");
    });

    it("hides a focused tooltip on Escape, and shows it again once the focus leaves", () => {
        const state = createDismissibleTipState();
        state.focusIn();

        assert.equal(state.escape(), true);
        state.focusOut(true);
        assert.equal(state.dismissed, true, "the focus moved inside the owner");
        state.focusOut();
        assert.equal(state.dismissed, false);
    });

    it("keeps the tooltip hidden until both the pointer and the focus have left", () => {
        const state = createDismissibleTipState();
        state.pointerEnter();
        state.focusIn();
        state.escape();

        state.pointerLeave();
        assert.equal(state.dismissed, true, "the focus is still inside");
        state.pointerEnter();
        state.focusOut();
        assert.equal(state.dismissed, true, "the pointer is still on it");
        state.pointerLeave();
        assert.equal(state.dismissed, false);
    });

    it("ignores Escape while the owner is neither hovered nor focused", () => {
        const state = createDismissibleTipState();
        assert.equal(state.escape(), false);
        assert.equal(state.dismissed, false);

        state.pointerEnter();
        state.pointerLeave();
        assert.equal(state.escape(), false);
        assert.equal(state.dismissed, false);
    });
});

describe("shared Escape listener", () => {
    it("adds one document listener with the first tooltip and removes it with the last", () => {
        const target = fakeKeyTarget();
        const listeners = createEscapeListeners(target);
        const calls = [];

        const removeFirst = listeners.add(event => calls.push(["first", event.key]));
        const removeSecond = listeners.add(event => calls.push(["second", event.key]));
        assert.equal(target.listeners.size, 1);
        assert.equal(listeners.size, 2);

        target.keydown("Enter");
        target.keydown("Escape");
        assert.deepEqual(calls, [["first", "Escape"], ["second", "Escape"]]);

        removeFirst();
        removeFirst();
        assert.equal(target.listeners.size, 1, "removing twice changes nothing");
        removeSecond();
        assert.equal(target.listeners.size, 0);
        assert.equal(listeners.size, 0);

        listeners.add(() => {});
        assert.equal(target.listeners.size, 1, "added again for a new tooltip");
    });

    it("leaves the event alone, for the other Escape handlers", () => {
        const target = fakeKeyTarget();
        createEscapeListeners(target).add(() => {});

        const event = target.keydown("Escape");
        assert.equal(event.defaultPrevented, false);
        assert.equal(event.propagationStopped, false);
    });

    it("lets a handler remove itself while the others still run", () => {
        const target = fakeKeyTarget();
        const listeners = createEscapeListeners(target);
        const calls = [];
        const removeFirst = listeners.add(() => {
            calls.push("first");
            removeFirst();
        });
        listeners.add(() => calls.push("second"));

        target.keydown("Escape");
        target.keydown("Escape");
        assert.deepEqual(calls, ["first", "second", "second"]);
    });
});
