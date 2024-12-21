/*eslint func-style: ["error", "expression"]*/
export function BrowseDesignsController($scope, $routeParams, toast, $translate,
    ActivityStateService, DesignCatalogService) {

    const vm = this;
    vm.selectedDesignId = 0;
    vm.userDesigns = [];
    vm.publicDesigns = [];
    vm.designs = [];

    vm.init = async function() {
        const updateHandler = function() {
            vm.forceFetchDesigns();
        };

        DesignCatalogService.registerListener("onDesignCatalogUpdated", 
            updateHandler);

        $scope.$on('$destroy', function () {
            DesignCatalogService.unregisterListener("onDesignCatalogUpdated", 
                updateHandler);    
        });
        
        try {
            await vm.forceFetchDesigns();

            const designIdParam = Number($routeParams.designId);
            if (!isNaN(designIdParam)) {
                vm.selectedDesignId = designIdParam;
                const designObj = await DesignCatalogService.getDesignById(vm.selectedDesignId);
                vm.userSearch = designObj.metainfo.title;
            }
        } catch(error) {
            console.error("[BrowseDesignsController::init] Failed to retrieve designId route parameter");
        }        
    }

    vm.handleSelectDesign = function(id) {
        $scope.$applyAsync(() => {
            vm.selectedDesignId = id;
        });
    }

    vm.forceFetchDesigns = async function() {
        vm.userDesigns = await DesignCatalogService.getUserDesigns();
        vm.publicDesigns = await DesignCatalogService.getPublicDesigns();
        vm.designs = await DesignCatalogService.getDesigns();

        $scope.$applyAsync();
    }

    vm.designPublic = async function(id) {
        await DesignCatalogService.togglePublicVisibility(id);
    };
    
    vm.designLock = async function(id) {
        await DesignCatalogService.toggleDesignLock(id);
    };
    
    vm.getDesigns = async function() {
        vm.userDesigns = await DesignCatalogService.getUserDesigns();
    };

    vm.handleLaunch = function(designId) {
        $scope.navigateTo('/activities/new/' + designId);
    };

    vm.handleEdit = function(designId) {
        $scope.navigateTo('/designs/' + designId + '/edit');
    };

    vm.handleView = function(designId) {
        $scope.navigateTo('/designs/' + designId);
    };

    vm.getPublicDesigns = async function() {
        vm.publicDesigns = await DesignCatalogService.getPublicDesigns();
    };
    
    vm.deleteDesign = async function(id) {
        await DesignCatalogService.deleteDesign(id);
    };

    vm.duplicateDesign = async function(id) {
        await DesignCatalogService.duplicateDesign(id);
    };

    vm.importDesign = async function(id) {
        await DesignCatalogService.importDesign(id);
        
        $scope.$applyAsync(() => {
            $translate("design_imported_text").then((result) => {
                toast.create({
                    timeout: 100 * 1000,
                    message: result,
                    containerClass: 'toast-container',
                    dismissible: false,
                    defaultToastClass: 'toast',
                    insertFromTop: true,
                  });
            });
        });        
    };
    
    vm.getDesign = async function(id) {
        const design = await DesignCatalogService.getDesignById(id);
        ActivityStateService.setDesign(id, design);
    };

    vm.filterById = function(design) {
        return vm.selectedDesign && design.id === vm.selectedDesign.id;
    };

    vm.init();
};