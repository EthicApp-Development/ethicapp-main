/*eslint func-style: ["error", "expression"]*/
export function CasesController($scope, $routeParams, $window, $interval, CasesCatalogService) {
    const vm = this;
    const documentProcessingPollIntervalMs = 5000;
    const activeDocumentProcessingStatuses = ["pending", "processing"];
    let documentProcessingPoll = null;

    vm.cases = [];
    vm.caseObj = null;
    vm.currentPage = 1;
    vm.pageSize = 5;
    vm.form = {
        title: "",
        authorFirstname: "",
        authorLastname: "",
        authorEmail: "",
        pdf: null,
        currentPdfPath: null,
    };

    vm.loadCases = async function() {
        vm.cases = await CasesCatalogService.getCases(true);
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

        const caseObj = await CasesCatalogService.getCaseById(caseId);
        vm.caseObj = caseObj;
        vm.form.title = caseObj.title;
        vm.form.authorFirstname = caseObj.authorFirstname;
        vm.form.authorLastname = caseObj.authorLastname;
        vm.form.authorEmail = caseObj.authorEmail;
        vm.form.currentPdfPath = caseObj.pdfPath;
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

        return vm.cases.filter((caseObj) => {
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

    vm.getTotalPages = function() {
        return Math.max(1, Math.ceil(vm.cases.length / vm.pageSize));
    };

    vm.getPaginatedCases = function() {
        const startIndex = (vm.currentPage - 1) * vm.pageSize;
        return vm.cases.slice(startIndex, startIndex + vm.pageSize);
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
        await CasesCatalogService.createCase(vm.form);
        $scope.navigateTo("/cases");
    };

    vm.updateCase = async function() {
        const caseId = Number($routeParams.id);
        if (!Number.isInteger(caseId)) {
            return;
        }

        await CasesCatalogService.updateCase(caseId, vm.form);
        $scope.navigateTo("/cases");
    };

    vm.deleteCase = async function(caseId) {
        await CasesCatalogService.deleteCase(caseId);
        await vm.loadCases();
        vm.setPage(vm.currentPage);
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

    $scope.$on("$destroy", () => {
        vm.stopDocumentProcessingPolling();
    });
}
