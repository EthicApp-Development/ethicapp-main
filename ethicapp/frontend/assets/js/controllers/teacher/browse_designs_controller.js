/*eslint func-style: ["error", "expression"]*/
export let BrowseDesignsController = ($scope, 
    TabStateService, DesignStateService, ActivityStateService, $filter, $http) => {
    var self = $scope;
    self.designs = [];
    self.publicDesigns = null;
    self.designId = null;
    self.designTitle = null;
    self.designType = null;
    self.tab = null;

    self.init = function(){
        // This controller is used in two different contexts,
        // that is, when using the "Launch Activity" feature,
        // and when browsing designs.
        if(self.selectedView == "launchActivity") {
            // Only designs owned by the current user are
            // available
            self.getUserDesigns(); 
            self.initValues();
        }
        else if(self.selectedView == "designs") {
            self.tab = TabStateService.sharedTabState.type;
            // Designs by the current user, as well as
            // publicly shared designs must be available
            self.getUserDesigns();
            self.getPublicDesigns();
        }
    };

    self.initValues = function() {
        self.designId = ActivityStateService.activityState.id;
        self.designTitle = ActivityStateService.activityState.title;
        self.designType = ActivityStateService.activityState.type == "semantic_differential" ? 
            "T" : "R";
    };

    self.setActivityDesignValues = function(id, title, type) {
        ActivityStateService.activityState.designId = id;
        ActivityStateService.activityState.title = title;
        ActivityStateService.activityState.type = type == "semantic_differential" ? "T" : "R";
    };

    self.designPublic = function (id) {
        // Make design with 'id' publicly shared
        let postdata = { designId: id };
        $http({ 
            url:    "design-public", 
            method: "post", 
            data:   postdata }).success(function () { });
    };

    self.designLock = function (id) {
        // Lock the given design
        let postdata = { designId: id };
        $http({ 
            url:    "design-lock", 
            method: "post", 
            data:   postdata 
        }).success(function () {
        
        });
    };

    self.getUserDesigns = function(){
        // Get all designs by the current user
        $http.get("get-user-designs").success(function (data) {
            if (data.status == "ok") {
                self.designs = data.result;
            }
        });
    };

    self.getPublicDesigns = function(){
        // Get all public designs
        $http.get("get-public-designs").success(function (data) {
            if (data.status == "ok") {
                self.publicDesigns = data.result;
            }
        });
    };

    self.deleteDesign = function (id) {
        var postdata = { "id": id };
        $http.post("delete-design", postdata).success(function (data) {
            if (data.status == "ok") {
                // Update available designs after delete 
                self.getUserDesigns();
            }
        });
    };
    
    self.openDesignForEditing = (id) => {
        $http.post("get-design", id).success(function (data) {
            if (data.status == "ok") {
                self.changeDesign(data.result);
                self.selectView("editDesign");
                DesignStateService.designState.id = id;
            }
        });
    };

    self.openDesignForViewing = (id) => {
        $http.post("get-design", id).success(function (data) {
            if (data.status == "ok") {
                self.changeDesign(data.result);
                self.selectView("viewDesign");
                DesignStateService.designState.id = id;
            }
        });
    };

    self.launchDesign = function(id, title, type) {
        // Sets the design that is to be launched
        ActivityStateService.activityState.designId = id;
        ActivityStateService.activityState.title = title;
        ActivityStateService.activityState.type = type;
        
        //set title and type
        self.selectView("launchActivity");
    };

    self.init();
};