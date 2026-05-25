function CasePublicationSettingsModalController($uibModalInstance, caseItem, licenses) {
    const vm = this;

    vm.caseItem = caseItem;
    vm.licenses = licenses;
    vm.hasAttemptedSubmit = false;
    vm.publicSharingError = false;
    vm.visibilityOptions = [
        { value: "private", labelKey: "visibility_private" },
        { value: "public", labelKey: "visibility_public" },
    ];
    vm.formModel = {
        title: caseItem.title || "",
        authors: Array.isArray(caseItem.authors) && caseItem.authors.length > 0
            ? caseItem.authors
            : [{
                authorFirstname: caseItem.authorFirstname || "",
                authorLastname:  caseItem.authorLastname || "",
                authorEmail:     caseItem.authorEmail || "",
                isPrimary:       true,
            }],
        currentPdfPath: caseItem.pdfPath,
        visibility: caseItem.visibility || "private",
        licenseCode: caseItem.licenseCode || "CC-BY-NC-SA-4.0",
        attributionText: caseItem.attributionText || "",
        rightsStatus: caseItem.rightsStatus || "own_work",
        licenseNotes: caseItem.licenseNotes || "",
        permissionStatement: caseItem.permissionStatement || "",
        commercialSource: caseItem.commercialSource || "",
        languageCode: caseItem.languageCode || "es_CL",
    };

    vm.shouldShowError = function(control) {
        if (!control) {
            return false;
        }

        return control.$invalid && (control.$touched || vm.hasAttemptedSubmit);
    };

    vm.canPublishCase = function() {
        return vm.formModel.visibility === "public" &&
            Boolean(vm.formModel.licenseCode);
    };

    vm.save = function(form) {
        vm.hasAttemptedSubmit = true;
        vm.publicSharingError = false;

        if (!form || !form.$valid) {
            return;
        }

        if (!vm.canPublishCase()) {
            vm.publicSharingError = true;
            return;
        }

        $uibModalInstance.close(vm.formModel);
    };

    vm.cancel = function() {
        $uibModalInstance.dismiss("cancel");
    };
}

let DesignPublicationService = ($uibModal, DesignCatalogService, CasesCatalogService) => {
    const service = {};

    service.isCaseReadyForPublicDesign = function(caseItem) {
        if (!caseItem) {
            return true;
        }

        return caseItem.visibility === "public" &&
            Boolean(caseItem.licenseCode);
    };

    service.restorePrivateDesignState = function(design) {
        if (!design) {
            return;
        }

        design.visibility = "private";
        design.public = false;
    };

    service.syncPublicFlagWithVisibility = function(design) {
        if (!design) {
            return;
        }

        design.public = design.visibility === "public";
    };

    service.loadAssociatedCase = async function(design) {
        if (!design?.caseId) {
            return null;
        }

        if (design.associatedCase) {
            return design.associatedCase;
        }

        return CasesCatalogService.getCaseByDesignId(design.id);
    };

    service.getErrorCode = function(error) {
        return error?.data?.code || error?.response?.data?.code;
    };

    service.openCaseSettingsModal = async function(caseItem) {
        const [fullCase, licenses] = await Promise.all([
            CasesCatalogService.getCaseById(caseItem.id),
            CasesCatalogService.getLicenses(),
        ]);

        const modalInstance = $uibModal.open({
            templateUrl: "/assets/static/views/teacher/fragments/case-publication-settings-modal.template.html",
            controller:  ["$uibModalInstance", "caseItem", "licenses", CasePublicationSettingsModalController],
            controllerAs: "$ctrl",
            backdrop:    "static",
            size:        "lg",
            resolve:     {
                caseItem: function() {
                    return fullCase;
                },
                licenses: function() {
                    return licenses;
                },
            },
        });

        return modalInstance.result;
    };

    service.updateCaseSettingsAndPublishDesign = async function(design, associatedCase) {
        service.restorePrivateDesignState(design);

        const updatedCaseForm = await service.openCaseSettingsModal(associatedCase);
        const updatedCase = await CasesCatalogService.updateCase(associatedCase.id, updatedCaseForm);
        design.associatedCase = updatedCase;

        if (!service.isCaseReadyForPublicDesign(updatedCase)) {
            service.restorePrivateDesignState(design);
            return { status: "case_not_ready" };
        }

        service.syncPublicFlagWithVisibility(design);
        await DesignCatalogService.togglePublicVisibility(design.id);
        return { status: "public" };
    };

    service.togglePublicVisibility = async function(design) {
        if (!design) {
            return { status: "error" };
        }

        const wantsPublicVisibility = design.visibility !== "public";
        if (!wantsPublicVisibility) {
            service.syncPublicFlagWithVisibility(design);
            await DesignCatalogService.togglePublicVisibility(design.id);
            return { status: "private" };
        }

        const associatedCase = await service.loadAssociatedCase(design);
        if (!associatedCase || service.isCaseReadyForPublicDesign(associatedCase)) {
            service.syncPublicFlagWithVisibility(design);
            try {
                await DesignCatalogService.togglePublicVisibility(design.id);
                return { status: "public" };
            } catch (error) {
                if (associatedCase && service.getErrorCode(error) === "CASE_VISIBILITY_REQUIRED") {
                    try {
                        return await service.updateCaseSettingsAndPublishDesign(design, associatedCase);
                    } catch (modalError) {
                        service.restorePrivateDesignState(design);
                        if (modalError === "cancel") {
                            return { status: "cancelled" };
                        }
                        throw modalError;
                    }
                }
                throw error;
            }
        }

        try {
            return await service.updateCaseSettingsAndPublishDesign(design, associatedCase);
        } catch (error) {
            service.restorePrivateDesignState(design);
            if (error === "cancel") {
                return { status: "cancelled" };
            }
            throw error;
        }
    };

    return service;
};

export { DesignPublicationService };
