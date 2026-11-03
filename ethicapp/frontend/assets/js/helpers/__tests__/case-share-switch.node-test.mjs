// The share switch of a case (#939, #1013): it asks before a publication,
// saves the new visibility, and puts the switch back when the author cancels
// or the save fails.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toggleCaseShareSwitch } from "../case-share-switch.js";

function services({ confirmAnswer = true, fail = false } = {}) {
    const calls = { confirm: 0, saved: [] };
    return {
        calls,
        confirm: async () => {
            calls.confirm += 1;
            return confirmAnswer;
        },
        updateVisibility: async (caseId, visibility) => {
            calls.saved.push([caseId, visibility]);
            if (fail) {
                throw new Error("nope");
            }
            return { visibility, public: visibility === "public", affectedDesignIds: [] };
        },
    };
}

describe("case share switch", () => {
    it("shares a private case once the author confirms", async () => {
        const deps = services();
        const caseItem = { id: 7, visibility: "private", public: false };
        const outcome = await toggleCaseShareSwitch(caseItem, deps);
        assert.equal(outcome.outcome, "saved");
        assert.equal(outcome.previousVisibility, "private");
        assert.equal(outcome.result.visibility, "public");
        assert.equal(deps.calls.confirm, 1);
        assert.deepEqual(deps.calls.saved, [[7, "public"]]);
        assert.deepEqual([caseItem.visibility, caseItem.public], ["public", true]);
    });

    it("changes nothing and puts the switch back when the author cancels", async () => {
        const deps = services({ confirmAnswer: false });
        // The switch's click may have turned it on already.
        const caseItem = { id: 7, visibility: "private", public: true };
        const outcome = await toggleCaseShareSwitch(caseItem, deps);
        assert.equal(outcome.outcome, "cancelled");
        assert.deepEqual(deps.calls.saved, []);
        assert.deepEqual([caseItem.visibility, caseItem.public], ["private", false]);
    });

    it("stops sharing without asking", async () => {
        const deps = services();
        const caseItem = { id: 7, visibility: "public", public: true };
        const outcome = await toggleCaseShareSwitch(caseItem, deps);
        assert.equal(outcome.outcome, "saved");
        assert.equal(deps.calls.confirm, 0);
        assert.deepEqual(deps.calls.saved, [[7, "private"]]);
        assert.deepEqual([caseItem.visibility, caseItem.public], ["private", false]);
    });

    it("puts the switch back when the save fails", async () => {
        const deps = services({ fail: true });
        const caseItem = { id: 7, visibility: "public", public: true };
        const outcome = await toggleCaseShareSwitch(caseItem, deps);
        assert.equal(outcome.outcome, "failed");
        assert.ok(outcome.error instanceof Error);
        assert.deepEqual([caseItem.visibility, caseItem.public], ["public", true]);
    });
});
