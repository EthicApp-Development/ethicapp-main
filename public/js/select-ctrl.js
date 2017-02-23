"use strict";

let app = angular.module("Select", []);

app.controller("SelectController", ["$scope", "$http", function ($scope, $http) {
    let self = $scope;

    self.selectedQs = 0;
    self.iteration = 1;
    self.myUid = -1;
    self.questions = [];
    self.otherAnswsers = {};
    self.answers = {};
    self.comments = {};
    self.optLabels = ["A", "B", "C", "D", "E"];
    self.sent = {};
    self.teamUids = [];
    self.bottomMsg = "";

    self.ansIter1 = {};
    self.ansIter2 = {};

    self.init = () => {
        self.loadQuestions();
        self.getSesInfo();
    };

    self.getSesInfo = () => {
        $http({url: "get-ses-info", method: "post"}).success((data) => {
            self.iteration = data.iteration;
            self.myUid = data.uid;
            self.sesName = data.name;
            let set = new Set();
            if(self.iteration > 1) {
                $http({url: "get-team-selection", method: "post", data: {iteration: 1}}).success((data) => {
                    data.forEach((ans) => {
                        self.ansIter1[ans.qid] = self.ansIter1[ans.qid] || {};
                        self.ansIter1[ans.qid][ans.uid] = {answer: ans.answer, comment: ans.comment};
                        set.add(ans.uid);
                        self.teamUids = Array.from(set);
                    });
                });
            }
            if(self.iteration > 2) {
                $http({url: "get-team-selection", method: "post", data: {iteration: 2}}).success((data) => {
                    data.forEach((ans) => {
                        self.ansIter2[ans.qid] = self.ansIter2[ans.qid] || {};
                        self.ansIter2[ans.qid][ans.uid] = {answer: ans.answer, comment: ans.comment};
                        set.add(ans.uid);
                        self.teamUids = Array.from(set);
                    });
                });
            }
            self.loadAnswers();
        });
    };

    self.loadQuestions = () => {
        $http({url: "get-questions", method: "post"}).success((data) => {
            self.questions = data;
            self.questions.forEach((qs) => {
                qs.options = qs.options.split("\n");
            });
        });
    };

    self.loadAnswers = () => {
        $http({url: "get-answers", method: "post", data: {iteration: Math.min(3,self.iteration)}}).success((data) => {
            data.forEach((ans) => {
                self.answers[ans.qid] = ans.answer;
                self.comments[ans.qid] = ans.comment;
                self.sent[ans.qid] = true;
            });
        });
    };

    self.setAnswer = (qs, ans) => {
        self.answers[qs.id] = ans;
        qs.dirty = true;
    };

    self.selectQuestion = (idx) => {
        self.selectedQs = idx;
    };

    self.nextQuestion = () => {
        if (self.selectedQs >= self.questions.length - 1){
            self.bottomMsg = "Se alcanzo el final de la actividad";
            return;
        }
        if (self.iteration == 3){
            console.log("Checking team answers");
            let postdata = {qid: self.questions[self.selectedQs].id};
            $http({url: "check-team-answer", method: "post", data: postdata}).success((data) => {
                if(data.status == "ok") {
                    self.selectQuestion(self.selectedQs + 1);
                    self.bottomMsg = "";
                }
                else if(data.status == "incomplete"){
                    self.bottomMsg = "Debe esperar a que todos los miembros del equipo respondan";
                }
                else if(data.status == "different"){
                    self.bottomMsg = "Las respuestas de los miembros del equipo no coinciden";
                }
            });
        }
        else {
            self.selectQuestion(self.selectedQs + 1);
        }
    };

    self.prevQuestion = () => {
        if (self.selectedQs <= 0){
            self.bottomMsg = "Se alcanzo el inicio de la actividad";
            return;
        }
        if (self.iteration != 3) {
            self.selectQuestion(self.selectedQs - 1);
        }
    };

    self.sendAnswer = (qs) => {
        let postdata = {
            qid: qs.id,
            answer: self.answers[qs.id],
            comment: self.comments[qs.id],
            iteration: self.iteration
        };
        $http({url: "send-answer", method: "post", data: postdata}).success((data) => {
            if(data.status == "ok") {
                self.sent[postdata.qid] = true;
                qs.dirty = false;
            }
        });
    };

    self.init();

}]);