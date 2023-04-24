"use strict";

var BASE_APP = window.location.href.replace("role-playing", "");

var app = angular.module("Role", ["ngSanitize", "ui.bootstrap", 'ui.tree', 'btford.socket-io', "angular-intro", "ui-notification", "luegg.directives"]);

app.factory("$socket", ["socketFactory", function (socketFactory) {
    return socketFactory();
}]);

app.controller("RoleController", ["$scope", "$http", "$timeout", "$socket", "Notification", "$sce", "$uibModal", "ngIntroService", function ($scope, $http, $timeout, $socket, Notification, $sce, $uibModal, ngIntroService) {
    var self = $scope;

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

    self.init = function () {
        self.getSesInfo();
        $socket.on("stateChange", function (data) {
            console.log("SOCKET.IO", data);
            if (data.ses == self.sesId) {
                window.location.reload();
            }
        });
        $socket.on("chatMsgStage", function (data) {
            console.log("SOCKET.IO", data);
            if (data.stageid == self.currentStageId && data.tmid == self.tmId && self.currentStage.chat) {
                updateChat();
            }
        });
        $socket.on("diffReceived", function (data) {
            console.log("SOCKET.IO", data);
            if (data.ses == self.sesId) {
                self.openDetails(data);
            }
        });
        self.getMe();
    };

    self.getSesInfo = function () {
        $http({ url: "get-ses-info", method: "post" }).success(function (data) {
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
            if (self.currentStageId != null || self.iteration >= 1) {
                self.loadDocuments();
                self.loadStageData();
            }
            if (self.isJigsaw) {
                self.getJigsawRoles();
            }
        });
    };

    var updateChat = function updateChat(count) {
        $http.post("get-chat-stage", {
            stageid: self.currentStageId
        }).success(function (data) {
            self.chatMsgs = {};
            data.forEach(function (msg) {
                if (msg.parent_id) msg.parent = data.find(function (e) {
                    return e.id == msg.parent_id;
                });
                self.chatMsgs[msg.stageid] = self.chatMsgs[msg.stageid] || [];
                self.chatMsgs[msg.stageid].push(msg);
            });
            console.log(self.chatMsgs);
        });
    };

    self.getMe = function () {
        $http.post("get-my-name").success(function (data) {
            self.lang = data.lang;
            self.updateLang(self.lang);
        });
    };

    self.selectActor = function (i) {
        self.selectedActor = i;
    };

    self.selectActorView = function (i) {
        self.selectedActorPrev = i;
    };

    self.getPlaceholder = function () {
        var a = self.actors[self.selectedActor];
        if (self.selectedActor == null || a == null) {
            return "Seleccione un rol";
        } else if (a.jorder) {
            return "Escribe tu justificación para el ORDEN EN QUE HAS UBICADO a " + a.name;
        } else {
            return "Escribe tu justificación SOBRE EL ROL de " + a.name;
        }
    };

    self.loadDocuments = function () {
        $http({ url: "get-documents", method: "post" }).success(function (data) {
            self.documents = data;
        });
    };

    self.getJigsawRoles = function () {
        $http.post("get-my-jigsaw-roles").success(function (data) {
            self.jroles = data;
            self.jigsawMap = {};
            data.forEach(function (j) {
                self.jigsawMap[j.id] = j;
            });
            self.getAssignedJigsawRole();
        });
    };

    self.getAssignedJigsawRole = function () {
        $http.post("get-assigned-jigsaw-role").success(function (data) {
            if (data.length > 0) {
                self.myJigsaw = data[0].roleid;
            } else if (self.jroles.length > 0) {
                $http.post("assign-cyclic-jigsaw-role", {
                    cycle: self.jroles.length,
                    stageid: self.currentStageId
                }).success(function (data) {
                    self.getAssignedJigsawRole();
                });
            }
            // self.inputAssignedRoles();
        });
    };

    self.loadStageData = function () {
        $http.post("get-stages", {}).success(function (data) {
            self.stages = data;
            self.selectStage2(self.stages.length - 1)
            self.currentStage = self.stages.find(function (e) {
                return e.id == self.currentStageId;
            });
            self.stagesMap = {};
            data.forEach(function (s) {
                self.stagesMap[s.id] = s;
            });

            if (self.currentStage && self.currentStage.type == "team") {
                $http.post("get-team-stage", { stageid: self.currentStageId }).success(function (data) {
                    self.team = data;
                    self.teamMap = {};
                    var alph = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                    data.forEach(function (u, i) {
                        self.teamMap[u.id] = self.currentStage.anon ? alph[i] : u.name;
                        self.tmId = u.tmid;
                    });
                    if (self.isJigsaw) {
                        self.inputAssignedRoles();
                    }
                });
                if (self.currentStage.prev_ans != "" && self.currentStage.prev_ans != null) {
                    var p = {
                        stageid: self.currentStageId,
                        prevstages: self.currentStage.prev_ans
                    };
                    $http.post("get-team-actor-selection", p).success(function (data) {
                        self.teamSel = data;
                        self.structureSelData();
                    });
                }
                if (self.currentStage.chat) {
                    updateChat();
                }
            }
            if (self.stages.length > 1) {
                self.selectStage(self.stages.length - 1);
            }
        });
        if (self.currentStageId != null) {
            $http.post("get-actors", { stageid: self.currentStageId }).success(function (data) {
                self.actors = data;
                self.posToJustify = {};
                self.justifyPosition = false;
                self.actors.forEach(function (a, i) {
                    if (a.jorder) {
                        self.posToJustify[i] = true;
                        self.justifyPosition = true;
                    }
                });
                self.shuffleActors();
                if (self.sel.length == self.actors.length && self.sel.length > 0) {
                    self.populateActors();
                }
            });
            $http.post("get-my-actor-sel", { stageid: self.currentStageId }).success(function (data) {
                self.sel = data;
                if (self.sel.length == self.actors.length && self.sel.length > 0) {
                    self.populateActors();
                }
            });
        }
    };

    self.populateActors = function () {
        var acts = [];
        self.sel.forEach(function (s) {
            var a = self.actors.find(function (e) {
                return e.id == s.actorid;
            });
            a.comment = s.description;
            a.sent = s.description != "" && s.description != null;
            acts.push(a);
        });
        self.actors = acts;
    };

    self.shuffleActors = function () {
        self.actors = self.actors.map(function (a) {
            return [Math.random(), a];
        }).sort(function (a, b) {
            return a[0] - b[0];
        }).map(function (a) {
            return a[1];
        });
    };

    self.populateActorsPrev = function () {
        var acts = [];
        self.selPrev.forEach(function (s) {
            var a = self.actorsPrev.find(function (e) {
                return e.id == s.actorid;
            });
            if (a) {
                a.comment = s.description;
                a.sent = s.description != "" && s.description != null;
                acts.push(a);
            }
        });
        self.actorsPrev = acts;
    };

    self.structureSelData = function () {
        var byStage = {};
        self.teamSel.forEach(function (e) {
            if (!byStage[e.stageid]) {
                byStage[e.stageid] = [];
            }
            byStage[e.stageid].push(e);
        });
        self.prevStages = Object.keys(byStage);
        byStage = Object.values(byStage);
        byStage = byStage.map(function (arr) {
            var byUser = {};
            arr.forEach(function (e) {
                if (!byUser[e.uid]) {
                    byUser[e.uid] = [];
                }
                byUser[e.uid].push(e);
            });
            return byUser;
        });
        self.prevRes = byStage;
    };

    self.structureSelDataPrev = function () {
        var byStage = {};
        self.teamSelPrev.forEach(function (e) {
            if (!byStage[e.stageid]) {
                byStage[e.stageid] = [];
            }
            byStage[e.stageid].push(e);
        });
        self.prevStagesPrev = Object.keys(byStage);
        byStage = Object.values(byStage);
        byStage = byStage.map(function (arr) {
            var byUser = {};
            arr.forEach(function (e) {
                if (!byUser[e.uid]) {
                    byUser[e.uid] = [];
                }
                byUser[e.uid].push(e);
            });
            return byUser;
        });
        self.prevResPrev = byStage;
    };

    self.selectDocument = function (i) {
        self.selectedDocument = i;
        self.showDoc = true;
        self.showRole = false;
    };

    self.selectRoleDescr = function () {
        self.showRole = true;
        self.showDoc = false;
        self.selectedStage = null;
    };

    self.selectStage = function (i) {
        if (self.stages[self.selectedStage] && self.stages[self.selectedStage].dirty) {
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

        $http.post("get-actors", { stageid: self.stages[self.selectedStage].id }).success(function (data) {
            self.actorsPrev = data;
            if (self.selPrev.length == self.actorsPrev.length && self.selPrev.length > 0) {
                self.populateActorsPrev();
            }
        });
        $http.post("get-my-actor-sel", { stageid: self.stages[self.selectedStage].id }).success(function (data) {
            self.selPrev = data;
            if (self.selPrev.length == self.actorsPrev.length && self.actorsPrev.length > 0) {
                self.populateActorsPrev();
            }
        });

        var st = self.stages[self.selectedStage];
        if (st.type == "team") {
            self.teamPrev = [];
            self.teamMapPrev = {};
            self.teamSelPrev = [];
            self.prevResPrev = {};
            self.prevStagesPrev = {};
            $http.post("get-team-stage", { stageid: st.id }).success(function (data) {
                self.teamPrev = data;
                self.teamMapPrev = {};
                var alph = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                data.forEach(function (u, i) {
                    self.teamMapPrev[u.id] = st.anon ? alph[i] : u.name;
                    self.tmId = u.tmid;
                });
                if (self.isJigsaw) {
                    self.inputAssignedRoles();
                }
            });
            if (st.prev_ans != "" && st.prev_ans != null) {
                var p = {
                    stageid: st.id,
                    prevstages: st.prev_ans
                };
                $http.post("get-team-actor-selection", p).success(function (data) {
                    self.teamSelPrev = data;
                    self.structureSelDataPrev();
                });
            }
        }
        if (st.chat) {
            $http.post("get-chat-stage", {
                stageid: st.id
            }).success(function (data) {
                self.chatMsgsPrev = {};
                data.forEach(function (msg) {
                    if (msg.parent_id) msg.parent = data.find(function (e) {
                        return e.id == msg.parent_id;
                    });
                    self.chatMsgsPrev[msg.stageid] = self.chatMsgsPrev[msg.stageid] || [];
                    self.chatMsgsPrev[msg.stageid].push(msg);
                });
            });
        }
    };
    self.selectStage2 = function (i) {
        if (self.stages[self.selectedStage] && self.stages[self.selectedStage].dirty) {
            notify("Error", "Debe completar el diferencial antes de cambiar");
            return;
        }
        self.selectedStage = i;
        self.stages[self.selectedStage].cr = self.stages[self.selectedStage].c;
        if (i==0){
            self.showDoc=true;
        }
        else{
            self.showDoc=false;
        }
        self.showRole = false;
        self.chatmsg = "";
        self.selPrev = [];
        self.actorsPrev = [];
        self.chatMsgsPrev = {};

        $http.post("get-actors", { stageid: self.stages[self.selectedStage].id }).success(function (data) {
            self.actorsPrev = data;
            if (self.selPrev.length == self.actorsPrev.length && self.selPrev.length > 0) {
                self.populateActorsPrev();
            }
        });
        $http.post("get-my-actor-sel", { stageid: self.stages[self.selectedStage].id }).success(function (data) {
            self.selPrev = data;
            if (self.selPrev.length == self.actorsPrev.length && self.actorsPrev.length > 0) {
                self.populateActorsPrev();
            }
        });

        var st = self.stages[self.selectedStage];
        if (st.type == "team") {
            self.teamPrev = [];
            self.teamMapPrev = {};
            self.teamSelPrev = [];
            self.prevResPrev = {};
            self.prevStagesPrev = {};
            $http.post("get-team-stage", { stageid: st.id }).success(function (data) {
                self.teamPrev = data;
                self.teamMapPrev = {};
                var alph = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                data.forEach(function (u, i) {
                    self.teamMapPrev[u.id] = st.anon ? alph[i] : u.name;
                    self.tmId = u.tmid;
                });
                if (self.isJigsaw) {
                    self.inputAssignedRoles();
                }
            });
            if (st.prev_ans != "" && st.prev_ans != null) {
                var p = {
                    stageid: st.id,
                    prevstages: st.prev_ans
                };
                $http.post("get-team-actor-selection", p).success(function (data) {
                    self.teamSelPrev = data;
                    self.structureSelDataPrev();
                });
            }
        }
        if (st.chat) {
            $http.post("get-chat-stage", {
                stageid: st.id
            }).success(function (data) {
                self.chatMsgsPrev = {};
                data.forEach(function (msg) {
                    if (msg.parent_id) msg.parent = data.find(function (e) {
                        return e.id == msg.parent_id;
                    });
                    self.chatMsgsPrev[msg.stageid] = self.chatMsgsPrev[msg.stageid] || [];
                    self.chatMsgsPrev[msg.stageid].push(msg);
                });
            });
        }
    };

    self.sendActorSel = function (verify) {
        if (verify) {
            if (self.actors.some(function (a, i) {
                return (!self.justifyPosition && a.justified || self.justifyPosition && self.posToJustify[i]) && (a.comment == null || a.comment == "");
            })) {
                notify("Datos Faltantes", "Falta completar la justificación de algunos actores");
                return;
            }
        }
        self.actors.forEach(function (a, i) {
            var postdata = {
                orden: i + 1,
                description: a.comment || "",
                actorid: a.id,
                stageid: self.currentStageId
            };
            console.log(postdata);
            $http.post("send-actor-selection", postdata).success(function (data) {
                a.dirty = false;
                a.sent = a.comment != null && a.comment != "";
            });
        });
        self.selectedActor = null;
        if (verify) {
            self.verified = true;
        }
    };

    self.sendChatMsg = function () {
        var postdata = {
            stageid: self.currentStageId,
            content: self.chatmsg,
            tmid: self.tmId,
            parent_id: self.chatmsgreply
        };
        // console.log(postdata);
        $http.post("add-chat-msg-stage", postdata).success(function (data) {
            self.chatmsg = "";
            self.chatmsgreply = null;
        });
    };

    self.getDocURL = function () {
        // return $sce.trustAsResourceUrl("https://docs.google.com/viewer?url=" + BASE_APP + self.documents[self.selectedDocument].path + "&embedded=true");
        return $sce.trustAsResourceUrl(self.documents[self.selectedDocument].path);
    };

    var notify = function notify(title, message, closable) {
        $uibModal.open({
            template: '<div><div class="modal-header"><h4>' + title + '</h4></div><div class="modal-body"><p>' + message + '</p></div></div>'
        });
    };

    self.openComment = function (com) {
        notify("Comentario", com);
    };

    self.showInfo = function () {
        notify("Factor Detonante", self.sesDescr, false);
    };

    self.updateLang = function (lang) {
        $http.get("data/" + lang + ".json").success(function (data) {
            window.DIC = data;
        });
    };

    self.changeLang = function () {
        self.lang = self.lang == "english" ? "spanish" : "english";
        self.updateLang(self.lang);
    };

    self.openDetails = function (_data) {
        $uibModal.open({
            templateUrl: "templ/direct-content.html",
            controller: "DirectContentController",
            controllerAs: "vm",
            scope: self,
            resolve: {
                data: function data() {
                    return _data;
                }
            }
        });
    };

    self.setReply = function (msg) {
        self.chatmsgreply = msg == null ? null : msg.id;
        document.getElementById("chat-input").focus();
    };

    var introOptions = {
        steps: [{
            element: '#tabd0',
            intro: 'En esta pestaña encontrarás el caso a leer'
        }, {
            element: "#tabq0",
            intro: "En esta pestaña se encuentra la lista de roles que debes ordenar y justificar"
        }, {
            element: "#seslistbtn",
            intro: "Usando este botón puedes volver a la lista de sesiones"
        }],
        showStepNumbers: false,
        showBullets: false,
        exitOnOverlayClick: true,
        exitOnEsc: true,
        tooltipPosition: "auto",
        nextLabel: 'Siguiente',
        prevLabel: 'Anterior',
        skipLabel: 'Salir',
        doneLabel: 'Listo'
    };

    ngIntroService.setOptions(introOptions);

    self.startTour = function () {
        ngIntroService.start();
    };

    self.wordCount = function (s) {
        return s ? s.split(" ").filter(function (e) {
            return e != "";
        }).length : 0;
    };

    self.inputAssignedRoles = function () {
        $http.post("get-assigned-jigsaw-roles", {
            sesid: self.sesId
        }).success(function (data) {
            data.forEach(function (d) {
                if (self.teamMap[d.userid]) {
                    var j = self.jroles.find(function (e) {
                        return e.id == d.roleid;
                    });
                    if (j && j.name && self.teamMap[d.userid].indexOf(" - ") == -1) {
                        self.teamMap[d.userid] = self.teamMap[d.userid] + " - " + j.name;
                    }
                }
                if (self.teamMapPrev[d.userid]) {
                    var _j = self.jroles.find(function (e) {
                        return e.id == d.roleid;
                    });
                    if (_j && _j.name && self.teamMapPrev[d.userid].indexOf(" - ") == -1) {
                        self.teamMapPrev[d.userid] = self.teamMapPrev[d.userid] + " - " + _j.name;
                    }
                }
            });
        });
    };

    self.init();
}]);

app.controller("DirectContentController", ["$scope", "$uibModalInstance", "data", function ($scope, $uibModalInstance, data) {
    var vm = this;
    vm.data = data;
    vm.data.title = "Respuesta recibida";

    setTimeout(function () {
        console.log(vm);
        document.getElementById("modal-content").innerHTML = vm.data.content;
    }, 500);

    vm.cancel = function () {
        $uibModalInstance.dismiss('cancel');
    };
}]);

window.DIC = null;
window.warnDIC = {};

app.filter('lang', function () {
    filt.$stateful = true;
    return filt;

    function filt(label) {
        if (window.DIC == null) return;
        if (window.DIC[label]) return window.DIC[label];
        if (!window.warnDIC[label]) {
            console.warn("Cannot find translation for ", label);
            window.warnDIC[label] = true;
        }
        return label;
    }
});

var indexById = function indexById(arr, id) {
    return arr.findIndex(function (e) {
        return e.id == id;
    });
};

app.directive('bindHtmlCompile', ['$compile', function ($compile) {
    return {
        restrict: 'A',
        link: function link(scope, element, attrs) {
            scope.$watch(function () {
                return scope.$eval(attrs.bindHtmlCompile);
            }, function (value) {
                element.html(value && value.toString());
                var compileScope = scope;
                if (attrs.bindHtmlScope) {
                    compileScope = scope.$eval(attrs.bindHtmlScope);
                }
                $compile(element.contents())(compileScope);
            });
        }
    };
}]);

app.filter('linkfy', function () {
    var replacePattern1 = /(\b(https?|ftp):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/gim;
    var replacePattern2 = /(^|[^\/])(www\.[\S]+(\b|$))/gim;
    var replacePattern3 = /(\w+@[a-zA-Z_]+?\.[a-zA-Z]{2,6})/gim;

    return function (text, target, otherProp) {
        if (text == null) return text;
        angular.forEach(text.match(replacePattern1), function (url) {
            text = text.replace(replacePattern1, "<a href=\"$1\" target=\"_blank\">$1</a>");
        });
        angular.forEach(text.match(replacePattern2), function (url) {
            text = text.replace(replacePattern2, "$1<a href=\"http://$2\" target=\"_blank\">$2</a>");
        });
        angular.forEach(text.match(replacePattern3), function (url) {
            text = text.replace(replacePattern3, "<a href=\"mailto:$1\">$1</a>");
        });
        // console.log("HOLA");
        return text;
    };
});