"use strict";

let app = angular.module("Select", [
    "ui.bootstrap", "timer", "btford.socket-io", "ui-notification", "ngSanitize"
]);

app.factory("$socket", ["socketFactory", function (socketFactory) {
    return socketFactory();
}]);

app.controller("SelectController", [
    "$scope", "$http", "$socket", "Notification", "$uibModal",
    function ($scope, $http, $socket, Notification, $uibModal) {
        let self = $scope;

        self.selectedQs = 0;
        self.iteration = 1;
        self.myUid = -1;
        self.questions = [];
        self.otherAnswsers = {};
        self.answers = {};
        self.anskey = {};
        self.comments = {};
        self.confidences = {};
        self.optLabels = ["A", "B", "C", "D", "E"];
        self.optConfidence = [0, 25, 50, 75, 100];
        self.sent = {};
        self.teamUids = [];
        self.bottomMsg = "";
        self.finished = false;
        self.useConfidence = false;
        self.useHints = false;
        self.shared = {};

        self.ansIter1 = {};
        self.ansIter2 = {};

        self.sesStatusses = ["individual", "anon", "teamWork", "finished"];

        self.lang = "spanish";

        self.init = () => {
            self.getSesInfo();
            $socket.on("stateChange", (data) => {
                console.log("SOCKET.IO", data);
                if (data.ses == self.sesId) {
                    window.location.reload();
                }
            });
            $socket.on("teamProgress", (data) => {
                console.log("SOCKET.IO", data);
                if (data.ses == self.sesId && data.tmid == self.teamId && self.iteration == 3) {
                    self.updateTeam();
                }
            });
            self.getMe();
        };

        self.getSesInfo = () => {
            $http({url: "get-ses-info", method: "post"}).success((data) => {
                self.iteration = data.iteration + 1;
                self.myUid = data.uid;
                self.sesName = data.name;
                self.sesId = data.id;
                self.sesSTime = data.stime;
                self.sesDescr = data.descr;
                self.useConfidence = (data.options != null && data.options.includes("C"));
                self.useHints = (data.options != null && data.options.includes("H"));
                self.useComments = (data.options != null && data.options.includes("J"));
                let set = new Set();
                if (self.iteration > 1) {
                    $http({
                        url: "get-team-selection", method: "post", data: { iteration: 1 }
                    }).success((data) => {
                        data.forEach((ans) => {
                            self.ansIter1[ans.qid] = self.ansIter1[ans.qid] || {};
                            self.ansIter1[ans.qid][ans.uid] = {
                                answer: ans.answer, comment: ans.comment
                            };
                            set.add(ans.uid);
                        });
                        self.teamUids = Array.from(set);
                    });
                }
                if (self.iteration > 2) {
                    $http({
                        url: "get-team-selection", method: "post", data: { iteration: 2 }
                    }).success((data) => {
                        data.forEach((ans) => {
                            self.ansIter2[ans.qid] = self.ansIter2[ans.qid] || {};
                            self.ansIter2[ans.qid][ans.uid] = {
                                answer: ans.answer, comment: ans.comment
                            };
                            set.add(ans.uid);
                        });
                        self.teamUids = Array.from(set);
                    });
                    self.updateTeam();
                }
                if (self.iteration >= 4) {
                    self.finished = true;
                    self.loadAnskey();
                }
                if(self.iteration > 0) {
                    self.loadQuestions();
                    self.loadAnswers();
                }
            });
        };

        self.getMe = () => {
            $http.post("get-my-name").success((data) => {
                self.lang = data.lang;
                self.updateLang(self.lang);
            });
        };

        self.updateTeam = () => {
            $http({url: "get-team", method: "post"}).success((data) => {
                self.team = {};
                self.teamstr = data.map(e => e.name).join(", ");
                data.forEach((tm) => {
                    self.team[tm.id] = tm.name;
                });
                if (data.length > 0) {
                    self.teamId = data[0].tmid;
                    self.teamProgress = data[0].progress;
                    if (self.iteration == 3)
                        self.selectQuestion(self.teamProgress);
                }
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

        self.loadAnskey = () => {
            $http({url: "get-anskey", method: "post"}).success((data) => {
                self.anskey = {};
                data.forEach((qs) => {
                    self.anskey[qs.id] = qs;
                });
            });
        };

        self.loadAnswers = () => {
            $http({
                url: "get-answers", method: "post", data: { iteration: Math.min(3, self.iteration) }
            }).success((data) => {
                data.forEach((ans) => {
                    self.answers[ans.qid] = ans.answer;
                    self.comments[ans.qid] = ans.comment;
                    self.confidences[ans.qid] = ans.confidence;
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

        self.selectQuestionTab = (idx) => {
            if (self.iteration == 3) {
                console.log("Checking team answers");
                let postdata = {qid: self.questions[self.selectedQs].id};
                $http({
                    url: "check-team-answer", method: "post", data: postdata
                }).success((data) => {
                    if (data.status == "ok") {
                        self.sendTeamProgress(idx);
                    // self.bottomMsg = "";
                    }
                    else if (data.status == "incomplete") {
                        notify(
                            "Error", "Debe esperar a que todos los miembros del equipo respondan"
                        );
                    }
                    else if (data.status == "different") {
                        notify("Error", "Las respuestas de los miembros del equipo no coinciden");
                    }
                    else if (
                        data.status == "incorrect" &&
                        !self.questions[self.selectedQs].hinted && self.useHints
                    ) {
                        notify("Comentario", data.msg);
                        self.questions[self.selectedQs].hinted = true;
                    }
                    else if (self.questions[self.selectedQs].hinted || !self.useHints) {
                        self.sendTeamProgress(idx);
                    }
                    else {
                        notify("Actividad", "Se alcanzó el final de la actividad");
                    }
                });
            }
            else if (self.questions[self.selectedQs].dirty) {
                notify("Error", "No se ha enviado una respuesta a la pregunta");
            }
            else {
                self.selectQuestion(idx);
            }
        };

        self.nextQuestion = () => {
            if (self.iteration == 3) {
                console.log("Checking team answers");
                let postdata = {qid: self.questions[self.selectedQs].id};
                $http({
                    url: "check-team-answer", method: "post", data: postdata
                }).success((data) => {
                    if (data.status == "ok") {
                        self.sendTeamProgress(self.selectedQs + 1);
                        self.bottomMsg = "";
                    }
                    else if (data.status == "incomplete") {
                        notify(
                            "Error", "Debe esperar a que todos los miembros del equipo respondan"
                        );
                    }
                    else if (data.status == "different") {
                        notify("Error", "Las respuestas de los miembros del equipo no coinciden");
                    }
                    else if (
                        data.status == "incorrect" &&
                        !self.questions[self.selectedQs].hinted && self.useHints
                    ) {
                        notify("Comentario", data.msg);
                        self.questions[self.selectedQs].hinted = true;
                    }
                    else if (self.questions[self.selectedQs].hinted || !self.useHints) {
                        self.sendTeamProgress(self.selectedQs + 1);
                        self.bottomMsg = "";
                    }
                    else {
                        notify("Actividad", "Se alcanzó el final de la actividad");
                    }
                });
            }
            else if (self.questions[self.selectedQs].dirty) {
                notify("Error", "No se ha enviado una respuesta a la pregunta");
            }
            else if (self.selectedQs >= self.questions.length - 1 && self.iteration != 3) {
                notify("Actividad", "Se alcanzó el final de la actividad");
            }
            else {
                self.selectQuestion(self.selectedQs + 1);
            }
        };

        self.sendTeamProgress = (pg) => {
            let postdata = {tmid: self.teamId, progress: pg};
            $http({url: "send-team-progress", method: "post", data: postdata}).success((data) => {
                if (data.status == "ok")
                    console.log("Progress sent");
            });
        };

        self.prevQuestion = () => {
            if (self.selectedQs <= 0) {
                notify("Actividad", "Se alcanzó el inicio de la actividad");
                return;
            }
            if (self.questions[self.selectedQs].dirty) {
                notify("Error", "No se ha enviado una respuesta a la pregunta");
            }
            else if (self.iteration != 3) {
                self.selectQuestion(self.selectedQs - 1);
            }
        };

        self.sendAnswer = (qs) => {
            if (self.answers[qs.id] == null || self.answers[qs.id] == -1) {
                notify("Error", "Debe seleccionar una alternativa");
                return;
            }
            if (self.useComments && (self.comments[qs.id] == null || self.comments[qs.id] == "")) {
                notify("Error", "Debe agregar un comentario");
                return;
            }
            if (self.useConfidence && (self.confidences[qs.id] == null)) {
                notify("Error", "Debe agregar un grado de certeza");
                return;
            }
            let postdata = {
                qid:        qs.id,
                answer:     self.answers[qs.id],
                comment:    self.comments[qs.id],
                confidence: self.confidences[qs.id],
                iteration:  self.iteration
            };
            $http({url: "send-answer", method: "post", data: postdata}).success((data) => {
                if (data.status == "ok") {
                    self.sent[postdata.qid] = true;
                    qs.dirty = false;
                }
            });
        };

        function notify (title, message) {
            $uibModal.open({
                template: `
                <div>
                    <div class="modal-header">
                        <h4>${title}</h4>
                    </div>
                    <div class="modal-body">
                        <p>${message}</p>
                    </div>
                </div>
                `
            });
        }

        self.openComment = (com) => {
            notify("Comentario", com);
        };


        self.showInfo = () => {
            notify("Factor Detonante", self.sesDescr, false);
        };

        self.updateLang = (lang) => {
            $http.get("data/" + lang + ".json").success((data) => {
                window.DIC = data;
            });
        };

        self.changeLang = () => {
            self.lang = (self.lang == "english") ? "spanish" : "english";
            self.updateLang(self.lang);
        };

        self.init();

    }
]);

app.filter("trustHtml", ["$sce", function($sce){
    return function(html){
        return $sce.trustAsHtml(html);
    };
}]);

window.DIC = null;
window.warnDIC = {};

app.filter("lang", function(){
    function filt(label) {
        if(window.DIC == null)
            return;
        if(window.DIC[label])
            return window.DIC[label];
        if(!window.warnDIC[label]) {
            console.warn("Cannot find translation for ", label);
            window.warnDIC[label] = true;
        }
        return label;
    }

    filt.$stateful = true;
    return filt;
});
