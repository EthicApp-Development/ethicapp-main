/*eslint func-style: ["error", "expression"]*/
export function CasesController($scope, $routeParams, $window, CasesCatalogService) {
    const vm = this;
    vm.cases = [];
    vm.caseObj = null;
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
    };
}
