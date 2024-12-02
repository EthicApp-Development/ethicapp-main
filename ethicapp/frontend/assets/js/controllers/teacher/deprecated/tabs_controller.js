/*eslint func-style: ["error", "expression"]*/
export function TabsController($scope, $http, ActivityStateService) {
    var self = $scope;
    self.tabOptions = [];
    self.tabConfig = ["users", "groups"];
    self.selectedTab = "";
    self.archivedTab = false;
    self.stages = [];
    self.iterationNames = [];

    self.shared.resetTab = function () {

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
