"use strict";

let app = angular.module("Admin", ["ui.bootstrap","ui.multiselect","nvd3"]);

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
        self.shared.resetTab();
    };

    self.shared.updateSesData = () => {
        $http({url: "get-session-list", method: "post"}).success((data) => {
            console.log("Session data updated");
            self.sessions = data;
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
    self.tabOptions = ["Editar", "Usuarios", "Dashboard", "Grupos"];
    self.selectedTab = 0;

    self.shared.resetTab = () => {
        self.selectedTab = 0;
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

    self.changeState = () => {
        if (self.selectedSes.status > 6) return;
        if (self.selectedSes.status >= 3 && !self.selectedSes.grouped) return;
        let postdata = {sesid: self.selectedSes.id};
        $http({url: "change-state-session", method: "post", data: postdata}).success((data) => {
            window.location = window.location.href;
        });
    }

});


app.controller("NewUsersController", function($scope,$http){
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

app.controller("QuestionsController", function($scope,$http){
    let self = $scope;

    self.newQuestion = {
        content: "",
        alternatives: ["","","","",""],
        comment: "",
        other: "",
        answer: -1
    };

    self.selectAnswer = (i) => {
        self.newQuestion.answer = i;
    };

    self.addQuestion = () => {
        if(self.newQuestion.answer == -1) return;
        let postdata = {
            content: self.newQuestion.content,
            options: self.newQuestion.alternatives.join("\n"),
            comment: self.newQuestion.comment,
            answer: self.newQuestion.answer,
            sesid: self.selectedSes.id,
            other: self.newQuestion.other
        };
        $http({url: "add-question", method: "post", data: postdata}).success((data) => {
            if(data.status == "ok")
                self.requestQuestions()
        });
        self.newQuestion = {
            content: "",
            alternatives: ["","","","",""],
            comment: "",
            other: "",
            answer: -1
        };
    }

});

app.controller("DashboardController", function($scope,$http){
    let self = $scope;

    self.shared.resetGraphs = () => {
        self.alumState = {};
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
        self.barData = [{key: "Alumnos", color:"#1f77b4", values:[]}];
    };

    self.updateState = () => {
        let postdata = {sesid: self.selectedSes.id};
        if (self.selectedSes.type == "S") {
            $http({url: "get-alum-full-state-sel", method: "post", data: postdata}).success((data) => {
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
                self.buildBarData(data);
            });
        }
    };

    self.buildBarData = (data) => {
        const N = 5;
        self.barData[0].values = [];
        for(let i = 0; i < N; i++){
            let lbl = (i*20) + "% - " + ((i+1)*20) + "%";
            self.barData[0].values.push({label: lbl, value: 0});
        }
        data.forEach((d) => {
            let rank = Math.min(Math.floor(N * d.score),N-1);
            self.barData[0].values[rank].value += 1;
        });
    };

});

app.controller("GroupController", function($scope,$http){
    let self = $scope;

    self.shared.verifyGroups = () => {
        self.groupNum = 3;
        self.groups = [];
        self.groupNames = [];
        if(self.selectedSes != null && self.selectedSes.grouped){
            self.groupNum = null;
            self.generateGroups(true);
        }
    };

    self.generateGroups = (key) => {
        if(key == null && (self.groupNum < 1 || self.groupNum > self.users.length)) return;
        let postdata = {
            sesid: self.selectedSes.id,
            gnum: self.groupNum
        };
        if (self.selectedSes.type == "S") {
            $http({url: "group-proposal-sel", method: "post", data: postdata}).success((data) => {
                self.groups = data;
                console.log(data);
                self.groupNames = [];
                data.forEach((d) => {
                    self.groupNames.push(d.map(i => self.users[i.uid].name).join(", "));
                });
            });
        }
    };

    self.acceptGroups = () => {
        if (self.groups == null) return;
        let postdata = {
            sesid: self.selectedSes.id,
            groups: self.groups.map(e => e.map(f => f.uid))
        };
        console.log(postdata);
        $http({url: "send-groups", method: "post", data: postdata}).success((data) => {
            if(data.status == "ok") {
                console.log("Groups accepted");
                self.shared.verifyGroups();
            }
        });
    };

});