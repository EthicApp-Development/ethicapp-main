/*eslint func-style: ["error", "expression"]*/
export let BrowseDesignsController = ($scope, $filter, $http) => {
    var self = $scope;
    self.designs = [];
    self.public = null;
    self.dsgnid = null;
    self.dsgntitle = null;
    self.dsgntype = null;
    self.tab = null;

    self.init = function(){
        if(self.selectedView == "launchActivity") {self.getDesigns(); self.setValues();} //make request when on launchActivity view only
        else if(self.selectedView == "designs") {
            self.tab = tabSel.type;
            self.getDesigns();
            self.getPublicDesigns();
        } 
    };

    self.setValues = function(){
        self.dsgnid = launchId.id;
        self.dsgntitle = launchId.title;
        self.dsgntype = (launchId.type == "semantic_differential" ? "T": "R");
    };

    self.designValues = function(id, title, type){
        self.dsgnid = id;
        self.dsgntitle = title;
        self.dsgntype = (type == "semantic_differential" ? "T": "R");
    };

    self.designPublic = function (dsgnid) {
        var postdata = { dsgnid: dsgnid };
        $http({ url: "design-public", method: "post", data: postdata }).success(function () {

        });
    };

    self.designLock = function (dsgnid) {
        var postdata = { dsgnid: dsgnid };
        $http({ url: "design-lock", method: "post", data: postdata }).success(function () {
  
        });
    };

    self.getDesigns = function(){
        $http.get("get-user-designs").success(function (data) {
            
            if (data.status == "ok") {
                self.designs = data.result;
            }
            
        });
    };

    self.getPublicDesigns = function(){
        $http.get("get-public-designs").success(function (data) {
            
            if (data.status == "ok") {
                self.public = data.result;
            }
            
        });
    };

    self.deleteDesign = function (ID) {
        var postdata = {"id": ID};
        $http.post("delete-design", postdata).success(function (data) {
            
            if (data.status == "ok") {
                self.getDesigns(); //get current Designs 
            }
            
        });

    };


    self.getDesign = function (ID) {
        $http.post("get-design", ID).success(function (data) {
            if (data.status == "ok") {
                self.changeDesign(data.result);

            }
        });
    };

    self.goToDesign = function(ID, type){
        $http.post("get-design", ID).success(function (data) {
            if (data.status == "ok") {
                self.changeDesign(data.result);
                if(type=="E") self.selectView("newDesignExt");
                else self.selectView("viewDesign");
                designId.id = ID;

            }
        });        
    };

    self.launchDesign = function(ID, Title, Type){
        launchId.id = ID;
        launchId.title = Title;
        launchId.type = Type;
        //set title and type
        self.selectView("launchActivity");
        console.log(launchId);
    };

    self.init();
};