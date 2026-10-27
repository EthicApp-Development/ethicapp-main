// The evidence inventory tab of the case view (#652): the review panel of the
// `case-analyst-evidence-inventory` analysis (document evidence-inventory/v1).
// The teacher reads the facts by theme with their quotes, edits, adds and
// removes facts and exclusions, and saves the inventory as reviewed through
// PUT /cases/:id/analyses/:serviceId, which checks every quote again against
// the case text. "Generate again" and the generation status belong to the
// surrounding case analysis panel (#651).

import {
    canEditEvidenceInventory,
    countQuotesNotFound,
    createEditableInventory,
    createEmptyExclusion,
    createEmptyFact,
    evidenceInventorySaveError,
    groupFacts,
    isEvidenceInventoryReviewed,
} from "../helpers/evidence-inventory.js";

function CaseEvidenceInventoryViewController($scope, CaseAnalysesService) {
    const vm = this;
    let destroyed = false;

    vm.document = { facts: [], exclusions: [] };
    vm.factGroups = [];
    vm.quotesNotFound = 0;
    vm.editing = false;
    vm.draft = null;
    vm.saving = false;
    vm.alert = null;

    // A reloaded analysis (for example after a new generation) replaces what
    // is read; a draft being edited is kept until it is saved or cancelled.
    vm.$onChanges = function(changes) {
        if (changes.analysis) {
            vm.document = createEditableInventory(vm.analysis?.document);
            vm.factGroups = groupFacts(vm.document.facts);
            vm.quotesNotFound = countQuotesNotFound(vm.document.facts);
        }
    };

    vm.$onDestroy = function() {
        destroyed = true;
    };

    vm.isReviewed = function() {
        return isEvidenceInventoryReviewed(vm.analysis);
    };

    vm.generationRunning = function() {
        return !canEditEvidenceInventory(vm.analysis) && Boolean(vm.analysis?.document);
    };

    vm.canEdit = function() {
        return !vm.editing && !vm.saving && canEditEvidenceInventory(vm.analysis);
    };

    vm.canSave = function() {
        return !vm.saving && canEditEvidenceInventory(vm.analysis);
    };

    vm.startEditing = function() {
        vm.draft = createEditableInventory(vm.analysis?.document);
        vm.editing = true;
        vm.alert = null;
    };

    vm.cancelEditing = function() {
        vm.editing = false;
        vm.draft = null;
        vm.alert = null;
    };

    vm.addFact = function() {
        const facts = vm.draft.facts;
        facts.push(createEmptyFact(facts[facts.length - 1]));
    };

    vm.addExclusion = function() {
        vm.draft.exclusions.push(createEmptyExclusion());
    };

    vm.removeItem = function(items, index) {
        items.splice(index, 1);
    };

    vm.save = async function(form) {
        if (form?.$invalid) {
            form.$setSubmitted();
            return;
        }
        if (!vm.canSave()) {
            return;
        }

        vm.saving = true;
        vm.alert = null;

        try {
            const saved = await CaseAnalysesService.saveAnalysis(
                vm.caseItem?.id,
                vm.analysis?.serviceId,
                vm.draft
            );
            if (destroyed) {
                return;
            }
            vm.editing = false;
            vm.draft = null;
            vm.alert = { type: "success", messageKey: "case_evidence_inventory_saved", details: [] };
            vm.onAnalysisUpdated({ analysis: saved });
        } catch (error) {
            console.error("[caseEvidenceInventoryView] Could not save the inventory.", error);
            if (!destroyed) {
                vm.alert = { type: "danger", ...evidenceInventorySaveError(error) };
            }
        } finally {
            if (!destroyed) {
                vm.saving = false;
                $scope.$applyAsync();
            }
        }
    };
}

export default {
    bindings: {
        analysis:          "<",
        caseItem:          "<",
        onAnalysisUpdated: "&",
    },
    controller:  ["$scope", "CaseAnalysesService", CaseEvidenceInventoryViewController],
    templateUrl: "/assets/static/views/teacher/fragments/case-evidence-inventory-view.template.html",
};
