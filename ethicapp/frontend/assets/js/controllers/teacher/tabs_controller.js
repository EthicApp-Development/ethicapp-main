/*eslint func-style: ["error", "expression"]*/
export let TabsController = ($scope, $http, ActivityStateService) => {
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
        // Check session type to determine available tabs and stages
        if (
            self.selectedSes.type === "R" || 
            self.selectedSes.type === "T" || 
            self.selectedSes.type === "J"
        ) {
            console.log(`[TabsController::verifyTabs] begin`);
            
            self.iterationNames = []; // Initialize array for iteration names
            self.tabOptions = ["editor", "users", "dashboard"]; // Set tab options based on session type
    
            // Prepare the request payload
            const postData = { sesid: self.selectedSes.id };
            console.log(`[TabsController::verifyTabs] postData: ${JSON.stringify(postData)}`);
    
            // Make HTTP request to get admin stages and process response
            $http({
                url: "get-admin-stages",
                method: "post",
                data: postData
            })
            .then(function (response) {
                console.log(`[TabsController::verifyTabs] response: ${JSON.stringify(response)}`);
    
                // Assign received stages to `self.stages`
                self.stages = response.data;
    
                // Populate `iterationNames` with stage information
                response.data.forEach(stage => {
                    self.iterationNames.push({
                        name: `${self.flang("stage")} ${stage.number}`,
                        val: stage.id
                    });
                    console.log(`[TabsController::verifyTabs] iterationNames: ${JSON.stringify(self.iterationNames)}`);
                });
            })
            .catch(function (error) {
                // Log any errors encountered during the HTTP request
                console.error("Error fetching admin stages:", error);
            });
        }
    
        // Set the default tab to "dashboard" if the session status is above 1
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
