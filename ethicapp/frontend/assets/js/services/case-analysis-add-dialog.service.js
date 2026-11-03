// The case view's "Add analysis" dialog (#1039): the creation form's options
// (`case-analysis-options` in "add" mode) with the services the case has not
// chosen, loaded when it opens. "Add" sends the choice
// (POST /cases/:id/analyses) and closes with the case's analyses; while the
// request runs the dialog cannot be closed, so a second click sends nothing.
// A refused request keeps the dialog open and says why.

import {
    caseAnalysisAddErrorKey,
    selectedCaseAnalysisServiceIds,
} from "../helpers/case-analysis-options.js";

const TEMPLATE_URL =
    "/assets/static/views/teacher/fragments/case-analysis-add-modal.template.html";

function CaseAnalysisAddModalController($scope, $uibModalInstance, dialog) {
    const $ctrl = this;

    $ctrl.excludedServiceIds = dialog.chosenServiceIds;
    $ctrl.formModel = { analysisEnabled: true, analysisSelection: {} };
    $ctrl.services = [];
    $ctrl.loading = true;
    $ctrl.hasAttemptedSubmit = false;
    $ctrl.submitting = false;
    $ctrl.errorKey = null;

    // Called by case-analysis-options once it has loaded the services.
    $ctrl.handleServicesLoaded = function(services) {
        $ctrl.services = Array.isArray(services) ? services : [];
        $ctrl.loading = false;
    };

    $ctrl.hasServices = function() {
        return $ctrl.services.length > 0;
    };

    $ctrl.selectedServiceIds = function() {
        return selectedCaseAnalysisServiceIds($ctrl.formModel, $ctrl.services);
    };

    $ctrl.canConfirm = function() {
        return !$ctrl.loading && !$ctrl.submitting && $ctrl.hasServices();
    };

    $ctrl.confirm = async function() {
        if (!$ctrl.canConfirm()) {
            return;
        }
        $ctrl.hasAttemptedSubmit = true;
        const serviceIds = $ctrl.selectedServiceIds();
        if (serviceIds.length === 0) {
            return;
        }

        $ctrl.submitting = true;
        $ctrl.errorKey = null;
        try {
            const analyses = await dialog.submit(serviceIds);
            $ctrl.submitting = false;
            $uibModalInstance.close(analyses);
        } catch (error) {
            console.error("[CaseAnalysisAddDialog] Could not add the analyses.", error);
            $ctrl.submitting = false;
            $ctrl.errorKey = caseAnalysisAddErrorKey(error);
        } finally {
            $scope.$applyAsync();
        }
    };

    $ctrl.cancel = function() {
        if (!$ctrl.submitting) {
            $uibModalInstance.dismiss("cancel");
        }
    };

    // Escape and the backdrop wait for the request too.
    $scope.$on("modal.closing", (event, reason, closed) => {
        if ($ctrl.submitting && !closed) {
            event.preventDefault();
        }
    });
}

const MODAL_CONTROLLER = [
    "$scope", "$uibModalInstance", "dialog", CaseAnalysisAddModalController,
];

export function CaseAnalysisAddDialogService($uibModal, CaseAnalysesService) {
    return {
        /**
         * Opens the dialog for one of the teacher's cases.
         *
         * @param {{ caseId: number, chosenServiceIds?: string[] }} dialog
         *   `chosenServiceIds` are the services the case has, left out.
         * @returns {Promise<object[]|null>} The case's analyses after the
         *   services were added (GET /cases/:id/analyses's shape), or null
         *   when the dialog was cancelled.
         */
        open({ caseId, chosenServiceIds = [] } = {}) {
            return $uibModal.open({
                templateUrl:  TEMPLATE_URL,
                controller:   MODAL_CONTROLLER,
                controllerAs: "$ctrl",
                resolve:      {
                    dialog: () => ({
                        chosenServiceIds: Array.isArray(chosenServiceIds) ? chosenServiceIds : [],
                        submit:           serviceIds => CaseAnalysesService
                            .addAnalyses(caseId, serviceIds),
                    }),
                },
                ariaLabelledBy:  "caseAnalysisAddTitle",
                ariaDescribedBy: "caseAnalysisAddBody",
                windowClass:     "case-analysis-add",
            }).result.then(
                analyses => (Array.isArray(analyses) ? analyses : null),
                () => null
            );
        },
    };
}
