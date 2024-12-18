/*eslint func-style: ["error", "expression"]*/
export function BrowseDesignsController($scope, $routeParams,
    DesignStateService, ActivityStateService, 
    DesignCatalogService) {

    const vm = this;
    vm.pickedDesignId = 0;
    vm.dsgntitle = "";
    vm.dsgntype = "";
    vm.userDesigns = [];
    vm.publicDesigns = [];
    vm.designs = [];

    vm.init = async function() {
        await vm.forceFetchDesigns();

        try {
            const designIdParam = Number($routeParams.designId);
            if (!isNaN(designIdParam)) {
                vm.pickedDesignId = designIdParam;
                const designObj = await DesignCatalogService.getDesignById(vm.pickedDesignId);
                vm.userSearch = designObj.metainfo.title;
            }
        } catch(error) {
            console.error("[BrowseDesignsController::init] Failed to retrieve designId route parameter");
        }

        $scope.$on('designCatalogUpdated', async function(event, data) {
            $scope.$apply();
        });
    }

    vm.setPickedDesignId = function(id) {
        vm.pickedDesignId = id;
    }

    vm.forceFetchDesigns = async function() {
        vm.userDesigns = await DesignCatalogService.getUserDesigns();
        vm.publicDesigns = await DesignCatalogService.getPublicDesigns();
        vm.designs = await DesignCatalogService.getDesigns();

        $scope.$apply();
    }

    vm.setInstanceData = function(id, title, type) {
        DesignStateService.setInstanceData(id, title, type);
        vm.dsgnid = id;
        vm.dsgntitle = title;
        vm.dsgntype = type;
    };

    vm.designPublic = async function(id) {
        await DesignCatalogService.togglePublicVisibility(id);
    };
    
    vm.designLock = async function(id) {
        await DesignCatalogService.toggleDesignLock(id);
    };
    
    vm.getDesigns = async function() {
        vm.userDesigns = await DesignCatalogService.getUserDesigns();
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