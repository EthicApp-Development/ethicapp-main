/*eslint func-style: ["error", "expression"]*/
export let RubricController = ($scope, $http) => {
    var self = $scope;
    self.criterios = [];
    self.newCriterio = {};
    self.editable = false;
    self.exampleReports = [];
    self.newExampleReport = "";
    self.pairNum = 3;
    self.rid = -1;

    self.addCriterio = function () {
        self.criterios.push({});
    };

    self.removeCriterio = function (idx) {
        self.criterios.splice(idx, 1);
    };

    self.checkSum = function () {
        return self.criterios.reduce(function (e, p) {
            return e + p.pond;
        }, 0) == 100;
    };

    self.shared.getRubrica = function () {
        self.criterios = [];
        self.newCriterio = {};
        self.editable = false;
        var postdata = { sesid: self.selectedSes.id };
        $http({
            url: "get-admin-rubrica", method: "post", data: postdata
        }).success(function (data) {
            if (data.length == 0) {
                self.editable = true;
            } else {
                self.criterios = data;
                self.rid = data[0].rid;
            }
        });
    };

    self.startEditing = function () {
        self.editable = true;
    };

    self.saveRubrica = function () {
        if (self.rid != -1) {
            self.saveEditRubrica();
            return;
        }
        var postdata = { sesid: self.selectedSes.id };
        $http({ url: "send-rubrica", method: "post", data: postdata }).success(function (data) {
            if (data.status == "ok") {
                var rid = data.id;
                self.criterios.forEach(function (criterio) {
                    var postdata = angular.copy(criterio);
                    postdata.rid = rid;
                    $http({
                        url: "send-criteria", method: "post", data: postdata
                    }).success(function (data) {
                        if (data.status == "ok") console.log("Ok");
                    });
                });
                self.editable = false;
            }
        });
    };

    self.saveEditRubrica = function () {
        if (self.rid == -1) return;
        var postdata = { rid: self.rid };
        $http({ url: "delete-criterias", method: "post", data: postdata }).success(function (data) {
            if (data.status == "ok") {
                var rid = self.rid;
                self.criterios.forEach(function (criterio) {
                    var postdata = angular.copy(criterio);
                    postdata.rid = rid;
                    $http({
                        url: "send-criteria", method: "post", data: postdata 
                    }).success(function (data) {
                        if (data.status == "ok") console.log("Ok");
                    });
                });
                self.editable = false;
            }
        });
    };

    self.shared.getExampleReports = function () {
        self.exampleReports = [];
        var postdata = { sesid: self.selectedSes.id };
        $http({
            url: "get-example-reports", method: "post", data: postdata
        }).success(function (data) {
            self.exampleReports = data;
        });
    };

    self.sendExampleReport = function () {
        var postdata = {
            sesid:   self.selectedSes.id,
            content: self.newExampleReport.text,
            title:   self.newExampleReport.title
        };
        $http({
            url: "send-example-report", method: "post", data: postdata
        }).success(function () {
            self.newExampleReport = "";
            self.shared.getExampleReports();
        });
    };

    self.setActiveExampleReport = function (rep) {
        var postdata = { sesid: self.selectedSes.id, rid: rep.id };
        $http({
            url: "set-active-example-report", method: "post", data: postdata
        }).success(function (data) {
            if (data.status == "ok") {
                self.exampleReports.forEach(function (r) {
                    r.active = false;
                });
                rep.active = true;
            }
        });
    };

    self.goToReport = function (rep) {
        self.setActiveExampleReport(rep);
        window.location.href = "to-rubrica?sesid=" + self.selectedSes.id;
    };

    self.pairAssign = function () {
        var postdata = { sesid: self.selectedSes.id, rnum: +self.pairNum || 3 };
        $http({ url: "assign-pairs", method: "post", data: postdata }).success(function (data) {
            if (data.status == "ok") {
                // self.shared.updateSesData();
                self.selectedSes.paired = self.pairNum;
                self.errPairMsg = "";
            } else {
                self.errPairMsg = data.msg;
            }
        });
    };

    self.shared.obtainCriterios = function () {
        return self.criterios;
    };

    self.shared.isRubricaSet = function () {
        return !self.editable;
    };
};