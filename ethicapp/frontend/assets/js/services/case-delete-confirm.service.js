// The dialog that asks before deleting a case (#1017, epic #1008). It says
// that the case is deleted for good, with its PDF, pages, videos, documents
// and analyses, lists the teacher's own designs that will lose their case,
// and says that the case's copies are kept. It offers to archive the case
// instead, unless it is archived already.
//
// The designs come from GET /cases/:id/uses, loaded when the dialog opens.
// While they load, "Delete case" waits; when they cannot be loaded, the
// dialog says so and still lets the teacher delete, since the server checks
// again. When the uses show that the server would refuse (an activity was
// launched from a design that uses the case, or other teachers' designs keep
// it, epic #1008 decision of 2026-11-02), the dialog says why instead of
// offering "Delete case": the list it was opened from may be stale.
//
// It does not depend on the page that opens it: the Cases page and the case
// view (#1018) both call `confirm`.

import {
    DELETE_CHOICE_ARCHIVE,
    DELETE_CHOICE_CANCEL,
    DELETE_CHOICE_DELETE,
    deleteChoiceOf,
    deleteRefusalOf,
    designsLosingCase,
} from "../helpers/case-action-feedback.js";

const TEMPLATE_URL =
    "/assets/static/views/teacher/fragments/case-delete-confirm-modal.template.html";

function CaseDeleteConfirmModalController($scope, $uibModalInstance, dialog) {
    const $ctrl = this;

    $ctrl.title = dialog.title;
    $ctrl.canArchive = dialog.canArchive;
    $ctrl.loading = true;
    $ctrl.loadFailed = false;
    $ctrl.designs = [];
    $ctrl.refusal = null;

    $ctrl.canDelete = function() {
        return !$ctrl.loading && $ctrl.refusal === null;
    };

    $ctrl.confirmDelete = function() {
        if ($ctrl.canDelete()) {
            $uibModalInstance.close(DELETE_CHOICE_DELETE);
        }
    };

    $ctrl.archiveInstead = function() {
        if ($ctrl.canArchive) {
            $uibModalInstance.close(DELETE_CHOICE_ARCHIVE);
        }
    };

    $ctrl.cancel = function() {
        $uibModalInstance.dismiss(DELETE_CHOICE_CANCEL);
    };

    $ctrl.loaded = (async () => {
        try {
            const uses = await dialog.loadUses();
            $ctrl.designs = designsLosingCase(uses);
            $ctrl.refusal = deleteRefusalOf(uses);
        } catch (error) {
            console.warn("[CaseDeleteConfirm] Could not load the case's uses.", error);
            $ctrl.loadFailed = true;
        } finally {
            $ctrl.loading = false;
            $scope.$applyAsync();
        }
    })();
}

const MODAL_CONTROLLER = [
    "$scope", "$uibModalInstance", "dialog", CaseDeleteConfirmModalController,
];

export function CaseDeleteConfirmService($uibModal, CasesCatalogService) {
    return {
        /**
         * Opens the dialog for one of the teacher's cases.
         *
         * Resolves "delete" when the teacher confirms, "archive" when they
         * choose "Archive instead" (offered only for a case that is not
         * archived), or "cancel" when the dialog is cancelled, closed or
         * dismissed in any other way (Escape, the backdrop). It never deletes
         * or archives anything itself: the caller does, and shows the notice.
         *
         * @param {{ caseId: number, title?: string, archived?: boolean }} dialog
         *   `title` is shown in the dialog's question, "" for an untitled case.
         * @returns {Promise<"delete"|"archive"|"cancel">}
         */
        confirm({ caseId, title = "", archived = false } = {}) {
            return $uibModal.open({
                templateUrl:  TEMPLATE_URL,
                controller:   MODAL_CONTROLLER,
                controllerAs: "$ctrl",
                resolve:      {
                    dialog: () => ({
                        title:      typeof title === "string" ? title.trim() : "",
                        canArchive: archived !== true,
                        loadUses:   () => CasesCatalogService.getCaseUses(caseId),
                    }),
                },
                ariaLabelledBy:  "caseDeleteConfirmTitle",
                ariaDescribedBy: "caseDeleteConfirmBody",
                windowClass:     "case-delete-confirm",
            }).result.then(deleteChoiceOf, () => DELETE_CHOICE_CANCEL);
        },
    };
}
