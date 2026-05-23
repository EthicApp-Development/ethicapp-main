/*eslint func-style: ["error", "expression"]*/
export function CasesController($scope, $routeParams, $window, $interval, $translate, toast, CasesCatalogService, UserProfileService) {
    const vm = this;
    const documentProcessingPollIntervalMs = 5000;
    const activeDocumentProcessingStatuses = ["pending", "processing"];
    let documentProcessingPoll = null;
    const TOAST_INFO_TIMEOUT_MS = 4 * 1000;
    const TOAST_ERROR_TIMEOUT_MS = 6 * 1000;

    vm.cases = [];
    vm.ownCases = [];
    vm.publicCases = [];
    vm.archivedCases = [];
    vm.caseMode = 0;
    vm.caseSearch = "";
    vm.caseObj = null;
    vm.currentPage = 1;
    vm.pageSize = 5;
    vm.licenses = [];
    vm.languages = [];
    vm.currentUserProfile = null;

    vm.translate = function(key) {
        return $translate.instant(key);
    };

    vm.showInfoToast = function(message) {
        toast.create({
            timeout: TOAST_INFO_TIMEOUT_MS,
            message,
            containerClass: "cases-toast-container",
            dismissible: false,
            defaultToastClass: "toast",
            insertFromTop: true,
        });
    };

    vm.showErrorToast = function(message) {
        toast.create({
            timeout: TOAST_ERROR_TIMEOUT_MS,
            message,
            className: "alert-danger",
            containerClass: "cases-toast-container",
            dismissible: false,
            defaultToastClass: "toast",
            insertFromTop: true,
        });
    };

    vm.createEmptyCaseForm = function() {
        return {
            title: "",
            authors: [{
                authorFirstname: "",
                authorLastname: "",
                authorEmail: "",
                isPrimary: true,
            }],
            isFirstAuthorCurrentUser: false,
            pdf: null,
            currentPdfPath: null,
            visibility: "private",
            licenseCode: "CC-BY-NC-SA-4.0",
            attributionText: "",
            rightsStatus: "own_work",
            licenseNotes: "",
            permissionStatement: "",
            commercialSource: "",
            languageCode: "es_CL",
            tags: [],
        };
    };
    vm.form = vm.createEmptyCaseForm();

    vm.loadCaseFormOptions = async function() {
        const [licenses, languages] = await Promise.all([
            CasesCatalogService.getLicenses(),
            CasesCatalogService.getLanguages(),
        ]);
        vm.licenses = licenses;
        vm.languages = languages;
        try {
            vm.currentUserProfile = await UserProfileService.getProfile();
        } catch (error) {
            console.error("[CasesController::loadCaseFormOptions] Could not load user profile.", error);
        }
        $scope.$applyAsync();
    };

    vm.loadCases = async function() {
        const [ownCases, publicCases, archivedCases] = await Promise.all([
            CasesCatalogService.getCases(true),
            CasesCatalogService.getPublicCases(true),
            CasesCatalogService.getArchivedCases(true),
        ]);
        vm.ownCases = ownCases;
        vm.publicCases = publicCases;
        vm.archivedCases = archivedCases;
        vm.cases = ownCases;
        vm.currentPage = 1;
        await vm.refreshDocumentProcessingStatuses();
        vm.syncDocumentProcessingPolling();
        $scope.$applyAsync();
    };

    vm.loadCase = async function() {
        const caseId = Number($routeParams.id);
        if (!Number.isInteger(caseId)) {
            return;
        }

        await vm.loadCaseFormOptions();
        const caseObj = await CasesCatalogService.getCaseById(caseId);
        vm.caseObj = caseObj;
        vm.form.title = caseObj.title;
        vm.form.authors = Array.isArray(caseObj.authors) && caseObj.authors.length > 0
            ? caseObj.authors.map((author, index) => ({
                authorFirstname: author.authorFirstname || "",
                authorLastname:  author.authorLastname || "",
                authorEmail:     author.authorEmail || "",
                isPrimary:       index === 0,
            }))
            : [{
                authorFirstname: caseObj.authorFirstname || "",
                authorLastname:  caseObj.authorLastname || "",
                authorEmail:     caseObj.authorEmail || "",
                isPrimary:       true,
            }];
        vm.form.isFirstAuthorCurrentUser = vm.currentUserProfile
            ? vm.form.authors[0]?.authorEmail === (vm.currentUserProfile.email || vm.currentUserProfile.mail)
            : false;
        vm.form.currentPdfPath = caseObj.pdfPath;
        vm.form.visibility = caseObj.visibility || "private";
        vm.form.licenseCode = caseObj.licenseCode || "CC-BY-NC-SA-4.0";
        vm.form.attributionText = caseObj.attributionText || "";
        vm.form.rightsStatus = caseObj.rightsStatus || "own_work";
        vm.form.licenseNotes = caseObj.licenseNotes || "";
        vm.form.permissionStatement = caseObj.permissionStatement || "";
        vm.form.commercialSource = caseObj.commercialSource || "";
        vm.form.languageCode = caseObj.languageCode || "es_CL";
        vm.form.hasLaunchedDesignActivity = caseObj.hasLaunchedDesignActivity === true;
        vm.form.tags = Array.isArray(caseObj.tags) ? caseObj.tags : [];
        await vm.refreshDocumentProcessingStatuses();
        vm.syncDocumentProcessingPolling();
        $scope.$applyAsync();
    };

    vm.formatAuthor = function(caseObj) {
        if (!caseObj) {
            return "";
        }

        return [caseObj.authorFirstname, caseObj.authorLastname].filter(Boolean).join(" ");
    };

    vm.getContentRepresentation = function(caseObj) {
        if (!caseObj || !Array.isArray(caseObj.representations)) {
            return null;
        }

        return caseObj.representations.find((representation) => {
            return representation.rel === "content";
        }) || null;
    };

    vm.getCaseContentUrl = function(caseObj) {
        return vm.getContentRepresentation(caseObj)?.href || caseObj?.pdfPath || "";
    };

    vm.isDocumentProcessingActive = function(documentProcessing) {
        return activeDocumentProcessingStatuses.includes(documentProcessing?.status);
    };

    vm.getCasesForDocumentProcessingPolling = function() {
        if (vm.caseObj) {
            return vm.isDocumentProcessingActive(vm.caseObj.documentProcessing) ? [vm.caseObj] : [];
        }

        return [...vm.ownCases, ...vm.publicCases].filter((caseObj) => {
            return vm.isDocumentProcessingActive(caseObj.documentProcessing);
        });
    };

    vm.refreshDocumentProcessingStatuses = async function() {
        const casesToPoll = vm.getCasesForDocumentProcessingPolling();
        if (casesToPoll.length === 0) {
            vm.stopDocumentProcessingPolling();
            return;
        }

        await Promise.all(casesToPoll.map(async (caseObj) => {
            try {
                const response = await CasesCatalogService.getCaseDocumentProcessing(caseObj.id);
                caseObj.documentProcessing = response.documentProcessing;
            } catch (error) {
                console.error("[CasesController::refreshDocumentProcessingStatuses] Error refreshing document processing status.", error);
            }
        }));

        vm.syncDocumentProcessingPolling();
        $scope.$applyAsync();
    };

    vm.startDocumentProcessingPolling = function() {
        if (documentProcessingPoll) {
            return;
        }

        documentProcessingPoll = $interval(() => {
            vm.refreshDocumentProcessingStatuses();
        }, documentProcessingPollIntervalMs);
    };

    vm.stopDocumentProcessingPolling = function() {
        if (!documentProcessingPoll) {
            return;
        }

        $interval.cancel(documentProcessingPoll);
        documentProcessingPoll = null;
    };

    vm.syncDocumentProcessingPolling = function() {
        if (vm.getCasesForDocumentProcessingPolling().length > 0) {
            vm.startDocumentProcessingPolling();
            return;
        }

        vm.stopDocumentProcessingPolling();
    };

    vm.setCaseMode = function(mode) {
        const nextMode = Number(mode);
        if (!Number.isInteger(nextMode)) {
            return;
        }

        vm.caseMode = [0, 1, 2].includes(nextMode) ? nextMode : 0;
        vm.currentPage = 1;
    };

    vm.getActiveCases = function() {
        if (vm.caseMode === 1) {
            return vm.publicCases;
        }
        if (vm.caseMode === 2) {
            return vm.archivedCases;
        }
        return vm.ownCases;
    };

    vm.getCaseSearchText = function(caseObj) {
        const authorText = Array.isArray(caseObj?.authors)
            ? caseObj.authors.map((author) => {
                return [
                    author.authorFirstname,
                    author.authorLastname,
                    author.authorEmail,
                ].filter(Boolean).join(" ");
            }).join(" ")
            : "";

        return [
            caseObj?.title,
            caseObj?.authorFirstname,
            caseObj?.authorLastname,
            caseObj?.authorEmail,
            authorText,
        ].filter(Boolean).join(" ").toLowerCase();
    };

    vm.caseMatchesSearch = function(caseObj) {
        const keywords = String(vm.caseSearch || "")
            .trim()
            .toLowerCase()
            .split(/\s+/)
            .filter(Boolean);
        if (keywords.length === 0) {
            return true;
        }

        const searchText = vm.getCaseSearchText(caseObj);
        return keywords.every((keyword) => searchText.includes(keyword));
    };

    vm.getFilteredCases = function() {
        return vm.getActiveCases().filter(vm.caseMatchesSearch);
    };

    vm.getTotalPages = function() {
        return Math.max(1, Math.ceil(vm.getFilteredCases().length / vm.pageSize));
    };

    vm.getPaginatedCases = function() {
        const startIndex = (vm.currentPage - 1) * vm.pageSize;
        return vm.getFilteredCases().slice(startIndex, startIndex + vm.pageSize);
    };

    vm.setPage = function(pageNumber) {
        const nextPage = Number(pageNumber);
        if (!Number.isInteger(nextPage)) {
            return;
        }

        vm.currentPage = Math.min(Math.max(nextPage, 1), vm.getTotalPages());
    };

    vm.previousPage = function() {
        vm.setPage(vm.currentPage - 1);
    };

    vm.nextPage = function() {
        vm.setPage(vm.currentPage + 1);
    };

    vm.goBack = function() {
        if ($window.history.length > 1) {
            $window.history.back();
            return;
        }

        $scope.navigateTo("/cases");
    };

    vm.handlePdfSelected = function(files) {
        vm.form.pdf = files && files.length > 0 ? files[0] : null;
    };

    vm.createCase = async function() {
        try {
            await CasesCatalogService.createCase(vm.form);
            vm.showInfoToast(vm.translate("ethical_cases_create_success"));
            $scope.navigateTo("/cases");
        } catch (error) {
            console.error("[CasesController::createCase] Error creating case.", error);
            vm.showErrorToast(vm.translate("ethical_cases_save_error"));
            $scope.$applyAsync();
        }
    };

    vm.updateCase = async function() {
        const caseId = Number($routeParams.id);
        if (!Number.isInteger(caseId)) {
            return;
        }

        try {
            await CasesCatalogService.updateCase(caseId, vm.form);
            vm.showInfoToast(vm.translate("ethical_cases_update_success"));
            $scope.$applyAsync();
        } catch (error) {
            console.error("[CasesController::updateCase] Error updating case.", error);
            const messageKey = error?.data?.code === "CASE_USED_BY_LAUNCHED_ACTIVITY"
                ? "case_cannot_delete_used_by_activity"
                : "ethical_cases_save_error";
            vm.showErrorToast(vm.translate(messageKey));
            $scope.$applyAsync();
        }
    };

    vm.deleteCase = async function(caseId) {
        try {
            await CasesCatalogService.deleteCase(caseId);
            vm.showInfoToast(vm.translate("ethical_cases_delete_success"));
            await vm.loadCases();
            vm.setPage(vm.currentPage);
        } catch (error) {
            console.error("[CasesController::deleteCase] Error deleting case.", error);
            const messageKey = error?.data?.code === "CASE_USED_BY_LAUNCHED_ACTIVITY"
                ? "case_cannot_delete_used_by_activity"
                : "ethical_cases_delete_error";
            vm.showErrorToast(vm.translate(messageKey));
            $scope.$applyAsync();
        }
    };

    vm.viewCase = function(caseItem) {
        $scope.navigateTo(`/cases/${caseItem.id}`);
    };

    vm.editCase = function(caseItem) {
        $scope.navigateTo(`/cases/${caseItem.id}/edit`);
    };

    vm.deleteCaseFromCard = async function(caseItem) {
        await vm.deleteCase(caseItem.id);
    };

    vm.archiveCase = async function(caseItem) {
        const nextArchived = caseItem.archived !== true;
        try {
            await CasesCatalogService.updateCaseArchived(caseItem.id, nextArchived);
            vm.showInfoToast(vm.translate(nextArchived ? "ethical_cases_archive_success" : "ethical_cases_unarchive_success"));
            await vm.loadCases();
            vm.setCaseMode(0);
        } catch (error) {
            console.error("[CasesController::archiveCase] Error updating case archive status.", error);
            vm.showErrorToast(vm.translate("ethical_cases_archive_error"));
            $scope.$applyAsync();
        }
    };

    vm.duplicateCase = async function(caseItem) {
        try {
            await CasesCatalogService.duplicateCase(caseItem.id);
            vm.showInfoToast(vm.translate("ethical_cases_duplicate_success"));
            await vm.loadCases();
            vm.setCaseMode(0);
        } catch (error) {
            console.error("[CasesController::duplicateCase] Error duplicating case.", error);
            vm.showErrorToast(vm.translate("ethical_cases_duplicate_error"));
            $scope.$applyAsync();
        }
    };

    vm.importCase = async function(caseItem) {
        try {
            await CasesCatalogService.importCase(caseItem.id);
            vm.showInfoToast(vm.translate("ethical_cases_import_success"));
            await vm.loadCases();
            vm.setCaseMode(0);
        } catch (error) {
            console.error("[CasesController::importCase] Error importing case.", error);
            vm.showErrorToast(vm.translate("ethical_cases_import_error"));
            $scope.$applyAsync();
        }
    };

    vm.toggleCaseVisibility = async function(caseItem) {
        const previousVisibility = caseItem.visibility || "private";
        const nextVisibility = previousVisibility === "public" ? "private" : "public";
        caseItem.visibility = nextVisibility;
        caseItem.public = nextVisibility === "public";

        try {
            const result = await CasesCatalogService.updateCaseVisibility(caseItem.id, nextVisibility);
            caseItem.visibility = result.visibility;
            caseItem.public = result.public;
        } catch (error) {
            caseItem.visibility = previousVisibility;
            caseItem.public = previousVisibility === "public";
            console.error("[CasesController::toggleCaseVisibility] Error updating case visibility.", error);
            const messageKey = error?.data?.code === "CASE_USED_BY_LAUNCHED_ACTIVITY"
                ? "case_cannot_delete_used_by_activity"
                : "ethical_cases_save_error";
            vm.showErrorToast(vm.translate(messageKey));
        } finally {
            $scope.$applyAsync();
        }
    };

    $scope.$on("$destroy", () => {
        vm.stopDocumentProcessingPolling();
    });
}
