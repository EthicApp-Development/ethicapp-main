/*eslint func-style: ["error", "expression"]*/
export let TabsController = ($scope, $http) => {
    console.log("TabsController initialized");
    var self = $scope;
    self.tabOptions = [];
    self.tabConfig = ["users", "groups"];
    self.selectedTab = "";
    self.archivedTab = false;
    self.stages = [];
    self.iterationNames = [];

    self.shared.resetTab = function () {
        self.selectedTab = "editor";
        if (self.selectedSes != null && self.selectedSes.status > 1) {
            self.selectedTab = "dashboard";
        }
        self.selectedTabConfig = -1;
        if (self.selectedSes.status == 7) {
            self.shared.gotoRubrica();
        }
    };

    self.shared.verifyTabs = function () {
        if (
            (self.selectedSes.type == "R") || (self.selectedSes.type == "T") ||
            (self.selectedSes.type == "J")
        ) {
            self.iterationNames = [];
            self.tabOptions = ["editor", "users", "dashboard"];
            // self.sesStatusses = ["configuration"];
            var pd = {
                sesid: self.selectedSes.id
            };
            console.log("POSTDATA:", pd); //ESTO DEBERIA APARECER
            $http({ url: "get-admin-stages", method: "post", data: pd })
            .then(function (response) {
                self.stages = response.data;
                response.data.forEach(st => {
                    self.iterationNames.push({
                        name: self.flang("stage") + " " + st.number,
                        val: st.id
                    });
                    console.log("iteration NAMES:", self.iterationNames);
                });
            })
            .catch(function (error) {
                console.error("Error fetching admin stages:", error);
            });        
        }
        if (self.selectedSes.status > 1) {
            self.selectedTab = "dashboard";
        }
    };

    self.setTab = function (idx) {
        self.selectedTab = idx;
    };

    self.setTabConfig = function (idx) {
        self.selectedTabConfig = idx;
    };

    self.backToList = function () {
        self.shared.resetSesId();
        self.tabOptions = [];
        self.selectedTab = "";
    };

    self.shared.gotoGrupos = function () {
        self.selectedTab = "groups";
    };

    self.shared.gotoRubrica = function () {
        self.selectedTab = "rubrica";
    };

    self.archTab = function(v){
        self.archivedTab = v;
    };

    self.currentSessions = function(){
        return self.sessions.filter(e => !!e.archived == self.archivedTab);
    };

    self.archiveSes = function (ses, $event) {
        $event.stopPropagation();
        var postdata = { sesid: ses.id, val: true };
        $http({ url: "archive-session", method: "post", data: postdata })
            .then(function () {
                ses.archived = true;
            })
            .catch(function (error) {
                console.error("Error archiving session:", error);
            });
    };
    
    self.restoreSes = function (ses, $event) {
        $event.stopPropagation();
        var postdata = { sesid: ses.id, val: false };
        $http({ url: "archive-session", method: "post", data: postdata })
            .then(function () {
                ses.archived = false;
            })
            .catch(function (error) {
                console.error("Error restoring session:", error);
            });
    };
    
    self.archiveActivity = function (ses, $event) {
        $event.stopPropagation();
        var postdata = { sesid: ses.session, val: true };
        $http({ url: "archive-session", method: "post", data: postdata })
            .then(function () {
                ses.archived = true;
            })
            .catch(function (error) {
                console.error("Error archiving activity:", error);
            });
    };
    
    self.restoreActivity = function (ses, $event) {
        $event.stopPropagation();
        var postdata = { sesid: ses.session, val: false };
        $http({ url: "archive-session", method: "post", data: postdata })
            .then(function () {
                ses.archived = false;
            })
            .catch(function (error) {
                console.error("Error restoring activity:", error);
            });
    };    
};
