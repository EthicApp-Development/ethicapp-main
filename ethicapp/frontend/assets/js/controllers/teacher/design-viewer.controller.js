export function DesignViewerController($scope, $routeParams, $window, DesignCatalogService, CasesCatalogService) {
    const vm = this;
    vm.designId = 0;
    vm.design = null;
    vm.associatedCase = null;
    vm.isDesignUnavailable = false;

    vm.init = async function() {
        vm.designId = Number($routeParams.id);
        if (!isNaN(vm.designId)) {
            vm.design = await DesignCatalogService.getDesignById(vm.designId);
            if (!vm.design) {
                vm.isDesignUnavailable = true;
                $scope.$applyAsync();
                return;
            }

            await vm.loadAssociatedCase();

            $scope.$applyAsync(() => {
                // console.log(`[DesignViewerController::init] Design: ${JSON.stringify(vm.design)}`);
            });
        } else {
            console.error("[DesignViewerController::init] Design not found.");
            $scope.navigateTo("/error/404/2");
        }
    };

    vm.loadAssociatedCase = async function() {
        vm.associatedCase = null;
        if (!vm.designId) {
            return;
        }

        try {
            vm.associatedCase = await CasesCatalogService.getCaseByDesignId(vm.designId);
        } catch (error) {
            console.error("[DesignViewerController::loadAssociatedCase] Error loading associated case.", error);
            vm.associatedCase = null;
        } finally {
            $scope.$applyAsync();
        }
    };

    vm.formatCaseLabel = function(caseItem) {
        if (!caseItem) {
            return "";
        }
        const hasAuthor = caseItem.authorFirstname || caseItem.authorLastname;
        if (hasAuthor) {
            return `${caseItem.title} (${caseItem.authorFirstname || ""} ${caseItem.authorLastname || ""})`.trim();
        }
        return caseItem.title;
    };

    vm.goBack = function() {
        if ($window.history.length > 1) {
            $window.history.back();
            return;
        }

        $scope.navigateTo("/designs");
    };
    
    vm.handleLaunch = function() {
        $scope.navigateTo('/activities/new/' + vm.designId);
    };

    vm.handleEdit = function() {
        $scope.navigateTo('/designs/' + vm.designId + '/edit');
    };

    vm.designPublic = async function() {
        await DesignCatalogService.togglePublicVisibility(vm.designId);
    };

    vm.init();
};
