/*eslint func-style: ["error", "expression"]*/
export let TabsController = ($scope, $http, Notification) => {
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
            $http({ url: "get-admin-stages", method: "post", data: pd }).success(function (data) {
                self.stages = data;
                data.forEach(st => {
                    self.iterationNames.push({
                        name: self.flang("stage") + " " + st.number, val: st.id
                    });
                    console.log("iteration NAMES:",self.iterationNames);
                });
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
};
