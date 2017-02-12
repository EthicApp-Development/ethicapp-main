"use strict";

let app = angular.module("Rubrica", []);

app.controller("RubricaController", ["$scope", "$http", function ($scope, $http) {
    let self = $scope;
    self.criterios = [];
    self.report = {};

    self.init = () => {
        self.getReport();
        self.getRubrica();
    };

    self.getReport = () => {
        let postdata = {rid: 1};
        $http({url: "get-active-example-report", method: "post", data: postdata}).success((data) => {
            self.report = data;
        });
    };

    self.getRubrica = () => {
        $http({url: "get-rubrica", method: "post"}).success((data) => {
            self.criterios = data;
        });
    };

    self.checkCriteria = () => {
        return self.criterios.reduce((prev, crit) => (crit.select != null) ? prev : false, true);
    };

    self.sendSelection = () => {
        if(self.checkCriteria()){
            self.criterios.forEach((criterio) => {
                let postdata = {cid: criterio.id, sel: criterio.select, rid: self.report.id};
                $http({url: "send-criteria-selection", method:"post", data:postdata}).success((data) => {
                    console.log("ok");
                });
            });
        }
    };

    self.init();

}]);