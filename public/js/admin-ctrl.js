"use strict";

let app = angular.module("Admin", ["ui.bootstrap", "ui.multiselect", "nvd3"]);

app.controller("AdminController", function ($scope, $http, $uibModal) {
    let self = $scope;
    self.shared = {};
    self.sessions = [];
    self.selectedSes = null;
    self.documents = [];
    self.questions = [];
    self.newUsers = [];
    self.users = {};
    self.selectedIndex = -1;
    self.sesStatusses = ["No Publicada", "Lectura", "Personal", "Anónimo", "Grupal", "Finalizada"];
    self.iterationNames = [{name: "Individual", val: 1}, {name: "Grupal anónimo", val: 2}, {name: "Grupal", val: 3}];

    self.init = () => {
        self.shared.updateSesData();
    };

    self.selectSession = (idx) => {
        self.selectedIndex = idx;
        self.selectedSes = self.sessions[idx];
        self.requestDocuments();
        self.requestQuestions();
        self.getNewUsers();
        self.getMembers();
        self.shared.verifyGroups();
        self.shared.resetGraphs();
        self.shared.verifyTabs();
        self.shared.resetTab();
    };

    self.shared.updateSesData = () => {
        $http({url: "get-session-list", method: "post"}).success((data) => {
            console.log("Session data updated");
            self.sessions = data;
            if(self.selectedIndex != -1)
                self.selectSession(self.selectedIndex);
        });
    };

    self.requestDocuments = () => {
        let postdata = {sesid: self.selectedSes.id};
        $http({url: "documents-session", method: "post", data: postdata}).success((data) => {
            self.documents = data;
        });
    };

    self.requestQuestions = () => {
        let postdata = {sesid: self.selectedSes.id};
        $http({url: "questions-session", method: "post", data: postdata}).success((data) => {
            self.questions = data;
        });
    };

    self.getNewUsers = () => {
        let postdata = {sesid: self.selectedSes.id};
        $http({url: "get-new-users", method: "post", data: postdata}).success((data) => {
            self.newUsers = data;
        });
    };

    self.getMembers = () => {
        let postdata = {sesid: self.selectedSes.id};
        $http({url: "get-ses-users", method: "post", data: postdata}).success((data) => {
            data.forEach((d) => {
                self.users[d.id] = d;
            });
        });
    };

    self.openNewSes = () => {
        $uibModal.open({
            templateUrl: "templ/new-ses.html"
        });
    };

    self.init();
});


app.controller("TabsController", function ($scope, $http) {
    let self = $scope;
    self.tabOptions = ["Descripción", "Usuarios", "Dashboard", "Grupos"];
    self.selectedTab = 0;

    self.shared.resetTab = () => {
        self.selectedTab = 0;
    };

    self.shared.verifyTabs = () => {
        if (self.selectedSes.type == "L") {
            self.tabOptions = ["Configuración", "Usuarios", "Dashboard", "Grupos", "Rúbrica", "Dashboard Rúbrica"];
            self.sesStatusses = ["Configuración", "Lectura", "Individual", "Anónimo", "Grupal", "Reporte", "Rubrica Calibración", "Evaluación de Pares", "Finalizada"];
            self.shared.getRubrica();
            self.shared.getExampleReports();
            self.shared.getReports();
        }
        else {
            self.tabOptions = ["Configuración", "Usuarios", "Dashboard", "Grupos"];
            self.sesStatusses = ["Configuración", "Individual", "Anónimo", "Grupal", "Finalizada"];
        }
    };

    self.setTab = (idx) => {
        self.selectedTab = idx;
    };

});

app.controller("SesEditorController", function ($scope, $http) {
    let self = $scope;

    self.updateSession = () => {
        if (self.selectedSes.name.length < 3 || self.selectedSes.descr.length < 5) return;
        let postdata = {name: self.selectedSes.name, descr: self.selectedSes.descr, id: self.selectedSes.id};
        $http({url: "update-session", method: "post", data: postdata}).success((data) => {
            console.log("Session updated");
        });
    };

    self.shared.changeState = () => {
        if (self.selectedSes.status >= self.sesStatusses.length) return;
        if (self.selectedSes.status >= 3 && !self.selectedSes.grouped) return;
        if (self.selectedSes.status >= 7 && !self.selectedSes.paired) return;
        let postdata = {sesid: self.selectedSes.id};
        $http({url: "change-state-session", method: "post", data: postdata}).success((data) => {
            self.shared.updateSesData();
        });
    }

});


app.controller("NewUsersController", function ($scope, $http) {
    let self = $scope;
    let newMembs = [];

    self.addToSession = () => {
        if (self.newMembs.length == 0) return;
        let postdata = {
            users: self.newMembs.map(e => e.id),
            sesid: self.selectedSes.id
        };
        $http({url: "add-ses-users", method: "post", data: postdata}).success((data) => {
            if (data.status == "ok") {
                self.getNewUsers();
                self.getMembers();
            }
        });
    };

});

app.controller("QuestionsController", function ($scope, $http) {
    let self = $scope;

    self.newQuestion = {
        content: "",
        alternatives: ["", "", "", "", ""],
        comment: "",
        other: "",
        answer: -1
    };

    self.selectAnswer = (i) => {
        self.newQuestion.answer = i;
    };

    self.addQuestion = () => {
        if (self.newQuestion.answer == -1) return;
        let postdata = {
            content: self.newQuestion.content,
            options: self.newQuestion.alternatives.join("\n"),
            comment: self.newQuestion.comment,
            answer: self.newQuestion.answer,
            sesid: self.selectedSes.id,
            other: self.newQuestion.other
        };
        $http({url: "add-question", method: "post", data: postdata}).success((data) => {
            if (data.status == "ok")
                self.requestQuestions()
        });
        self.newQuestion = {
            content: "",
            alternatives: ["", "", "", "", ""],
            comment: "",
            other: "",
            answer: -1
        };
    }

});

app.controller("DashboardController", function ($scope, $http) {
    let self = $scope;
    self.iterationIndicator = 1;

    self.shared.resetGraphs = () => {
        self.alumState = null;
        self.barOpts = {
            chart: {
                type: 'multiBarChart',
                height: 320,
                x: d => d.label,
                y: d => d.value,
                showControls: false,
                showValues: false,
                duration: 500,
                xAxis: {
                    showMaxMin: false
                },
                yAxis: {
                    axisLabel: 'Cantidad Alumnos'
                }
            }
        };
        self.barData = [{key: "Alumnos", color: "#1f77b4", values: []}];
    };

    self.updateState = () => {
        let postdata = {sesid: self.selectedSes.id, iteration: self.iterationIndicator};
        if (self.selectedSes.type == "S") {
            $http({url: "get-alum-full-state-sel", method: "post", data: postdata}).success((data) => {
                self.alumState = {};
                data.forEach((d) => {
                    if (self.alumState[d.uid] == null) {
                        self.alumState[d.uid] = {};
                        self.alumState[d.uid][d.qid] = d.correct;
                    }
                    else {
                        self.alumState[d.uid][d.qid] = d.correct;
                    }
                });
            });
            $http({url: "get-alum-state-sel", method: "post", data: postdata}).success((data) => {
                let dataNorm = data.map(d => {
                    d.score /= self.questions.length;
                    return d;
                });
                self.buildBarData(dataNorm);
            });
        }
        else if (self.selectedSes.type == "L") {
            $http({url: "get-alum-state-lect", method: "post", data: postdata}).success((data) => {
                self.alumState = data;
                self.buildBarData(data);
            });
            $http({url: "get-ideas-progress", method: "post", data: postdata}).success((data) => {
                self.numComplete = 0;
                self.numProgress = 0;
                self.numUsers = Object.keys(self.users).length - 1;
                let n = self.documents.length * 3;
                if(n!=0) {
                    data.forEach((d) => {
                        if(d.count >= n)
                            self.numComplete += 1;
                        self.numProgress += d.count/n;
                    });
                    self.numProgress *= 100/self.numUsers;
                }
            });
        }
    };

    self.buildBarData = (data) => {
        const N = 5;
        self.barData[0].values = [];
        for (let i = 0; i < N; i++) {
            let lbl = (i * 20) + "% - " + ((i + 1) * 20) + "%";
            self.barData[0].values.push({label: lbl, value: 0});
        }
        data.forEach((d) => {
            let rank = Math.min(Math.floor(N * d.score), N - 1);
            self.barData[0].values[rank].value += 1;
        });
    };

});

app.controller("GroupController", function ($scope, $http) {
    let self = $scope;
    self.methods = ["Aleatorio", "Rendimiento Homogeneo", "Rendimiento Heterogeneo", "Tipo Aprendizaje Homogeneo", "Tipo Aprendizaje Heterogeoneo"];
    self.lastI = -1;
    self.lastJ = -1;

    self.shared.verifyGroups = () => {
        self.groupNum = 3;
        self.groupMet = self.methods[0];
        self.groups = [];
        self.groupNames = [];
        if (self.selectedSes != null && self.selectedSes.grouped) {
            self.groupNum = null;
            self.groupMet = null;
            self.generateGroups(true);
        }
    };

    self.generateGroups = (key) => {
        if (key == null && (self.groupNum < 1 || self.groupNum > self.users.length)) return;

        let postdata = {
            sesid: self.selectedSes.id,
            gnum: self.groupNum,
            method: self.groupMet
        };

        let urlRequest = "";
        if (self.selectedSes.type == "S")
            urlRequest = "group-proposal-sel";
        else if (self.selectedSes.type == "L")
            urlRequest = "group-proposal-lect";

        if (self.groupMet == "Tipo Aprendizaje Homogeneo" || self.groupMet == "Tipo Aprendizaje Heterogeoneo")
            urlRequest = "group-proposal-hab";
        else if (self.groupMet == "Aleatorio")
            urlRequest = "group-proposal-rand";

        if (urlRequest != "") {
            $http({url: urlRequest, method: "post", data: postdata}).success((data) => {
                self.groups = data;
                self.groupsProp = angular.copy(self.groups);
                console.log(data);
                self.groupNames = [];
                /*data.forEach((d) => {
                 self.groupNames.push(d.map(i => self.users[i.uid].name).join(", "));
                 });*/
            });
        }
    };

    self.acceptGroups = () => {
        if (self.groupsProp == null) return;
        let postdata = {
            sesid: self.selectedSes.id,
            groups: JSON.stringify(self.groupsProp.map(e => e.map(f => f.uid)))
        };
        console.log(postdata);
        $http({url: "set-groups", method: "post", data: postdata}).success((data) => {
            if (data.status == "ok") {
                console.log("Groups accepted");
                self.selectedSes.grouped = true;
                self.shared.verifyGroups();
            }
        });
    };

    self.swapTable = (i, j) => {
        console.log(i, j, self.groups);
        if (self.lastI == -1 && self.lastJ == -1) {
            self.lastI = i;
            self.lastJ = j;
            return;
        }
        if (!(self.lastI == i && self.lastJ == j)) {
            let temp = angular.copy(self.groupsProp[i][j]);
            self.groupsProp[i][j] = angular.copy(self.groupsProp[self.lastI][self.lastJ]);
            self.groupsProp[self.lastI][self.lastJ] = temp;
        }
        self.lastI = -1;
        self.lastJ = -1;
    };

});

app.controller("RubricaController", function ($scope, $http) {
    let self = $scope;
    self.criterios = [];
    self.newCriterio = {};
    self.editable = false;
    self.exampleReports = [];
    self.newExampleReport = "";

    self.addCriterio = () => {
        self.criterios.push(self.newCriterio);
        self.newCriterio = {};
    };

    self.removeCriterio = (idx) => {
        self.criterios.splice(idx, 1);
    };

    self.checkSum = () => {
        return self.criterios.reduce((e, p) => e + p.pond, 0) == 100;
    };

    self.shared.getRubrica = () => {
        self.criterios = [];
        self.newCriterio = {};
        self.editable = false;
        let postdata = {sesid: self.selectedSes.id};
        $http({url: "get-admin-rubrica", method: "post", data: postdata}).success((data) => {
            if (data.length == 0) {
                self.editable = true;
            }
            else {
                self.criterios = data;
            }
        });
    };

    self.saveRubrica = () => {
        let postdata = {sesid: self.selectedSes.id};
        $http({url: "send-rubrica", method: "post", data: postdata}).success((data) => {
            if (data.status == "ok") {
                let rid = data.id;
                self.criterios.forEach((criterio) => {
                    let postdata = angular.copy(criterio);
                    postdata.rid = rid;
                    $http({url: "send-criteria", method: "post", data: postdata}).success((data) => {
                        if (data.status == "ok") console.log("Ok");
                    });
                });
                self.editable = false;
            }
        });
    };

    self.shared.getExampleReports = () => {
        self.exampleReports = [];
        let postdata = {sesid: self.selectedSes.id};
        $http({url: "get-example-reports", method: "post", data: postdata}).success((data) => {
            self.exampleReports = data;
        });
    };

    self.sendExampleReport = () => {
        let postdata = {sesid: self.selectedSes.id, content: self.newExampleReport};
        $http({url: "send-example-report", method: "post", data: postdata}).success((data) => {
            self.newExampleReport = "";
            self.shared.getExampleReports();
        });
    };

    self.setActiveExampleReport = (rep) => {
        let postdata = {sesid: self.selectedSes.id, rid: rep.id};
        $http({url: "set-active-example-report", method: "post", data: postdata}).success((data) => {
            if (data.status == 'ok') {
                self.exampleReports.forEach(r => {
                    r.active = false;
                });
                rep.active = true;
            }
        });
    };

    self.pairAssign = () => {
        let postdata = {sesid: self.selectedSes.id, rnum: 2};
        $http({url: "assign-pairs", method: "post", data: postdata}).success((data) => {
            if (data.status == "ok") {
                self.selectedSes.paired = true;
            }
        });
    };

});

app.controller("DashboardRubricaController", function($scope, $http){
    let self = $scope;
    self.reports = [];
    self.result = [];
    self.selectedReport = null;

    self.shared.resetRubricaGraphs = () => {
        self.alumState = null;
        self.barOpts = {
            chart: {
                type: 'multiBarChart',
                height: 320,
                x: d => d.label,
                y: d => d.value,
                showControls: false,
                showValues: false,
                duration: 500,
                xAxis: {
                    showMaxMin: false
                },
                yAxis: {
                    axisLabel: 'Cantidad Alumnos'
                }
            }
        };
        self.barData = [{key: "Alumnos", color: "#1f77b4", values: []}];
    };

    self.showName = (report) => {
        if(report.example)
            return report.id + " - Texto ejemplo";
        else
            return report.id + " - Reporte de Alumno " + self.users[report.uid].name;
    };

    self.shared.getReports = () => {
        let postdata = {sesid: self.selectedSes.id};
        $http({url: "get-report-list", method: "post", data: postdata}).success((data) => {
            self.reports = data;
        });
    };

    self.getReportResult = () => {
        let postdata = {repid: self.selectedReport.id};
        $http({url: "get-report-result", method: "post", data: postdata}).success((data) => {
            self.result = data;
        });
    };

    self.getAllReportResult = () => {
        let postdata = {sesid: self.selectedSes.id};
        $http({url: "get-report-result-all", method: "post", data: postdata}).success((data) => {
            self.resultAll = data;
            console.log(data);
            self.buildBarData(data);
        });
    };

    self.buildBarData = (data) => {
        const N = 3;
        self.barData[0].values = [];
        for (let i = 0; i < N; i++) {
            let lbl = (i + 1) + " - " + (i + 2);
            self.barData[0].values.push({label: lbl, value: 0});
        }
        data.forEach((d) => {
            let score = d.reduce((e,v) => e + v.val, 0) / d.length;
            let rank = Math.min(Math.floor(score - 1), N - 1);
            self.barData[0].values[rank].value += 1;
        });
    };

    self.shared.resetRubricaGraphs();

});