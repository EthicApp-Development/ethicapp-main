// The dialog that asks a case's author to confirm its publication (#939). It
// says that teachers who use the case in their designs keep access to it, to
// its document and to its pages, even if it is made private later, and that
// making it private later only stops new uses.

const TEMPLATE_URL =
    "/assets/static/views/teacher/fragments/case-publication-notice-modal.template.html";

function CasePublicationNoticeModalController($uibModalInstance) {
    const $ctrl = this;

    $ctrl.confirm = function() {
        $uibModalInstance.close(true);
    };

    $ctrl.cancel = function() {
        $uibModalInstance.dismiss("cancel");
    };
}

export function CasePublicationNoticeService($uibModal) {
    return {
        /**
         * Opens the dialog. Resolves true when the author confirms, and false
         * when the dialog is cancelled, closed or dismissed in any other way.
         * @returns {Promise<boolean>}
         */
        confirm() {
            return $uibModal.open({
                templateUrl:     TEMPLATE_URL,
                controller:      ["$uibModalInstance", CasePublicationNoticeModalController],
                controllerAs:    "$ctrl",
                ariaLabelledBy:  "casePublicationNoticeTitle",
                ariaDescribedBy: "casePublicationNoticeBody",
                windowClass:     "case-publication-notice",
            }).result.then(confirmed => confirmed === true, () => false);
        },
    };
}
