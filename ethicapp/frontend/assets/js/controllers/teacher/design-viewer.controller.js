export function DesignViewerController($scope, $routeParams, DesignCatalogService) {
    const vm = this;
    vm.designId = 0;

    vm.init = async function() {
        vm.designId = Number($routeParams.id);
        if (!isNaN(vm.designId)) {
            vm.design = await DesignCatalogService.getDesignById(vm.designId);

            $scope.$applyAsync(async () => {
                console.log(`[DesignViewerController::init] Design: ${JSON.stringify(vm.design)}`);
            });
        } else {
            console.error("[DesignViewerController::init] Design not found.");
            $scope.navigateTo("/error/404/2");
        }
    }
    
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