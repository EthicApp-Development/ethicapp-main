// The activity description rule shared by POST /sessions and the teacher's
// launch page (#968).
import assert from "node:assert/strict";
import { test } from "node:test";

import {
    isActivityDescriptionValid,
    normalizeActivityDescription,
} from "../../../common/modules/activity-description.js";

test("normalizeActivityDescription trims strings and turns anything else into \"\"", () => {
    assert.equal(normalizeActivityDescription("  Section 3 · 2026-2 \n"), "Section 3 · 2026-2");
    assert.equal(normalizeActivityDescription("   "), "");
    for (const value of [undefined, null, 7, {}, ["a"]]) {
        assert.equal(normalizeActivityDescription(value), "");
    }
});

test("isActivityDescriptionValid accepts only non-blank strings", () => {
    assert.equal(isActivityDescriptionValid("Ethics"), true);
    assert.equal(isActivityDescriptionValid(" x "), true);
    for (const value of [undefined, null, "", " \t\n", 0]) {
        assert.equal(isActivityDescriptionValid(value), false);
    }
});
