// The dialog that asks before deleting a design (#978, epic #966). It says
// that the design is deleted for good, with its phases and questions, and
// that its copies are kept (#963). It offers to archive the design instead,
// unless it is archived already.

import {
    DELETE_CHOICE_ARCHIVE,
    DELETE_CHOICE_CANCEL,
    DELETE_CHOICE_DELETE,
    deleteChoiceOf,
} from "../helpers/design-action-feedback.js";

const TEMPLATE_URL =
    "/assets/static/views/teacher/fragments/design-delete-confirm-modal.template.html";

function DesignDeleteConfirmModalController($uibModalInstance, dialog) {
    const $ctrl = this;

    $ctrl.title = dialog.title;
    $ctrl.canArchive = dialog.canArchive;

    $ctrl.confirmDelete = function() {
        $uibModalInstance.close(DELETE_CHOICE_DELETE);
    };

    $ctrl.archiveInstead = function() {
        $uibModalInstance.close(DELETE_CHOICE_ARCHIVE);
    };

    $ctrl.cancel = function() {
        $uibModalInstance.dismiss(DELETE_CHOICE_CANCEL);
    };
}

const MODAL_CONTROLLER = ["$uibModalInstance", "dialog", DesignDeleteConfirmModalController];

export function DesignDeleteConfirmService($uibModal) {
    return {
        /**
         * Opens the dialog for one design. Resolves "delete", "archive" (only
         * offered when `canArchive`), or "cancel" when the dialog is cancelled,
         * closed or dismissed in any other way (Escape, the backdrop).
         * @param {{ title: string, canArchive: boolean }} dialog
         * @returns {Promise<"delete"|"archive"|"cancel">}
         */
        confirm({ title = "", canArchive = false } = {}) {
            return $uibModal.open({
                templateUrl:     TEMPLATE_URL,
                controller:      MODAL_CONTROLLER,
                controllerAs:    "$ctrl",
                resolve:         { dialog: () => ({ title, canArchive: canArchive === true }) },
                ariaLabelledBy:  "designDeleteConfirmTitle",
                ariaDescribedBy: "designDeleteConfirmBody",
                windowClass:     "design-delete-confirm",
            }).result.then(deleteChoiceOf, () => DELETE_CHOICE_CANCEL);
        },
    };
}
