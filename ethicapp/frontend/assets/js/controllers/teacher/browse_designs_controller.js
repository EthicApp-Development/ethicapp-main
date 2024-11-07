/*eslint func-style: ["error", "expression"]*/
export let BrowseDesignsController = ($scope, 
    TabStateService, DesignStateService, ActivityStateService, $filter, $http) => {
    var self = $scope;
    self.designs = [];
    self.public = null;
    self.dsgnid = null;
    self.dsgntitle = null;
    self.dsgntype = null;
    self.tab = null;
    self.tabSel = TabStateService.sharedTabState;
    self.designId = DesignStateService.designState;
    self.launchId = ActivityStateService.activityDescriptor;

    self.init = function(){
        if(self.selectedView == "launchActivity") {self.getDesigns(); self.setValues();} //make request when on launchActivity view only
        else if(self.selectedView == "designs") {
            self.tab = self.tabSel.type;
            self.getDesigns();
            self.getPublicDesigns();
        } 
    };

    self.setValues = function(){
        self.dsgnid = self.launchId.id;
        self.dsgntitle = self.launchId.title;
        self.dsgntype = (self.launchId.type == "semantic_differential" ? "T": "R");
    };

    self.designValues = function(id, title, type){
        self.dsgnid = id;
        self.dsgntitle = title;
        self.dsgntype = (type == "semantic_differential" ? "T": "R");
    };

    self.designPublic = async function (dsgnid) {
        var postdata = { dsgnid: dsgnid };
        try {
            await $http({ url: "design-public", method: "post", data: postdata });
        }
        catch (error) {
            console.log(`Failed to change public property of design with id:'${dsgnid}'`);
        }
    };
    
    self.designLock = async function (dsgnid) {
        var postdata = { dsgnid: dsgnid };
        try {
            await $http({ url: "design-lock", method: "post", data: postdata });
        }
        catch (error) {
            console.log(`Failed to lock design with id:'${dsgnid}'`);
        }
    };
    
    self.getDesigns = function () {
        $http.get("get-user-designs")
            .then(function (response) {
                var data = response.data;
                if (data.status === "ok") {
                    self.designs = data.result;
                }
            })
            .catch(function (error) {
                console.error("Error fetching user designs:", error);
            });
    };
    
    self.getPublicDesigns = function () {
        $http.get("get-public-designs")
            .then(function (response) {
                var data = response.data;
                if (data.status === "ok") {
                    self.public = data.result;
                }
            })
            .catch(function (error) {
                console.error("Error fetching public designs:", error);
            });
    };
    
    self.deleteDesign = function (id) {
        // console.log(ID);
        var postdata = { id: id };
        $http.post("delete-design", postdata)
            .then(function (response) {
                var data = response.data;
                if (data.status === "ok") {
                    self.getDesigns(); // Actualizar diseños actuales
                }
            })
            .catch(function (error) {
                console.error("Error deleting design:", error);
            });
    };
    
    self.getDesign = function (id) {
        // console.log(`[getDesign] id: ${id}`);
        $http.post("get-design", { id: id })
            .then(function (response) {
                let data = response.data;
                let design = data.result;

                if (typeof design === "string") {
                    design = JSON.parse(design);
                }
                if (data.status === "ok") {
                    self.changeDesign(data.result);
                }
            })
            .catch(function (error) {
                console.error("Error fetching design:", error);
            });
    };
    
    self.goToDesign = function (id, type) {
        $http.post("get-design", { id: id })
            .then(function (response) {
                var data = response.data;
                let design = data.result;
                if (typeof design == "string") {
                    design = JSON.parse(design);
                }
                if (data.status === "ok") {
                    self.changeDesign(design);
                    if (type === "E") {
                        self.selectView("newDesignExt");
                    } else {
                        self.selectView("viewDesign");
                    }
                    DesignStateService.designState.id = id;
                    self.designId.id = DesignStateService.designState.id;
                }
            })
            .catch(function (error) {
                console.error("Error going to design:", error);
            });
    };
    
    self.launchDesign = function(id, Title, Type){
        self.launchId.id = id;
        self.launchId.title = Title;
        self.launchId.type = Type;
        //set title and type
        self.selectView("launchActivity");
        //console.log(self.launchId);
    };

    self.init();
};