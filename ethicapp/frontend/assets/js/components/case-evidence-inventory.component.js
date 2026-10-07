import {
    createEditableInventory,
    createEmptyExclusion,
    createEmptyFact,
    getStatusLabelClass,
    groupFacts,
    isDocumentProcessing,
    isDocumentUnavailable,
    shouldPollInventory,
} from "../helpers/evidence-inventory-helpers.js";

const POLL_INTERVAL_MS = 5000;
const KEY_PREFIX = "ethical_cases_evidence_inventory_";
const ERROR_MESSAGE_KEYS = {
    EVIDENCE_INVENTORY_INVALID:          `${KEY_PREFIX}error_invalid`,
    EVIDENCE_INVENTORY_PROCESSING:       `${KEY_PREFIX}error_processing`,
    CASE_DOCUMENT_NOT_READY:             `${KEY_PREFIX}error_document_not_ready`,
    EVIDENCE_INVENTORY_SERVICE_DISABLED: `${KEY_PREFIX}error_service_disabled`,
};

/**
 * Evidence inventory of a case, shown to the case creator on the case page.
 * The AI drafts it when the case is uploaded; the teacher reviews, edits and
 * saves it as reviewed. The component hides itself for other users.
 */
const CaseEvidenceInventoryController = function(
    $scope, $interval, $translate, CasesCatalogService
) {
    const ctrl = this;
    let poll = null;
    let idlePolls = 0;
    // A document render was seen in this view and the generation it triggers
    // has not started yet (for example, after the PDF was replaced).
    let awaitingGeneration = false;
    let destroyed = false;

    ctrl.available = false;
    ctrl.state = null;
    ctrl.factGroups = [];
    ctrl.editing = false;
    ctrl.draft = null;
    ctrl.busy = false;
    ctrl.alert = null;

    ctrl.$onInit = function() {
        ctrl.load();
    };

    ctrl.$onDestroy = function() {
        destroyed = true;
        stopPolling();
    };

    ctrl.getCaseId = function() {
        return ctrl.caseItem?.id;
    };

    ctrl.getStatusLabelClass = function() {
        return getStatusLabelClass(ctrl.state?.status);
    };

    ctrl.getStatusLabelKey = function() {
        return `${KEY_PREFIX}status_${ctrl.state?.status || "none"}`;
    };

    ctrl.hasInventory = function() {
        return Boolean(ctrl.state?.inventory);
    };

    ctrl.isProcessing = function() {
        return ctrl.state?.status === "processing" && !ctrl.state.stale;
    };

    ctrl.isDocumentProcessing = function() {
        return isDocumentProcessing(ctrl.state);
    };

    ctrl.isDocumentUnavailable = function() {
        return isDocumentUnavailable(ctrl.state);
    };

    ctrl.canGenerate = function() {
        return Boolean(ctrl.state?.serviceEnabled && ctrl.state.documentReady)
            && !ctrl.isProcessing()
            && !ctrl.editing
            && !ctrl.busy;
    };

    ctrl.canEdit = function() {
        return Boolean(ctrl.state) && !ctrl.isProcessing() && !ctrl.editing && !ctrl.busy;
    };

    function setAlert(type, messageKey, details = []) {
        ctrl.alert = { type, messageKey, details };
    }

    function applyState(state) {
        if (isDocumentProcessing(state)) {
            awaitingGeneration = true;
            idlePolls = 0;
        }
        if (state?.status === "processing") {
            awaitingGeneration = false;
        }
        ctrl.state = state;
        ctrl.factGroups = groupFacts(state?.inventory?.facts);
        ctrl.available = true;
    }

    function setErrorAlert(error, fallbackKey) {
        const code = error?.data?.code;
        setAlert("danger", ERROR_MESSAGE_KEYS[code] || fallbackKey, error?.data?.details || []);
    }

    ctrl.load = async function() {
        const caseId = ctrl.getCaseId();
        if (!caseId || destroyed) {
            return;
        }

        try {
            const state = await CasesCatalogService.getEvidenceInventory(caseId);
            if (destroyed) {
                return;
            }
            applyState(state);
            syncPolling();
        } catch (error) {
            if (error?.status === 403 || error?.status === 404) {
                ctrl.available = false;
                stopPolling();
            } else {
                console.error("[CaseEvidenceInventory::load] Could not load the inventory.", error);
                ctrl.available = true;
                setAlert("danger", `${KEY_PREFIX}error_load`);
            }
        } finally {
            $scope.$applyAsync();
        }
    };

    async function refresh() {
        if (ctrl.state?.documentStatus === "completed" && ctrl.state.status !== "processing") {
            idlePolls += 1;
        }
        await ctrl.load();
    }

    function startPolling() {
        if (!poll) {
            poll = $interval(refresh, POLL_INTERVAL_MS);
        }
    }

    function stopPolling() {
        if (poll) {
            $interval.cancel(poll);
            poll = null;
        }
    }

    function syncPolling() {
        if (!destroyed && shouldPollInventory(ctrl.state, { idlePolls, awaitingGeneration })) {
            startPolling();
        } else {
            stopPolling();
        }
    }

    async function handleRequestError(error, context) {
        console.error(`[CaseEvidenceInventory::${context}] Request failed.`, error);
        setErrorAlert(error, `${KEY_PREFIX}error_generic`);
        if (error?.status === 409) {
            // The inventory changed meanwhile, for example a generation started.
            await ctrl.load();
        }
    }

    ctrl.generate = async function() {
        if (ctrl.hasInventory()
            && !window.confirm($translate.instant(`${KEY_PREFIX}regenerate_confirm`))) {
            return;
        }

        ctrl.busy = true;
        ctrl.alert = null;
        try {
            applyState(await CasesCatalogService.generateEvidenceInventory(ctrl.getCaseId()));
            syncPolling();
        } catch (error) {
            await handleRequestError(error, "generate");
        } finally {
            ctrl.busy = false;
            $scope.$applyAsync();
        }
    };

    ctrl.startEditing = function() {
        ctrl.draft = createEditableInventory(ctrl.state?.inventory);
        ctrl.editing = true;
        ctrl.alert = null;
        stopPolling();
    };

    ctrl.cancelEditing = function() {
        ctrl.editing = false;
        ctrl.draft = null;
        ctrl.alert = null;
        syncPolling();
    };

    ctrl.addFact = function() {
        const facts = ctrl.draft.facts;
        facts.push(createEmptyFact(facts[facts.length - 1]));
    };

    ctrl.addExclusion = function() {
        ctrl.draft.exclusions.push(createEmptyExclusion());
    };

    ctrl.removeItem = function(items, index) {
        items.splice(index, 1);
    };

    ctrl.save = async function(form) {
        if (form?.$invalid) {
            form.$setSubmitted();
            return;
        }

        ctrl.busy = true;
        ctrl.alert = null;
        try {
            const caseId = ctrl.getCaseId();
            applyState(await CasesCatalogService.saveEvidenceInventory(caseId, ctrl.draft));
            ctrl.editing = false;
            ctrl.draft = null;
            setAlert("success", `${KEY_PREFIX}saved`);
            syncPolling();
        } catch (error) {
            await handleRequestError(error, "save");
        } finally {
            ctrl.busy = false;
            $scope.$applyAsync();
        }
    };
};

const caseEvidenceInventoryComponent = {
    bindings: {
        caseItem: "<",
    },
    controller: [
        "$scope",
        "$interval",
        "$translate",
        "CasesCatalogService",
        CaseEvidenceInventoryController,
    ],
    templateUrl: "/assets/static/views/teacher/fragments/case-evidence-inventory.template.html",
};

export default caseEvidenceInventoryComponent;
