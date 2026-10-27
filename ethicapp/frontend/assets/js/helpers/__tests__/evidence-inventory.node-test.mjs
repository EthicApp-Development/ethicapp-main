import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    canEditEvidenceInventory,
    countQuotesNotFound,
    createEditableInventory,
    createEmptyExclusion,
    createEmptyFact,
    evidenceInventorySaveError,
    groupFacts,
    isEvidenceInventoryReviewed,
} from "../evidence-inventory.js";

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

    it("counts the quotes that were not found in the case text", () => {
        assert.equal(countQuotesNotFound([
            { sourceQuote: "found", sourceQuoteFound: true },
            { sourceQuote: "missing", sourceQuoteFound: false },
            { sourceQuote: null, sourceQuoteFound: false },
        ]), 1);
        assert.equal(countQuotesNotFound(undefined), 0);
    });

    it("creates editable copies without sharing references", () => {
        const document = { schemaVersion: "evidence-inventory/v1", facts: [{ id: "EV1" }], exclusions: [] };
        const editable = createEditableInventory(document);

        editable.facts[0].id = "EV9";

        assert.equal(document.facts[0].id, "EV1");
        assert.equal(editable.schemaVersion, "evidence-inventory/v1");
        assert.deepEqual(createEditableInventory(null), { facts: [], exclusions: [] });
        assert.deepEqual(createEditableInventory({ facts: "x" }), { facts: [], exclusions: [] });
    });

    it("creates empty items, keeping the theme of the previous fact", () => {
        assert.equal(createEmptyFact({ group: "Familia" }).group, "Familia");
        assert.equal(createEmptyFact().group, "");
        assert.equal(createEmptyFact().id, "");
        assert.deepEqual(createEmptyExclusion(), { id: "", label: "", statement: "", reason: "" });
    });

    it("reads the review state from reviewedAt", () => {
        assert.equal(isEvidenceInventoryReviewed({ reviewedAt: "2026-10-27T12:00:00Z" }), true);
        assert.equal(isEvidenceInventoryReviewed({ reviewedAt: null }), false);
        assert.equal(isEvidenceInventoryReviewed(null), false);
    });

    it("allows edits unless a fresh generation is in flight", () => {
        const document = { facts: [], exclusions: [] };

        assert.equal(canEditEvidenceInventory({ status: "ready", document }), true);
        assert.equal(canEditEvidenceInventory({ status: "processing", stale: false, document }), false);
        assert.equal(canEditEvidenceInventory({ status: "requested", stale: false, document }), false);
        assert.equal(canEditEvidenceInventory({ status: "processing", stale: true, document }), true);
        assert.equal(canEditEvidenceInventory({ status: "ready", document: null }), false);
    });

    it("explains failed saves, with the details of an invalid document", () => {
        assert.deepEqual(
            evidenceInventorySaveError({ status: 400, data: { details: ["facts[0].statement is required", 3] } }),
            { messageKey: "case_evidence_inventory_error_invalid", details: ["facts[0].statement is required"] }
        );
        assert.deepEqual(
            evidenceInventorySaveError({ status: 409, data: { details: ["ignored"] } }),
            { messageKey: "case_evidence_inventory_error_processing", details: [] }
        );
        assert.equal(evidenceInventorySaveError({ status: 405 }).messageKey,
            "case_evidence_inventory_error_not_editable");
        assert.equal(evidenceInventorySaveError(new Error("offline")).messageKey,
            "case_evidence_inventory_error_generic");
    });
});
