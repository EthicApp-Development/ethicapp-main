// The case view's "Remove analysis" dialog (#1040). It asks before removing
// an analysis from the case: its result and the teacher's changes are
// deleted, and it can be added again later. While a generation is in flight
// it adds that the service may still finish its work, but its result will be
// discarded. "Remove" sends DELETE /cases/:id/analyses/:serviceId and closes
// once it answers; while the request runs the dialog cannot be closed, so a
// second click sends nothing. A failed request keeps the dialog open and
// says so.

const TEMPLATE_URL =
    "/assets/static/views/teacher/fragments/case-analysis-remove-modal.template.html";

const REMOVE_FAILED_KEY = "case_analysis_remove_failed";

function CaseAnalysisRemoveModalController($scope, $uibModalInstance, dialog) {
    const $ctrl = this;

    $ctrl.title = dialog.title;
    $ctrl.inFlight = dialog.inFlight;
    $ctrl.submitting = false;
    $ctrl.errorKey = null;

    $ctrl.confirm = async function() {
        if ($ctrl.submitting) {
            return;
        }

        $ctrl.submitting = true;
        $ctrl.errorKey = null;
        try {
            await dialog.submit();
            $ctrl.submitting = false;
            $uibModalInstance.close(true);
        } catch (error) {
            console.error("[CaseAnalysisRemoveDialog] Could not remove the analysis.", error);
            $ctrl.submitting = false;
            $ctrl.errorKey = REMOVE_FAILED_KEY;
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
    "$scope", "$uibModalInstance", "dialog", CaseAnalysisRemoveModalController,
];

export function CaseAnalysisRemoveDialogService($uibModal, CaseAnalysesService) {
    return {
        /**
         * Opens the dialog for one analysis of one of the teacher's cases.
         *
         * @param {{ caseId: number, serviceId: string, title?: string,
         *   inFlight?: boolean }} dialog `title` is the analysis's tab title;
         *   `inFlight` says that a generation is running.
         * @returns {Promise<boolean>} true once the analysis was removed,
         *   false when the dialog was cancelled.
         */
        open({ caseId, serviceId, title = "", inFlight = false } = {}) {
            return $uibModal.open({
                templateUrl:  TEMPLATE_URL,
                controller:   MODAL_CONTROLLER,
                controllerAs: "$ctrl",
                resolve:      {
                    dialog: () => ({
                        title:    typeof title === "string" ? title.trim() : "",
                        inFlight: inFlight === true,
                        submit:   () => CaseAnalysesService.removeAnalysis(caseId, serviceId),
                    }),
                },
                ariaLabelledBy:  "caseAnalysisRemoveTitle",
                ariaDescribedBy: "caseAnalysisRemoveBody",
                windowClass:     "case-analysis-remove",
            }).result.then(removed => removed === true, () => false);
        },
    };
}
