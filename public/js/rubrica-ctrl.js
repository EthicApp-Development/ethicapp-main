"use strict";

let app = angular.module("Rubrica", ['btford.socket-io', "timer"]);

app.factory("$socket", ["socketFactory", function (socketFactory) {
    return socketFactory();
}]);

app.controller("RubricaController", ["$scope", "$http", "$socket", function ($scope, $http, $socket) {
    let self = $scope;
    self.criterios = [];
    self.reports = [];
    self.iteration = -1;
    self.myUid = -1;
    self.sesStatusses = ["Lectura", "Individual", "Anónimo", "Grupal", "Reporte", "Rubrica Calibración", "Evaluación de Pares", "Finalizada"];

    self.init = () => {
        self.getReports();
        self.getRubrica();
        $socket.on("stateChange", (data) => {
            console.log("SOCKET.IO", data);
            if(data.ses == self.sesId){
                self.getReports();
            }
        });
    };

    self.getReports = () => {
        $http({url: "get-ses-info", method: "post"}).success((data) => {
            self.iteration = data.iteration;
            self.myUid = data.uid;
            self.sesSTime = (data.stime != null) ? new Date(data.stime) : null;
            if(self.iteration == 5) {
                $http({url: "get-active-example-report", method: "post"}).success((data) => {
                    self.reports = [data];
                    self.fillSelections();
                });
            }
            else if(self.iteration == 6){
                $http({url: "get-paired-report", method: "post"}).success((data) => {
                    self.reports = data;
                    self.fillSelections();
                });
            }
        });
    };

    self.getRubrica = () => {
        $http({url: "get-rubrica", method: "post"}).success((data) => {
            self.criterios = data;
        });
    };

    self.checkCriteria = (report) => {
        return report.select != null && self.criterios.reduce((prev, crit) => (report.select[crit.id] != null) ? prev : false, true);
    };

    self.sendSelection = (report) => {
        if(self.checkCriteria(report)){
            self.criterios.forEach((criterio) => {
                let postdata = {cid: criterio.id, sel: report.select[criterio.id], rid: report.id};
                $http({url: "send-criteria-selection", method:"post", data:postdata}).success((data) => {
                    console.log("ok");
                });
            });
            let postdata = {rid: report.id, text: report.comment};
            $http({url: "send-report-comment", method:"post", data:postdata}).success((data) => {
                console.log("ok");
            });
        }
    };

    self.fillSelections = () => {
        self.reports.forEach((report) => {
            let postdata = {rid: report.id};
            $http({url: "get-criteria-selection", method:"post", data:postdata}).success((data) => {
                report.select = {};
                data.forEach((sel) => {
                    report.select[sel.cid] = sel.selection;
                });
            });
        });
    };

    self.init();

}]);