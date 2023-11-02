import * as dtrModule from "../../libs/designs/design_type_registry.js";

/*eslint func-style: ["error", "expression"]*/
export let BrowseDesignsController = ($scope, 
    TabStateService, DesignsService, ActivitiesService, $filter, $http) => {
    let self = $scope;

    self.init = () => {
        self.userDesigns = DesignsService.userDesigns;
        self.publicDesigns = DesignsService.publicDesigns;
        self.designId = null;
        self.designTitle = null;
        self.designType = null;
        self.tab = null;

        initUserDesignsUpdateHandler();
        initPublicDesignsUpdateHandler();

        // This controller is used in two different contexts,
        // that is, when using the "Launch Activity" feature,
        // and when browsing designs.
        DesignsService.loadUserDesigns().then(() => {
            if(self.selectedView == "launchActivity") {
                if (DesignsService.currentWorkingDesign == null) {
                    console.log(
                        "[BrowseDesignsController] Warning: current working design is null");
                    throw new Error("Null working design object!");
                }
    
                if (Object.keys(DesignsService.currentWorkingDesign).length === 0) {
                    console.log(
                        "[BrowseDesignsController] Warning: current working design is empty");
                    throw new Error("Empty working design object!");
                }
    
                // Only designs owned by the current user are
                // available
                self.initValues();
            }
            else if(self.selectedView == "designs") {
                self.tab = TabStateService.sharedTabState.type;

                // Designs by the current user, as well as
                // publicly shared designs must be available
                DesignsService.loadPublicDesigns();
            }    
        });
    };

    let initUserDesignsUpdateHandler = () => {
        $scope.$on("DesignsService_userDesignsUpdated", (event, data) => {
            self.userDesigns = DesignsService.userDesigns;
        });
    };

    let initPublicDesignsUpdateHandler = () => {
        $scope.$on("DesignsService_publicDesignsUpdated", (event, data) => {
            self.publicDesigns = DesignsService.publicDesigns;
        });
    };

    self.initValues = function() {
        self.designId = ActivitiesService.currentActivityState.id;
        self.designTitle = ActivitiesService.currentActivityState.title;
        self.designType = ActivitiesService.currentActivityState.type; // Watch out!
    };

    self.setSelectedDesign = function(designId) {
        // Set the current working design
        DesignsService.loadUserDesignById(designId).then(() => {
            ActivitiesService.currentActivityState.designId = designId;
            ActivitiesService.currentActivityState.title = DesignsService
                .workingDesign
                .metainfo
                .title;
            ActivitiesService.currentActivityState.type = DesignsService.
                resolveDesignTypeCharacter(DesignsService.workingDesign);
    
            self.designId = ActivitiesService.currentActivityState.designId;
            self.title = ActivitiesService.currentActivityState.title;
            self.type = ActivitiesService.currentActivityState.type;    
        });
    };

    self.deleteDesign = (id) => {
        DesignsService.deleteDesign(id);
    };

    self.togglePublic = (id) => {
        DesignsService.togglePublishDesign(id);
    };

    self.openDesignForEditing = (id) => {
        DesignsService.loadUserDesignById(id)
            .then(() => {
                self.selectView("editDesign");
            });
        // TODO: implement catch behavior
    };

    self.openDesignForViewing = (id) => {
        DesignsService.loadUserDesignById(id)
            .then(() => {
                self.selectView("viewDesign");
            });
        // TODO: implement catch behavior
    };

    self.launchActivityWithDesign = function(designId) {
        // Set the current working design
        DesignsService.loadUserDesignById(designId).then(() => {
            // Sets the design that is to be launched
            ActivitiesService.currentActivityState.designId = designId;
            ActivitiesService.currentActivityState.title = DesignsService
                .workingDesign
                .metainfo
                .title;
            ActivitiesService.currentActivityState.type = DesignsService.
                resolveDesignTypeCharacter(DesignsService.workingDesign);
            
            // Launch the activity based on the current working design
            self.selectView("launchActivity");
        });
    };

    self.init();
};