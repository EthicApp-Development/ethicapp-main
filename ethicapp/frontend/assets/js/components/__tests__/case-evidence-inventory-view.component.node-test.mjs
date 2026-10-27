import assert from "node:assert/strict";
import { describe, it } from "node:test";

import caseEvidenceInventoryViewComponent from "../case-evidence-inventory-view.component.js";

// The controller is the last entry of the component's annotated array.
const Controller = caseEvidenceInventoryViewComponent.controller.at(-1);

const SERVICE_ID = "case-analyst-evidence-inventory";

function inventoryAnalysis(overrides = {}) {
    return {
        serviceId:  SERVICE_ID,
        status:     "ready",
        stale:      false,
        reviewedAt: null,
        document:   {
            schemaVersion: "evidence-inventory/v1",
            facts:         [
                { id: "EV1", group: "Familia", statement: "A.", sourceQuote: "a", sourceQuoteFound: true },
                { id: "EV2", group: "Amistad", statement: "B.", sourceQuote: "b", sourceQuoteFound: false },
                { id: "EV3", group: "Familia", statement: "C.", sourceQuote: null, sourceQuoteFound: false },
            ],
            exclusions: [{ id: "EX1", statement: "D.", reason: null }],
        },
        ...overrides,
    };
}

function createView(analysis, { saveAnalysis } = {}) {
    const saves = [];
    const updates = [];
    const service = {
        saveAnalysis: async (caseId, serviceId, document) => {
            saves.push({ caseId, serviceId, document });
            return saveAnalysis ? saveAnalysis(document) : { ...analysis, document, reviewedAt: "now" };
        },
    };
    const vm = new Controller({ $applyAsync: () => {} }, service);
    vm.analysis = analysis;
    vm.caseItem = { id: 7 };
    vm.onAnalysisUpdated = ({ analysis: updated }) => updates.push(updated);
    vm.$onChanges({ analysis: { currentValue: analysis } });
    return { vm, saves, updates };
}

const validForm = { $invalid: false, $setSubmitted() {} };

describe("case evidence inventory view", () => {
    it("groups the facts by theme and counts the quotes not found", () => {
        const { vm } = createView(inventoryAnalysis());

        assert.deepEqual(vm.factGroups.map(group => [group.name, group.facts.map(fact => fact.id)]), [
            ["Familia", ["EV1", "EV3"]],
            ["Amistad", ["EV2"]],
        ]);
        assert.equal(vm.quotesNotFound, 1);
        assert.equal(vm.isReviewed(), false);
        assert.equal(vm.canEdit(), true);
    });

    it("edits a copy and saves it as reviewed through the case analyses API", async () => {
        const analysis = inventoryAnalysis();
        const { vm, saves, updates } = createView(analysis);

        vm.startEditing();
        vm.removeItem(vm.draft.facts, 1);
        vm.addFact();
        vm.draft.facts[2].statement = "Nuevo hecho.";
        vm.addExclusion();
        vm.draft.exclusions[1].statement = "Algo que el caso no dice.";

        assert.equal(analysis.document.facts.length, 3, "the shown document is not edited in place");
        assert.equal(vm.draft.facts[2].group, "Familia");

        await vm.save(validForm);

        assert.deepEqual(saves.map(({ caseId, serviceId }) => [caseId, serviceId]), [[7, SERVICE_ID]]);
        assert.deepEqual(saves[0].document.facts.map(fact => fact.id), ["EV1", "EV3", ""]);
        assert.equal(updates.length, 1);
        assert.equal(updates[0].reviewedAt, "now");
        assert.equal(vm.editing, false);
        assert.equal(vm.alert.messageKey, "case_evidence_inventory_saved");
    });

    it("does not send a form with missing statements", async () => {
        const { vm, saves } = createView(inventoryAnalysis());
        let submitted = false;

        vm.startEditing();
        await vm.save({ $invalid: true, $setSubmitted: () => { submitted = true; } });

        assert.equal(submitted, true);
        assert.deepEqual(saves, []);
        assert.equal(vm.editing, true);
    });

    it("keeps the draft and lists the server's problems when the save is refused", async () => {
        const { vm, updates } = createView(inventoryAnalysis(), {
            saveAnalysis: async () => {
                throw { status: 400, data: { details: ["facts[0].statement is required"] } };
            },
        });
        const originalError = console.error;
        console.error = () => {};

        try {
            vm.startEditing();
            await vm.save(validForm);
        } finally {
            console.error = originalError;
        }

        assert.equal(vm.editing, true);
        assert.deepEqual(updates, []);
        assert.deepEqual(vm.alert, {
            type:       "danger",
            messageKey: "case_evidence_inventory_error_invalid",
            details:    ["facts[0].statement is required"],
        });
    });

    it("offers no edit while a generation is in flight, and keeps an open draft", async () => {
        const { vm, saves } = createView(inventoryAnalysis());
        vm.startEditing();
        vm.draft.facts[0].statement = "Editado.";

        const running = inventoryAnalysis({ status: "requested" });
        vm.analysis = running;
        vm.$onChanges({ analysis: { currentValue: running } });
        await vm.save(validForm);

        assert.equal(vm.generationRunning(), true);
        assert.equal(vm.canSave(), false);
        assert.deepEqual(saves, []);
        assert.equal(vm.draft.facts[0].statement, "Editado.");

        vm.cancelEditing();
        assert.equal(vm.canEdit(), false);
    });
});
