"use strict";

let app = angular.module("Rubrica", []);

app.controller("RubricaController", ["$scope", "$http", function ($scope, $http) {
    let self = $scope;
    self.criterios = [];
    self.reports = [];
    self.iteration = -1;
    self.myUid = -1;

    self.init = () => {
        self.getReports();
        self.getRubrica();
    };

    self.getReports = () => {
        $http({url: "get-ses-info", method: "post"}).success((data) => {
            self.iteration = data.iteration;
            self.myUid = data.uid;
            if(self.iteration == 5) {
                $http({url: "get-active-example-report", method: "post"}).success((data) => {
                    self.reports = [data];
                });
            }
            else if(self.iteration == 6){
                $http({url: "get-paired-report", method: "post"}).success((data) => {
                    self.reports = data;
                });
            }
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