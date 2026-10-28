// The claim typology of a design (#849, epic #846), in the teacher's design
// view. It reads the `case-analyst-claim-typology` analysis of the design,
// shows its generation state (pending, failed, out of date) and offers
// "Generate again" with a confirmation. The typology itself is shown per
// question inside each phase (claim-typology-questions): this panel hands the
// view to the design view through `onViewChanged`. It is read-only. Only the
// design owner can read the analysis, so the panel shows nothing to others.
//
// The questions, their text hashes and each tutor question's expected mode
// come from the backend with the analysis (#865); the panel keeps no copy of
// the selection or mode rules.

import {
    canGenerateClaimTypology,
    CLAIM_TYPOLOGY_POLL_INTERVAL_MS,
    CLAIM_TYPOLOGY_SERVICE_ID,
    citesEvidence,
    claimTypologyErrorKey,
    claimTypologyGenerateNotice,
    claimTypologyQuestions,
    claimTypologyView,
    EVIDENCE_INVENTORY_SERVICE_ID,
    evidenceFactsById,
} from "../helpers/claim-typology.js";
import { caseAnalysisIndicator, hasLatestGenerationFailed } from "../helpers/case-analyses.js";

// What the panel shows before the first read, or when the read fails.
const EMPTY_SELECTION = Object.freeze({
    analysis:       null,
    units:          [],
    unitsReason:    null,
    producerUsable: false,
    tutorModes:     {},
    tutorPhases:    [],
});

function ClaimTypologyPanelController(
    $scope, $timeout, $element, DesignAnalysesService, CaseAnalysesService
) {
    const vm = this;
    let destroyed = false;
    let pollTimer = null;
    let loadSequence = 0;
    let selection = EMPTY_SELECTION;
    let facts = {};
    let factsDocument = null;

    vm.analysis = null;
    vm.view = null;
    vm.loaded = false;
    vm.loadFailed = false;
    vm.confirmingGenerate = false;
    vm.generating = false;
    vm.notice = null;

    vm.$onInit = async function() {
        if (vm.design?.userOwned !== true) {
            return;
        }
        await vm.load();
    };

    vm.$onDestroy = function() {
        destroyed = true;
        cancelPoll();
    };

    function cancelPoll() {
        if (pollTimer) {
            $timeout.cancel(pollTimer);
            pollTimer = null;
        }
    }

    function schedulePoll() {
        cancelPoll();
        if (!destroyed && vm.view?.inFlight) {
            pollTimer = $timeout(() => vm.load(), CLAIM_TYPOLOGY_POLL_INTERVAL_MS);
        }
    }

    // The statements of the evidence the typology cites, from the case's
    // current evidence inventory. Read again only when the document changes.
    async function loadFacts(document) {
        if (document === factsDocument) {
            return;
        }
        factsDocument = document;
        facts = {};

        const caseId = vm.design?.caseId;
        if (!caseId || !citesEvidence(document)) {
            return;
        }

        try {
            const inventory = await CaseAnalysesService.getAnalysis(
                caseId,
                EVIDENCE_INVENTORY_SERVICE_ID
            );
            facts = evidenceFactsById(inventory?.document);
        } catch (error) {
            // Without the inventory, the cited ids are shown alone.
            facts = {};
        }
    }

    function publishView() {
        const questions = claimTypologyQuestions({
            units:      selection.units,
            document:   vm.analysis?.document ?? null,
            facts,
            tutorModes: selection.tutorModes,
        });
        vm.view = {
            ...claimTypologyView({
                analysis:    vm.analysis,
                questions,
                unitsReason: selection.unitsReason,
                tutorPhases: selection.tutorPhases,
            }),
            caseId:          vm.design?.caseId ?? null,
            canGenerate:     vm.canGenerate(),
            requestGenerate: vm.requestGenerateFromQuestion,
        };
        vm.onViewChanged({ view: vm.view });
    }

    vm.load = async function() {
        const designId = vm.design?.id;
        if (!designId) {
            return;
        }

        const sequence = ++loadSequence;
        try {
            const result = await DesignAnalysesService.getAnalysis(
                designId,
                CLAIM_TYPOLOGY_SERVICE_ID
            );
            if (destroyed || sequence !== loadSequence) {
                return;
            }
            const loaded = result ?? EMPTY_SELECTION;
            await loadFacts(loaded.analysis?.document ?? null);
            if (destroyed || sequence !== loadSequence) {
                return;
            }
            selection = loaded;
            vm.analysis = loaded.analysis;
            vm.loadFailed = false;
            publishView();
        } catch (error) {
            if (destroyed || sequence !== loadSequence) {
                return;
            }
            console.error("[claimTypologyPanel] Could not load the claim typology.", error);
            vm.loadFailed = true;
        } finally {
            if (!destroyed && sequence === loadSequence) {
                vm.loaded = true;
                schedulePoll();
                $scope.$applyAsync();
            }
        }
    };

    // The panel is shown to the owner of a design with a case and questions
    // the typology covers, with a stored analysis, or when the services that
    // use the typology are switched off (to say so).
    vm.isVisible = function() {
        if (!vm.loaded || vm.design?.userOwned !== true) {
            return false;
        }
        if (vm.analysis || vm.loadFailed) {
            return true;
        }
        return Boolean(vm.design.caseId)
            && (selection.units.length > 0 || selection.unitsReason === "consumers-unusable");
    };

    vm.state = function() {
        return vm.view?.state ?? "none";
    };

    vm.indicator = function() {
        return caseAnalysisIndicator(vm.analysis);
    };

    vm.latestGenerationFailed = function() {
        return hasLatestGenerationFailed(vm.analysis);
    };

    vm.errorKey = function() {
        return claimTypologyErrorKey(vm.analysis?.errorCode);
    };

    vm.errorMessage = function() {
        return vm.analysis?.errorMessage || "";
    };

    vm.hasDocument = function() {
        return Boolean(vm.analysis?.document);
    };

    vm.isLocked = function() {
        return vm.design?.locked === true;
    };

    vm.unitsReasonKey = function() {
        return vm.view?.unitsReasonKey ?? null;
    };

    // The typology covers questions but its own service is switched off.
    vm.isProducerUnavailable = function() {
        return selection.units.length > 0 && selection.producerUsable !== true;
    };

    vm.canGenerate = function() {
        return !vm.generating && canGenerateClaimTypology({
            design:         vm.design,
            analysis:       vm.analysis,
            units:          selection.units,
            producerUsable: selection.producerUsable,
        });
    };

    vm.askToGenerate = function() {
        vm.notice = null;
        vm.confirmingGenerate = true;
    };

    // "Generate again" from a question's note, further down the page: the
    // confirmation is the panel's, so the panel is brought into view.
    vm.requestGenerateFromQuestion = function() {
        if (!vm.canGenerate()) {
            return;
        }
        vm.askToGenerate();
        $element[0]?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    };

    vm.cancelGenerate = function() {
        vm.confirmingGenerate = false;
    };

    vm.confirmGenerate = async function() {
        if (vm.generating) {
            return;
        }

        vm.confirmingGenerate = false;
        vm.generating = true;
        vm.notice = null;

        try {
            const { outcome } = await DesignAnalysesService.generateAnalysis(
                vm.design.id,
                CLAIM_TYPOLOGY_SERVICE_ID
            );
            if (!destroyed && outcome !== "accepted") {
                vm.notice = claimTypologyGenerateNotice(outcome);
            }
        } catch (error) {
            console.error("[claimTypologyPanel] Could not request a new generation.", error);
            if (!destroyed) {
                vm.notice = claimTypologyGenerateNotice("error");
            }
        } finally {
            if (!destroyed) {
                vm.generating = false;
                await vm.load();
            }
        }
    };
}

export default {
    bindings: {
        design:        "<",
        onViewChanged: "&",
    },
    controller: [
        "$scope", "$timeout", "$element", "DesignAnalysesService", "CaseAnalysesService",
        ClaimTypologyPanelController,
    ],
    templateUrl: "/assets/static/views/teacher/fragments/claim-typology-panel.template.html",
};
