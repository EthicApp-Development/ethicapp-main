import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    MAX_IDLE_POLLS_AFTER_DOCUMENT_READY,
    createEditableInventory,
    createEmptyFact,
    getStatusLabelClass,
    groupFacts,
    isDocumentUnavailable,
    shouldPollInventory,
} from "../evidence-inventory-helpers.js";

describe("evidence inventory helpers", () => {
    it("groups facts by theme in order of first appearance", () => {
        const facts = [
            { id: "EV1", group: "Familia" },
            { id: "EV2", group: "Amistad" },
            { id: "EV3", group: "Familia" },
        ];

        assert.deepEqual(groupFacts(facts), [
            { name: "Familia", facts: [facts[0], facts[2]] },
            { name: "Amistad", facts: [facts[1]] },
        ]);
        assert.deepEqual(groupFacts(null), []);
    });

    it("maps statuses to label classes", () => {
        assert.equal(getStatusLabelClass("reviewed"), "label label-success");
        assert.equal(getStatusLabelClass("draft"), "label label-warning");
        assert.equal(getStatusLabelClass("unexpected"), "label label-default");
    });

    it("creates editable copies without sharing references", () => {
        const inventory = { facts: [{ id: "EV1" }], exclusions: [] };
        const editable = createEditableInventory(inventory);

        editable.facts[0].id = "EV9";

        assert.equal(inventory.facts[0].id, "EV1");
        assert.deepEqual(createEditableInventory(null), { facts: [], exclusions: [] });
        assert.equal(createEmptyFact({ group: "Familia" }).group, "Familia");
    });

    it("polls while a generation runs or is about to start", () => {
        const base = { serviceEnabled: true, documentStatus: "completed", stale: false };
        const idle = { idlePolls: MAX_IDLE_POLLS_AFTER_DOCUMENT_READY };

        assert.equal(shouldPollInventory({ ...base, status: "processing" }), true);
        assert.equal(shouldPollInventory({ ...base, status: "processing", stale: true }), false);
        assert.equal(shouldPollInventory({ ...base, status: "none", documentStatus: "pending" }, idle), true);
        assert.equal(shouldPollInventory({ ...base, status: "none" }), true);
        assert.equal(shouldPollInventory({ ...base, status: "none" }, idle), false);
        assert.equal(shouldPollInventory({ ...base, status: "none", serviceEnabled: false }), false);
        assert.equal(shouldPollInventory({ ...base, status: "reviewed" }), false);
        assert.equal(shouldPollInventory(null), false);
    });

    it("polls while a replaced PDF is rendered and until its generation starts", () => {
        const reviewed = { serviceEnabled: true, status: "reviewed", stale: false };

        assert.equal(shouldPollInventory({ ...reviewed, documentStatus: "processing" }), true);
        assert.equal(
            shouldPollInventory({ ...reviewed, documentStatus: "completed" }, { awaitingGeneration: true }),
            true
        );
        assert.equal(shouldPollInventory({ ...reviewed, documentStatus: "completed" }), false);
    });

    it("stops polling when the case document has no rendered text", () => {
        for (const documentStatus of ["failed", null]) {
            const state = { serviceEnabled: true, status: "none", stale: false, documentStatus };
            assert.equal(shouldPollInventory(state), false);
            assert.equal(isDocumentUnavailable(state), true);
        }
        assert.equal(isDocumentUnavailable({ documentStatus: "pending" }), false);
        assert.equal(isDocumentUnavailable({ documentStatus: "completed" }), false);
    });
});
