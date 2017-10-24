"use strict";

let app = angular.module("Rubrica", ["ui.bootstrap", 'btford.socket-io', "timer"]);

app.factory("$socket", ["socketFactory", function (socketFactory) {
    return socketFactory();
}]);

app.controller("RubricaController", ["$scope", "$http", "$socket", "$uibModal", function ($scope, $http, $socket, $uibModal) {
    let self = $scope;
    self.criterios = [];
    self.reports = [];
    self.report = null;
    self.selectedIndex = -1;
    self.iteration = -1;
    self.myUid = -1;
    self.sesStatusses = ["Lectura", "Individual", "Anónimo", "Grupal", "Reporte", ".", "Evaluación de Pares", "Finalizada"];
    self.canAnswer = true;
    self.miters = 0;
    self.commentError = false;

    self.init = () => {
        self.getReports();
        self.getRubrica();
        $socket.on("stateChange", (data) => {
            console.log("SOCKET.IO", data);
            if(data.ses == self.sesId){
                self.getReports();
            }
        });
        $socket.on("reportChange", (data) => {
            console.log("SOCKET.IO", data);
            if(data.ses == self.sesId){
                self.getReports();
            }
        });
        $socket.on("reportReceived", (data) => {
            console.log("SOCKET.IO", data);
            if(data.ses == self.sesId){
                self.openReport(data);
            }
        });
        $http({url: "data/instructions.json", method: "get"}).success((data) => {
            self.instructions = data;
        });
    };

    self.getReports = () => {
        $http({url: "get-ses-info", method: "post"}).success((data) => {
            self.iteration = data.iteration;
            self.sesId = data.id;
            self.myUid = data.uid;
            self.sesSTime = (data.stime != null) ? new Date(data.stime) : null;
            self.sesDescr = (self.iteration < 4) ? (data.descr.split("\n")[0] || data.descr) : (data.descr.split("\n")[1] || data.descr);
            if(data.type == "M"){
                self.sesStatusses = ["Individual", "Grupal", "Reporte", "Evaluación de Pares", "Finalizada"];
                self.miters = 1;
            }
            if(self.iteration <= 5) {
                $http({url: "get-active-example-report", method: "post"}).success((data) => {
                    self.reports = [data];
                    self.report = data;
                    self.selectedIndex = 0;
                    self.fillSelections();
                });
            }
            else if(self.iteration == 6){
                $http({url: "get-paired-report", method: "post"}).success((data) => {
                    self.reports = data;
                    self.report = data[0];
                    self.selectedIndex = 0;
                    self.fillSelections();
                });
            }
            else if(self.iteration == 7){
                $http({url: "get-my-report", method: "post"}).success((data) => {
                    console.log(data);
                    self.reports = [data];
                    self.report = data;
                    self.selectedIndex = 0;
                    self.getEvals(data.id);
                });
            }
        });
    };

    self.selectReport = (idx) => {
        self.selectedIndex = idx;
        self.report = self.reports[idx];
    };

    self.getRubrica = () => {
        $http({url: "get-rubrica", method: "post"}).success((data) => {
            self.criterios = data;
        });
    };

    self.checkCriteria = (report) => {
        return report!=null && report.id!=null && report.select != null && self.criterios.reduce((prev, crit) => (report.select[crit.id] != null) ? prev : false, true);
    };

    self.sendSelection = (report) => {
        if(report.comment == "" || report.comment == null || report.comment.length < 5){
            self.commentError = true;
            return;
        }
        if(self.checkCriteria(report)){
            self.commentError = false;
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
            report.status = "SENT";
            if(self.iteration == 5){
                self.canAnswer = false;
                let postdata = {rid: report.id};
                $http({url: "get-criteria-answer", method:"post", data:postdata}).success((data) => {
                    let i = self.reports.findIndex(e => e.id == report.id);
                    console.log(i);
                    self.reports[i].truev = {};
                    data.forEach((sel) => {
                        self.reports[i].truev[sel.cid] = sel.selection;
                    });
                });
            }
        }
    };

    self.fillSelections = () => {
        self.reports.forEach((report) => {
            let postdata = {rid: report.id};
            self.canAnswer = true;
            $http({url: "get-criteria-selection", method:"post", data:postdata}).success((data) => {
                report.select = {};
                data.forEach((sel) => {
                    report.select[sel.cid] = sel.selection;
                    if(self.iteration == 5)
                        self.canAnswer = false;
                });
            });
            $http({url: "get-report-comment", method:"post", data:postdata}).success((data) => {
                report.comment = data.comment;
            });
        });
    };

    self.getEvals = (rid) => {
        let postdata = {repid: rid};
        $http({url: "get-report-result", method: "post", data: postdata}).success((data) => {
            self.answers = data;
        });
        $http.post("get-criteria-selection-by-report", postdata).success((data) => {
            self.answersRubrica = {};
            data.forEach((row) => {
                if(self.answersRubrica[row.uid] == null)
                    self.answersRubrica[row.uid] = {};
                self.answersRubrica[row.uid][row.cid] = row.selection;
            });
        });
    };

    self.getAvg = () => {
        if(self.answers == null || self.answers.length == 0) return;
        let s = self.answers.reduce((v,e) => v + e.val, 0);
        return s/self.answers.length;
    };

    self.openReport = (data) => {
        let postdata = {rid: data.rid};
        $http({url: "get-report", method:"post", data: postdata}).success((data) => {
            $uibModal.open({
                templateUrl: "templ/report-details.html",
                controller: "ReportModalController",
                controllerAs: "vm",
                scope: self,
                resolve: {
                    report: function(){
                        return data;
                    },
                }
            });
        });
    };

    self.selectCriterio = (cid, val) => {
        if(self.canAnswer) {
            self.report.select[cid] = val;
        }
    };

    self.init();

}]);

app.controller("ReportModalController", ["$scope", "$uibModalInstance", "report", function ($scope, $uibModalInstance, report) {
    var vm = this;
    vm.report = report;

    vm.cancel = () => {
        $uibModalInstance.dismiss('cancel');
    };

}]);