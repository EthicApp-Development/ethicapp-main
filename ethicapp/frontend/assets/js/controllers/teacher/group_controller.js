/*eslint func-style: ["error", "expression"]*/
import { generateTeams, habMetric } from "../../helpers/util.js";

export let GroupController = ($scope, $http, Notification) => {
    var self = $scope;
    self.methods = [];
    self.lastI = -1;
    self.lastJ = -1;
    self.groupMet = "random";

    self.shared.verifyGroups = function () {
        self.methods = [
            klg("random"), klg("performance", "homog"), klg("performance", "heterg"),
            klg("knowledgeType", "homog"), klg("knowledgeType", "heterg")
        ];
        self.groupNum = 3;
        self.groupMet = self.methods[0].key;
        self.groups = [];
        self.groupNames = [];
        if (self.selectedSes != null && self.selectedSes.grouped) {
            self.groupNum = null;
            self.groupMet = null;
            self.generateGroups(true);
        }
    };
    
    let klg = (k1, k2) => {
        return {
            key:  k1 + (k2 == null ? "" : " " + k2),
            name: self.flang(k1) + (k2 == null ? "" : " " + self.flang(k2))
        };
    };

    self.generateGroups = function (key) {
        console.log("Generate groups AdminController");
        if (self.selectedSes.grouped) {
            $http({
                url: "group-proposal-sel", method: "post", data: { sesid: self.selectedSes.id }
            }).success(function (data) {
                self.groups = data;
                self.shared.groups = self.groups;
                //self.groupsProp = angular.copy(self.groups);
                console.log("G", data);
                //self.groupNames = [];
            });
            return;
        }
        if (key == null && (self.groupNum < 1 || self.groupNum > self.users.length)) {
            Notification.error("Error en los parámetros de formación de grupos");
            return;
        }

        var postdata = {
            sesid:  self.selectedSes.id,
            gnum:   self.groupNum,
            method: self.groupMet
        };

        console.log(postdata);

        console.log(self.shared.alumState);
        var users = Object.values(self.users).filter(function (e) {
            return e.role == "A";
        });
        console.log(users);

        if (self.groupMet == "knowledgeType homog" || self.groupMet == "knowledgeType heterg") {
            self.groups = generateTeams(
                users, habMetric, self.groupNum, isDifferent(self.groupMet)
            );
        } else if (self.groupMet == "random") {
            var arr = users.map(function (e) {
                e.rnd = Math.random();
                return e;
            });
            self.groups = generateTeams(arr, function (s) {
                return s.rnd;
            }, self.groupNum, false);
        } 
        if (self.groups != null) {
            self.groupsProp = angular.copy(self.groups);
            self.groupNames = [];
        }

        /*if (urlRequest != "") {
            $http({url: urlRequest, method: "post", data: postdata}).success((data) => {
                self.groups = data;
                self.groupsProp = angular.copy(self.groups);
                console.log(data);
                self.groupNames = [];
                /*data.forEach((d) => {
                 self.groupNames.push(d.map(i => self.users[i.uid].name).join(", "));
                 });*
            });
        }*/
    };

    self.acceptGroups = function () {
        if (self.groupsProp == null) {
            Notification.error("No hay propuesta de grupos para fijar");
            return;
        }
        var postdata = {
            sesid:  self.selectedSes.id,
            groups: JSON.stringify(self.groups.map(function (e) {
                return e.map(function (f) {
                    return f.uid || f.id;
                });
            }))
        };
        console.log(postdata);
        $http({ url: "set-groups", method: "post", data: postdata }).success(function (data) {
            if (data.status == "ok") {
                console.log("Groups accepted");
                self.selectedSes.grouped = true;
                self.shared.verifyGroups();
            }
        });
    };

    self.swapTable = function (i, j) {
        console.log(i, j, self.groups);
        if (self.lastI == -1 && self.lastJ == -1) {
            self.lastI = i;
            self.lastJ = j;
            return;
        }
        if (!(self.lastI == i && self.lastJ == j)) {
            var temp = angular.copy(self.groupsProp[i][j]);
            self.groupsProp[i][j] = angular.copy(self.groupsProp[self.lastI][self.lastJ]);
            self.groupsProp[self.lastI][self.lastJ] = temp;
        }
        self.lastI = -1;
        self.lastJ = -1;
    };
};