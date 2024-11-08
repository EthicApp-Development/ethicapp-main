/*eslint func-style: ["error", "expression"]*/
export function BrowseDesignsController($scope, 
    TabStateService, DesignStateService, ActivityStateService, 
    DesignCatalogService, $filter, $http) {

    const vm = this;
    vm.dsgnid = 0;
    vm.dsgntitle = "";
    vm.dsgntype = "";
    vm.userDesigns = [];
    vm.publicDesigns = [];
    vm.designs = [];
    vm.selectedDesign = null;

    $scope.tab = null;
    $scope.tabSel = TabStateService.sharedTabState;

    vm.init = async function() {
        console.log(`[BrowseDesignsController::init]`);
        await vm.forceFetchDesigns();

        if(vm.selectedView == "launchActivity") {
            vm.setInstanceData();
        }
        if(vm.selectedView == "designs") {
            vm.tab = vm.tabSel.type;
        }
    };

    vm.forceFetchDesigns = async function() {
        vm.userDesigns = await DesignCatalogService.getUserDesigns();
        vm.publicDesigns = await DesignCatalogService.getPublicDesigns();
        vm.designs = await DesignCatalogService.getDesigns();

        $scope.$apply();
    }

    vm.launchDesign = async function(id, title, type) {
        DesignStateService.setInstanceData(id, title, type);
        vm.selectedDesign = await DesignCatalogService.getDesignById(id);
        $scope.selectView("launchActivity");
    };

    vm.retrieveInstanceData = function() {
        const instanceData = DesignStateService.getInstanceData();
        vm.dsgnid = instanceData.id;
        vm.dsgntitle = instanceData.title;
        vm.dsgntype = instanceData.type;
    };

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
    
    vm.getDesign = async function(id) {
        const design = await DesignCatalogService.getDesignById(id);
        ActivityStateService.setDesign(id, design);
    };
    
    vm.goToDesign = function(id, operationType) {
        const designObj = DesignCatalogService.getDesignById(id);

        // Set the state of the design being edited or worked on
        DesignStateService.setDesign(id, designObj);

        // Set the id of the selected design
        vm.selectedDesign = designObj;

        // Should this be?
        // ActivityStateService.setDesign(id, designObj);

        switch(operationType){
            case 'Edit':
                $scope.selectView("newDesignExt");
                break;
            case 'View':
                $scope.selectView("viewDesign");
                break;
            default:
                throw new Error("[BrowseDesignsController::goToDesign] Undefined operation!");
        }
    }

    vm.init();
};