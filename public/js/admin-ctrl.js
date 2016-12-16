"use strict";

let app = angular.module("Admin", ["ui.bootstrap","ui.multiselect"]);

app.controller("AdminController", function ($scope, $http, $uibModal) {
    let self = $scope;
    self.sessions = [];
    self.selectedSes = null;
    self.documents = [];
    self.questions = [];
    self.newUsers = [];
    self.users = [];
    self.selectedIndex = -1;
    self.sesStatusses = ["No Publicada", "Lectura", "Edición", "Finalizada"];

    self.init = () => {
        $http({url: "get-session-list", method: "post"}).success((data) => {
            self.sessions = data;
        });
    };

    self.selectSession = (idx) => {
        self.selectedIndex = idx;
        self.selectedSes = self.sessions[idx];
        self.requestDocuments();
        self.requestQuestions();
        self.getNewUsers();
        self.getMembers();
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
            self.users = data;
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
    self.tabOptions = ["Editar", "Usuarios", "Dashboard", "Visor"];
    self.selectedTab = 0;

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
            if (data.status == "ok")
                console.log("Hola");
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
    self.alumState = {};

    self.updateState = () => {
        let postdata = {sesid: self.selectedSes.id};
        $http({url: "get-alum-full-state", method: "post", data: postdata}).success((data) => {
            data.forEach((d) => {
                if(self.alumState[d.uid] == null) {
                    self.alumState[d.uid] = {};
                    self.alumState[d.uid][d.qid] = d.correct;
                }
                else{
                    self.alumState[d.uid][d.qid] = d.correct;
                }
            });
        });
    };

});