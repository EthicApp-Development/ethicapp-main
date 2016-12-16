"use strict";

let app = angular.module("Select", []);

app.controller("SelectController", function ($scope, $http) {
    let self = $scope;

    self.selectedQs = -1;
    self.questions = [];
    self.answers = {};
    self.comments = {};
    self.optLabels = ["A", "B", "C", "D", "E"];
    self.sent = {};

    self.init = () => {
        self.loadQuestions();
        self.loadAnswers();
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
        $http({url: "get-answers", method: "post"}).success((data) => {
            data.forEach((ans) => {
                self.answers[ans.qid] = ans.answer;
                self.comments[ans.qid] = ans.comment;
                self.sent[ans.qid] = true;
            });
        });
    };

    self.setAnswer = (qsi, ans) => {
        self.answers[qsi] = ans;
    };

    self.selectQuestion = (idx) => {
        self.selectedQs = idx;
    };

    self.nextQuestion = () => {
        if (self.selectedQs >= self.questions.length - 1) return;
        self.selectQuestion(seld.selectedQs + 1);
    };

    self.prevQuestion = () => {
        if (self.selectedQs <= 0) return;
        self.selectQuestion(seld.selectedQs - 1);
    };

    self.sendAnswer = (i) => {
        let postdata = {
            qid: i,
            answer: self.answers[i],
            comment: self.comments[i],
            iteration: 1
        };
        $http({url: "send-answer", method: "post", data: postdata}).success((data) => {
            if(data.status == "ok")
                self.sent[postdata.qid] = true;
        });
    };

    self.init();

});