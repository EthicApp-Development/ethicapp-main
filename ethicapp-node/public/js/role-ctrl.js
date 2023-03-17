"use strict";

let BASE_APP = window.location.href.replace("role-playing", "");

let app = angular.module("Role", [
    "ngSanitize", "ui.bootstrap", "ui.tree", "btford.socket-io", "angular-intro", "ui-notification",
    "luegg.directives"
]);

app.factory("$socket", ["socketFactory", function (socketFactory) {
    return socketFactory();
}]);

app.controller("RoleController", [
    "$scope", "$http", "$timeout", "$socket", "Notification", "$sce", "$uibModal", "ngIntroService",
    function ($scope, $http, $timeout, $socket, Notification, $sce, $uibModal, ngIntroService) {
        let self = $scope;

        self.iteration = 1;
        self.myUid = -1;
        self.documents = [];
        self.showDoc = true;
        self.showRole = false;
        self.selectedDocument = 0;
        self.finished = false;
        self.sesId = -1;
        self.chatExp = true;
        self.isJigsaw = false;

        self.stages = [];
        self.currentStageId = 0;
        self.currentStage = null;
        self.stagesMap = {};

        self.selectedStage = null;

        self.actors = [];
        self.jroles = [];
        self.jigsawMap = {};
        self.myJigsaw = null;
        self.sel = [];

        self.actorsPrev = [];
        self.selPrev = [];

        self.selections = [];

        self.ansIter1 = {};
        self.ansIter2 = {};

        self.chatMsgs = {};
        self.chatMsgsPrev = {};
        self.chatmsg = "";
        self.chatmsgreply = null;

        self.tmId = -1;
        self.teamMap = {};
        self.teamMapPrev = {};

        self.lang = "spanish";
        self.selectedActor = null;
        self.selectedActorPrev = null;

        self.posToJustify = {};
        self.justifyPosition = false;

        self.verified = false;

        self.init = () => {
            self.getSesInfo();
            $socket.on("stateChange", (data) => {
                console.log("SOCKET.IO", data);
                if (data.ses == self.sesId) {
                    window.location.reload();
                }
            });
            $socket.on("chatMsgStage", (data) => {
                console.log("SOCKET.IO", data);
                if (
                    (data.stageid == self.currentStageId) &&
                    (data.tmid == self.tmId) &&
                    (self.currentStage.chat)
                ) {
                    updateChat();
                }
            });
            $socket.on("diffReceived", (data) => {
                console.log("SOCKET.IO", data);
                if(data.ses == self.sesId){
                    self.openDetails(data);
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
                self.currentStageId = data.current_stage;
                self.isJigsaw = data.type == "J";
                if (self.iteration >= 1) {
                // self.finished = true;
                }
                if(self.currentStageId != null || self.iteration >= 1) {
                    self.loadDocuments();
                    self.loadStageData();
                }
                if(self.isJigsaw){
                    self.getJigsawRoles();
                }
            });
        };

        let updateChat = (count) => {
            $http.post("get-chat-stage", {
                stageid: self.currentStageId
            }).success((data) => {
                self.chatMsgs = {};
                data.forEach(msg => {
                    if(msg.parent_id)
                        msg.parent = data.find(e => e.id == msg.parent_id);
                    self.chatMsgs[msg.stageid] = self.chatMsgs[msg.stageid] || [];
                    self.chatMsgs[msg.stageid].push(msg);
                });
                console.log(self.chatMsgs);
            });
        };

        self.getMe = () => {
            $http.post("get-my-name").success((data) => {
                self.lang = data.lang;
                self.updateLang(self.lang);
            });
        };

        self.selectActor = (i) => {
            self.selectedActor = i;
        };

        self.selectActorView = (i) => {
            self.selectedActorPrev = i;
        };

        self.getPlaceholder = () => {
            let a = self.actors[self.selectedActor];
            if(self.selectedActor == null || a == null){
                return "Seleccione un rol";
            }
            else if(a.jorder){
                return "Escribe tu justificación para el ORDEN EN QUE HAS UBICADO a " + a.name;
            }
            else {
                return "Escribe tu justificación SOBRE EL ROL de " + a.name;
            }
        };

        self.loadDocuments = () => {
            $http({url: "get-documents", method: "post"}).success((data) => {
                self.documents = data;
            });
        };

        self.getJigsawRoles = () => {
            $http.post("get-my-jigsaw-roles").success((data) => {
                self.jroles = data;
                self.jigsawMap = {};
                data.forEach(j => {
                    self.jigsawMap[j.id] = j;
                });
                self.getAssignedJigsawRole();
            });
        };

        self.getAssignedJigsawRole = () => {
            $http.post("get-assigned-jigsaw-role").success((data) => {
                if(data.length > 0){
                    self.myJigsaw = data[0].roleid;
                }
                else if(self.jroles.length > 0){
                    $http.post("assign-cyclic-jigsaw-role", {
                        cycle:   self.jroles.length,
                        stageid: self.currentStageId
                    }).success((data) => {
                        self.getAssignedJigsawRole();
                    });
                }
            // self.inputAssignedRoles();
            });
        };

        self.loadStageData = () => {
            $http.post("get-stages", {}).success(data => {
                self.stages = data;
                self.currentStage = self.stages.find(e => e.id == self.currentStageId);
                self.stagesMap = {};
                data.forEach(s => {
                    self.stagesMap[s.id] = s;
                });

                if(self.currentStage && self.currentStage.type == "team"){
                    $http.post("get-team-stage", {stageid: self.currentStageId}).success(data => {
                        self.team = data;
                        self.teamMap = {};
                        let alph = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                        data.forEach((u,i) => {
                            self.teamMap[u.id] = self.currentStage.anon ? alph[i] : u.name;
                            self.tmId = u.tmid;
                        });
                        if(self.isJigsaw){
                            self.inputAssignedRoles();
                        }
                    });
                    if(self.currentStage.prev_ans != "" && self.currentStage.prev_ans != null) {
                        let p = {
                            stageid:    self.currentStageId,
                            prevstages: self.currentStage.prev_ans
                        };
                        $http.post("get-team-actor-selection", p).success(data => {
                            self.teamSel = data;
                            self.structureSelData();
                        });
                    }
                    if(self.currentStage.chat) {
                        updateChat();
                    }
                }
                if(self.stages.length > 1){
                    self.selectStage(self.stages.length - 1);
                }
            });
            if(self.currentStageId != null){
                $http.post("get-actors", {stageid: self.currentStageId}).success(data => {
                    self.actors = data;
                    self.posToJustify = {};
                    self.justifyPosition = false;
                    self.actors.forEach((a,i) => {
                        if(a.jorder){
                            self.posToJustify[i] = true;
                            self.justifyPosition = true;
                        }
                    });
                    self.shuffleActors();
                    if(self.sel.length == self.actors.length && self.sel.length > 0){
                        self.populateActors();
                    }
                });
                $http.post("get-my-actor-sel", {stageid: self.currentStageId}).success(data => {
                    self.sel = data;
                    if(self.sel.length == self.actors.length && self.sel.length > 0){
                        self.populateActors();
                    }
                });
            }
        };

        self.populateActors = () => {
            let acts = [];
            self.sel.forEach(s => {
                let a = self.actors.find(e => e.id == s.actorid);
                a.comment = s.description;
                a.sent = s.description != "" && s.description != null;
                acts.push(a);
            });
            self.actors = acts;
        };

        self.shuffleActors = () => {
            self.actors = self.actors.map(a => [Math.random(), a])
                .sort((a, b) => a[0] - b[0])
                .map(a => a[1]);
        };

        self.populateActorsPrev = () => {
            let acts = [];
            self.selPrev.forEach(s => {
                let a = self.actorsPrev.find(e => e.id == s.actorid);
                if(a) {
                    a.comment = s.description;
                    a.sent = s.description != "" && s.description != null;
                    acts.push(a);
                }
            });
            self.actorsPrev = acts;
        };

        self.structureSelData = () => {
            let byStage = {};
            self.teamSel.forEach(e => {
                if(!byStage[e.stageid]){
                    byStage[e.stageid] = [];
                }
                byStage[e.stageid].push(e);
            });
            self.prevStages = Object.keys(byStage);
            byStage = Object.values(byStage);
            byStage = byStage.map(arr => {
                let byUser = {};
                arr.forEach(e => {
                    if(!byUser[e.uid]){
                        byUser[e.uid] = [];
                    }
                    byUser[e.uid].push(e);
                });
                return byUser;
            });
            self.prevRes = byStage;
        };

        self.structureSelDataPrev = () => {
            let byStage = {};
            self.teamSelPrev.forEach(e => {
                if(!byStage[e.stageid]){
                    byStage[e.stageid] = [];
                }
                byStage[e.stageid].push(e);
            });
            self.prevStagesPrev = Object.keys(byStage);
            byStage = Object.values(byStage);
            byStage = byStage.map(arr => {
                let byUser = {};
                arr.forEach(e => {
                    if(!byUser[e.uid]){
                        byUser[e.uid] = [];
                    }
                    byUser[e.uid].push(e);
                });
                return byUser;
            });
            self.prevResPrev = byStage;
        };

        self.selectDocument = (i) => {
            self.selectedDocument = i;
            self.showDoc = true;
            self.showRole = false;
        };

        self.selectRoleDescr = () => {
            self.showRole = true;
            self.showDoc = false;
            self.selectedStage = null;
        };

        self.selectStage = (i) => {
            if(self.stages[self.selectedStage] && self.stages[self.selectedStage].dirty){
                notify("Error", "Debe completar el diferencial antes de cambiar");
                return;
            }
            self.selectedStage = i;
            self.stages[self.selectedStage].cr = self.stages[self.selectedStage].c;
            self.showDoc = false;
            self.showRole = false;
            self.chatmsg = "";
            self.selPrev = [];
            self.actorsPrev = [];
            self.chatMsgsPrev = {};

            $http.post(
                "get-actors", { stageid: self.stages[self.selectedStage].id }
            ).success(data => {
                self.actorsPrev = data;
                if(self.selPrev.length == self.actorsPrev.length && self.selPrev.length > 0){
                    self.populateActorsPrev();
                }
            });
            $http.post(
                "get-my-actor-sel", { stageid: self.stages[self.selectedStage].id }
            ).success(data => {
                self.selPrev = data;
                if(self.selPrev.length == self.actorsPrev.length && self.actorsPrev.length > 0){
                    self.populateActorsPrev();
                }
            });

            let st = self.stages[self.selectedStage];
            if(st.type == "team"){
                self.teamPrev = [];
                self.teamMapPrev = {};
                self.teamSelPrev = [];
                self.prevResPrev = {};
                self.prevStagesPrev = {};
                $http.post("get-team-stage", {stageid: st.id}).success(data => {
                    self.teamPrev = data;
                    self.teamMapPrev = {};
                    let alph = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                    data.forEach((u,i) => {
                        self.teamMapPrev[u.id] = st.anon ? alph[i] : u.name;
                        self.tmId = u.tmid;
                    });
                    if(self.isJigsaw){
                        self.inputAssignedRoles();
                    }
                });
                if(st.prev_ans != "" && st.prev_ans != null) {
                    let p = {
                        stageid:    st.id,
                        prevstages: st.prev_ans
                    };
                    $http.post("get-team-actor-selection", p).success(data => {
                        self.teamSelPrev = data;
                        self.structureSelDataPrev();
                    });
                }
            }
            if(st.chat){
                $http.post("get-chat-stage", {
                    stageid: st.id
                }).success((data) => {
                    self.chatMsgsPrev = {};
                    data.forEach(msg => {
                        if(msg.parent_id)
                            msg.parent = data.find(e => e.id == msg.parent_id);
                        self.chatMsgsPrev[msg.stageid] = self.chatMsgsPrev[msg.stageid] || [];
                        self.chatMsgsPrev[msg.stageid].push(msg);
                    });
                });
            }

        };

        self.sendActorSel = (verify) => {
            if(verify){
                if (
                    self.actors.some((a,i) => (
                        (!self.justifyPosition && a.justified) ||
                        (self.justifyPosition && self.posToJustify[i])) &&
                        (a.comment == null || a.comment == "")
                    )
                ) {
                    notify(
                        "Datos Faltantes", "Falta completar la justificación de algunos actores"
                    );
                    return;
                }
            }
            self.actors.forEach((a,i) => {
                let postdata = {
                    orden:       i + 1,
                    description: a.comment || "",
                    actorid:     a.id,
                    stageid:     self.currentStageId
                };
                console.log(postdata);
                $http.post("send-actor-selection", postdata).success((data) => {
                    a.dirty = false;
                    a.sent = (a.comment != null && a.comment != "");
                });
            });
            self.selectedActor = null;
            if(verify){
                self.verified = true;
            }
        };

        self.sendChatMsg = () => {
            let postdata = {
                stageid:   self.currentStageId,
                content:   self.chatmsg,
                tmid:      self.tmId,
                parent_id: self.chatmsgreply
            };
            $http.post("add-chat-msg-stage", postdata).success(data => {
                self.chatmsg = "";
                self.chatmsgreply = null;
            });
        };

        self.getDocURL = () => {
            return $sce.trustAsResourceUrl(self.documents[self.selectedDocument].path);
        };

        let notify = (title, message, closable) => {
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
        };

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

        self.openDetails = (data) => {
            $uibModal.open({
                templateUrl:  "templ/direct-content.html",
                controller:   "DirectContentController",
                controllerAs: "vm",
                scope:        self,
                resolve:      {
                    data: function(){
                        return data;
                    },
                }
            });
        };

        self.setReply = (msg) => {
            self.chatmsgreply = msg == null ? null : msg.id;
            document.getElementById("chat-input").focus();
        };

        let introOptions = {
            steps: [
                {
                    element: "#tabd0",
                    intro:   "En esta pestaña encontrarás el caso a leer",
                },
                {
                    element: "#tabq0",
                    intro:   "En esta pestaña se encuentra la lista de roles que debes ordenar y justificar"
                },
                {
                    element: "#seslistbtn",
                    intro:   "Usando este botón puedes volver a la lista de sesiones",
                },
            ],
            showStepNumbers:    false,
            showBullets:        false,
            exitOnOverlayClick: true, //TODO: Review for delete
            exitOnEsc:          true,
            tooltipPosition:    "auto",
            nextLabel:          "Siguiente",
            prevLabel:          "Anterior",
            skipLabel:          "Salir",
            doneLabel:          "Listo"
        };

        ngIntroService.setOptions(introOptions);

        self.startTour = () => {
            ngIntroService.start();
        };

        self.wordCount = (s) => {
            return s ? s.split(" ").filter(e => e != "").length : 0;
        };

        self.inputAssignedRoles = () => {
            $http.post("get-assigned-jigsaw-roles", {
                sesid: self.sesId
            }).success((data) => {
                data.forEach(d => {
                    if(self.teamMap[d.userid]){
                        let j = self.jroles.find(e => e.id == d.roleid);
                        if(j && j.name && self.teamMap[d.userid].indexOf(" - ") == -1){
                            self.teamMap[d.userid] = self.teamMap[d.userid] + " - " + j.name;
                        }
                    }
                    if(self.teamMapPrev[d.userid]){
                        let j = self.jroles.find(e => e.id == d.roleid);
                        if(j && j.name && self.teamMapPrev[d.userid].indexOf(" - ") == -1){
                            self.teamMapPrev[d.userid] = self.teamMapPrev[d.userid] + " - " +
                                j.name;
                        }
                    }
                });
            });
        };

        self.init();

    }
]);

app.controller("DirectContentController", [
    "$scope", "$uibModalInstance", "data", function ($scope, $uibModalInstance, data) {
        var vm = this;
        vm.data = data;
        vm.data.title = "Respuesta recibida";

        setTimeout(() => {
            console.log(vm);
            document.getElementById("modal-content").innerHTML = vm.data.content;
        }, 500);

        vm.cancel = () => {
            $uibModalInstance.dismiss("cancel");
        };
    }
]);


window.DIC = null;
window.warnDIC = {};

app.filter("lang", function(){
    var filt = function(label){
        if(window.DIC == null)
            return;
        if(window.DIC[label])
            return window.DIC[label];
        if(!window.warnDIC[label]) {
            console.warn("Cannot find translation for ", label);
            window.warnDIC[label] = true;
        }
        return label;
    };

    filt.$stateful = true;
    return filt;
});

app.directive("bindHtmlCompile", ["$compile", function ($compile) {
    return {
        restrict: "A",
        link:     function (scope, element, attrs) {
            scope.$watch(function () {
                return scope.$eval(attrs.bindHtmlCompile);
            }, function (value) {
                element.html(value && value.toString());
                let compileScope = scope;
                if (attrs.bindHtmlScope) {
                    compileScope = scope.$eval(attrs.bindHtmlScope);
                }
                $compile(element.contents())(compileScope);
            });
        }
    };
}]);

app.filter("linkfy", function() {
    let replacePattern1 = /(\b(https?|ftp):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/gim;
    let replacePattern2 = /(^|[^\/])(www\.[\S]+(\b|$))/gim;
    let replacePattern3 = /(\w+@[a-zA-Z_]+?\.[a-zA-Z]{2,6})/gim;

    return function(text, target, otherProp) {
        if(text == null) return text;
        angular.forEach(text.match(replacePattern1), function(url) {
            text = text.replace(replacePattern1, "<a href=\"$1\" target=\"_blank\">$1</a>");
        });
        angular.forEach(text.match(replacePattern2), function(url) {
            text = text.replace(
                replacePattern2, "$1<a href=\"http://$2\" target=\"_blank\">$2</a>"
            );
        });
        angular.forEach(text.match(replacePattern3), function(url) {
            text = text.replace(replacePattern3, "<a href=\"mailto:$1\">$1</a>");
        });
        return text;
    };
});
