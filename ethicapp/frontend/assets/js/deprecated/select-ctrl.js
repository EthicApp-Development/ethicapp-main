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

        self.lang = "ES_CL/spanish";

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

        self.getSesInfo = async () => {
            try {
                // Fetch session information
                const sesInfoResponse = await $http({ url: "get-ses-info", method: "post" });
                const data = sesInfoResponse.data;
        
                // Update session information
                self.iteration = data.iteration + 1;
                self.myUid = data.uid;
                self.sesName = data.name;
                self.sesId = data.id;
                self.sesSTime = data.stime;
                self.sesDescr = data.descr;
                self.useConfidence = data.options?.includes("C");
                self.useHints = data.options?.includes("H");
                self.useComments = data.options?.includes("J");
        
                const set = new Set();
        
                // Load team selection for iteration 1 if applicable
                if (self.iteration > 1) {
                    const teamSelection1 = await $http({
                        url: "get-team-selection",
                        method: "post",
                        data: { iteration: 1 }
                    });
        
                    teamSelection1.data.forEach((ans) => {
                        self.ansIter1[ans.qid] = self.ansIter1[ans.qid] || {};
                        self.ansIter1[ans.qid][ans.uid] = { answer: ans.answer, comment: ans.comment };
                        set.add(ans.uid);
                    });
                    self.teamUids = Array.from(set);
                }
        
                // Load team selection for iteration 2 if applicable
                if (self.iteration > 2) {
                    const teamSelection2 = await $http({
                        url: "get-team-selection",
                        method: "post",
                        data: { iteration: 2 }
                    });
        
                    teamSelection2.data.forEach((ans) => {
                        self.ansIter2[ans.qid] = self.ansIter2[ans.qid] || {};
                        self.ansIter2[ans.qid][ans.uid] = { answer: ans.answer, comment: ans.comment };
                        set.add(ans.uid);
                    });
                    self.teamUids = Array.from(set);
        
                    // Update team based on the latest selection
                    await self.updateTeam();
                }
        
                // Set finished state and load answer key if iteration threshold is met
                if (self.iteration >= 4) {
                    self.finished = true;
                    await self.loadAnskey();
                }
        
                // Load questions and answers if there are iterations
                if (self.iteration > 0) {
                    await self.loadQuestions();
                    await self.loadAnswers();
                }
        
            } catch (error) {
                console.error("Error fetching session information:", error);
                Notification.error("Failed to load session information");
            }
        };

        self.getMe = async () => {
            try {
                const response = await $http.post("get-my-name");
                self.lang = response.data.lang === "spanish" ? "ES_CL/spanish" : "EN_US/english";
                await self.updateLang(self.lang);
            } catch (error) {
                console.error("Error fetching user language:", error);
                Notification.error("Failed to load user language");
            }
        };
        
        self.updateTeam = async () => {
            try {
                const response = await $http({ url: "get-team", method: "post" });
                const data = response.data;
        
                self.team = {};
                self.teamstr = data.map(e => e.name).join(", ");
                data.forEach((tm) => {
                    self.team[tm.id] = tm.name;
                });
        
                if (data.length > 0) {
                    self.teamId = data[0].tmid;
                    self.teamProgress = data[0].progress;
                    if (self.iteration === 3) {
                        await self.selectQuestion(self.teamProgress);
                    }
                }
            } catch (error) {
                console.error("Error updating team data:", error);
                Notification.error("Failed to update team data");
            }
        };
        
        self.loadQuestions = async () => {
            try {
                const response = await $http({ url: "get-questions", method: "post" });
                self.questions = response.data;
                self.questions.forEach((qs) => {
                    qs.options = qs.options.split("\n");
                });
            } catch (error) {
                console.error("Error loading questions:", error);
                Notification.error("Failed to load questions");
            }
        };
        
        self.loadAnskey = async () => {
            try {
                const response = await $http({ url: "get-anskey", method: "post" });
                self.anskey = {};
                response.data.forEach((qs) => {
                    self.anskey[qs.id] = qs;
                });
            } catch (error) {
                console.error("Error loading answer key:", error);
                Notification.error("Failed to load answer key");
            }
        };
        
        self.loadAnswers = async () => {
            try {
                const response = await $http({
                    url: "get-answers",
                    method: "post",
                    data: { iteration: Math.min(3, self.iteration) }
                });
                response.data.forEach((ans) => {
                    self.answers[ans.qid] = ans.answer;
                    self.comments[ans.qid] = ans.comment;
                    self.confidences[ans.qid] = ans.confidence;
                    self.sent[ans.qid] = true;
                });
            } catch (error) {
                console.error("Error loading answers:", error);
                Notification.error("Failed to load answers");
            }
        };
        
        self.setAnswer = (qs, ans) => {
            self.answers[qs.id] = ans;
            qs.dirty = true;
        };

        self.selectQuestion = (idx) => {
            self.selectedQs = idx;
        };

        self.selectQuestionTab = async (idx) => {
            try {
                if (self.iteration === 3) {
                    console.log("Checking team answers");
                    const postdata = { qid: self.questions[self.selectedQs].id };
                    const response = await $http.post("check-team-answer", postdata);
                    const data = response.data;
        
                    if (data.status === "ok") {
                        await self.sendTeamProgress(idx);
                    } else if (data.status === "incomplete") {
                        notify("Error", "Debe esperar a que todos los miembros del equipo respondan");
                    } else if (data.status === "different") {
                        notify("Error", "Las respuestas de los miembros del equipo no coinciden");
                    } else if (data.status === "incorrect" && !self.questions[self.selectedQs].hinted && self.useHints) {
                        notify("Comentario", data.msg);
                        self.questions[self.selectedQs].hinted = true;
                    } else if (self.questions[self.selectedQs].hinted || !self.useHints) {
                        await self.sendTeamProgress(idx);
                    } else {
                        notify("Actividad", "Se alcanzó el final de la actividad");
                    }
                } else if (self.questions[self.selectedQs].dirty) {
                    notify("Error", "No se ha enviado una respuesta a la pregunta");
                } else {
                    self.selectQuestion(idx);
                }
            } catch (error) {
                console.error("Error in selectQuestionTab:", error);
                Notification.error("Failed to check team answers");
            }
        };
        
        self.nextQuestion = async () => {
            try {
                if (self.iteration === 3) {
                    console.log("Checking team answers");
                    const postdata = { qid: self.questions[self.selectedQs].id };
                    const response = await $http.post("check-team-answer", postdata);
                    const data = response.data;
        
                    if (data.status === "ok") {
                        await self.sendTeamProgress(self.selectedQs + 1);
                        self.bottomMsg = "";
                    } else if (data.status === "incomplete") {
                        notify("Error", "Debe esperar a que todos los miembros del equipo respondan");
                    } else if (data.status === "different") {
                        notify("Error", "Las respuestas de los miembros del equipo no coinciden");
                    } else if (data.status === "incorrect" && !self.questions[self.selectedQs].hinted && self.useHints) {
                        notify("Comentario", data.msg);
                        self.questions[self.selectedQs].hinted = true;
                    } else if (self.questions[self.selectedQs].hinted || !self.useHints) {
                        await self.sendTeamProgress(self.selectedQs + 1);
                        self.bottomMsg = "";
                    } else {
                        notify("Actividad", "Se alcanzó el final de la actividad");
                    }
                } else if (self.questions[self.selectedQs].dirty) {
                    notify("Error", "No se ha enviado una respuesta a la pregunta");
                } else if (self.selectedQs >= self.questions.length - 1 && self.iteration !== 3) {
                    notify("Actividad", "Se alcanzó el final de la actividad");
                } else {
                    self.selectQuestion(self.selectedQs + 1);
                }
            } catch (error) {
                console.error("Error in nextQuestion:", error);
                Notification.error("Failed to check team answers");
            }
        };
        
        self.sendTeamProgress = async (pg) => {
            try {
                const postdata = { tmid: self.teamId, progress: pg };
                const response = await $http.post("send-team-progress", postdata);
                if (response.data.status === "ok") {
                    console.log("Progress sent");
                }
            } catch (error) {
                console.error("Error sending team progress:", error);
                Notification.error("Failed to send team progress");
            }
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

        self.sendAnswer = async (qs) => {
            try {
                // Verificar si una respuesta fue seleccionada
                if (self.answers[qs.id] == null || self.answers[qs.id] === -1) {
                    notify("Error", "Debe seleccionar una alternativa");
                    return;
                }
        
                // Verificar si se requiere un comentario
                if (self.useComments && (!self.comments[qs.id] || self.comments[qs.id].trim() === "")) {
                    notify("Error", "Debe agregar un comentario");
                    return;
                }
        
                // Verificar si se requiere grado de certeza
                if (self.useConfidence && self.confidences[qs.id] == null) {
                    notify("Error", "Debe agregar un grado de certeza");
                    return;
                }
        
                // Preparar los datos para enviar
                const postdata = {
                    qid:        qs.id,
                    answer:     self.answers[qs.id],
                    comment:    self.comments[qs.id],
                    confidence: self.confidences[qs.id],
                    iteration:  self.iteration
                };
        
                // Enviar la respuesta
                const response = await $http.post("send-answer", postdata);
                if (response.data.status === "ok") {
                    self.sent[postdata.qid] = true;
                    qs.dirty = false;
                }
            } catch (error) {
                console.error("Error sending answer:", error);
                Notification.error("Failed to send answer");
            }
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

        self.updateLang = async (lang) => {
            try {
                const response = await $http.get(`assets/i18n/${lang}.json`);
                window.DIC = response.data;
            } catch (error) {
                console.error("Error updating language:", error);
                Notification.error("Failed to update language settings");
            }
        };
        
        self.changeLang = () => {
            self.lang = (self.lang == "EN_US/english") ? "ES_CL/spanish" : "EN_US/english";
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
