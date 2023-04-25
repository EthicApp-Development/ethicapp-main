"use strict";

var BASE_APP = window.location.href.replace("ethics", "");

var app = angular.module(
    "Ethics",
    ["ngSanitize", "ui.bootstrap", "ui.tree", "btford.socket-io",
        "angular-intro", "ui-notification", "luegg.directives"]);

app.factory("$socket", ["socketFactory", function (socketFactory) {
    return socketFactory();
}]);

app.controller(
    "EthicssController",
    ["$scope", "$http", "$timeout", "$socket", "Notification", "$sce", "$uibModal","ngIntroService",
        function ($scope, $http, $timeout, $socket, Notification, $sce, $uibModal, ngIntroService) {
            var self = $scope;

            self.iteration = 1;
            self.myUid = -1;
            self.documents = [];
            self.showDoc = true;
            self.selectedDocument = 0;
            self.finished = false;
            self.sesId = -1;
            self.chatExp = false;

            self.stages = [];
            self.currentStageId = 0;
            self.currentStage = null;
            self.stagesMap = {};

            self.selectedStage = null;

            self.dfs = [];
            self.sel = [];

            self.dfsPrev = [];
            self.selPrev = [];

            self.selections = [];

            self.chatMsgs = {};
            self.chatMsgsPrev = {};
            self.chatmsg = "";
            self.chatmsgreply = null;

            self.tmId = -1;
            self.teamMap = {};

            self.lang = "spanish";
            self.selectedDF = null;
            self.selectedDFPrev = null;

            self.init = function () {
                self.getSesInfo();
                $socket.on("stateChange", function (data) {
                    console.log("SOCKET.IO", data);
                    if (data.ses == self.sesId) {
                        window.location.reload();
                    }
                });
                $socket.on("chatMsg", function (data) {
                    console.log("SOCKET.IO", data);
                    if (data.tmid == self.tmId && self.currentStage.chat) {
                        updateChat();
                    }
                });
                $socket.on("diffReceived", function (data) {
                    console.log("SOCKET.IO", data);
                    if (data.ses == self.sesId) {
                        console.log("Open");
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
                    if (self.iteration > 1) {
                        self.finished = true;
                    }
                    if (self.currentStageId != null || self.iteration >= 1) {
                        self.loadDocuments();
                        self.loadStageData();
                    }
                });
            };

            var updateChat = function updateChat(count) {
                $http.post("get-diff-chat-stage",
                    { stageid: self.currentStageId }).success(function (data) {
                    self.chatMsgs = {};
                    self.dfs.forEach(function (e) {
                        e.c = 0;
                    });
                    data.forEach(function (msg) {
                        var df = self.dfs.find(function (e) {
                            return e.id == msg.did;
                        });
                        df.c = df.c ? df.c + 1 : 1;
                        if (count || df.id == self.selectedDF) df.cr = df.c;
                        if (msg.parent_id) msg.parent = data.find(function (e) {
                            return e.id == msg.parent_id;
                        });
                        self.chatMsgs[msg.did] = self.chatMsgs[msg.did] || [];
                        self.chatMsgs[msg.did].push(msg);
                    });
                    self.dfs.forEach(function (e) {
                        e.cr = e.cr == null ? e.c : e.cr;
                    });
                    if (self.dfs.length==1){
                        self.openChat(self.dfs[0]);
                    }
                });
            };

            self.openChat = function (df) {
                self.selDF = df;
                self.selectedDF = df.id;
                self.chatExp = true;
                df.cr = df.c;
            };

            self.getMe = function () {
                $http.post("get-my-name").success(function (data) {
                    self.lang = data.lang;
                    self.updateLang(self.lang);
                });
            };

            // self.selectDF = (i) => {
            //     self.selectedDF = i;
            // };
            //
            // self.selectDFView = (i) => {
            //     self.selectedDFPrev = i;
            // };

            self.loadDocuments = function () {
                $http({ url: "get-documents", method: "post" }).success(function (data) {
                    self.documents = data;
                });
            };

            self.loadStageData = function () {
                $http.post("get-stages", {}).success(function (data) {
                    self.stages = data;
                    console.log(self.stages);
                    self.selectStage2(self.stages.find(e => e.id == self.currentStageId).number-1);

                    self.currentStage = self.stages.find(function (e) {
                        return e.id == self.currentStageId;
                    });
                    self.stagesMap = {};
                    data.forEach(function (s) {
                        self.stagesMap[s.id] = s;
                    });

                    if (self.currentStage && self.currentStage.type == "team") {
                        $http.post("get-team-stage",
                            { stageid: self.currentStageId }).success(function (data) {
                            self.team = data;
                            self.teamMap = {};
                            var alph = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                            data.forEach(function (u, i) {
                                self.teamMap[u.id] = self.currentStage.anon ? alph[i] : u.name;
                                self.tmId = u.tmid;
                            });
                        });
                        if (self.currentStage.prev_ans != "" && 
                        self.currentStage.prev_ans != null) {
                            var p = {
                                stageid:    self.currentStageId,
                                prevstages: self.currentStage.prev_ans
                            };
                            // TODO : Refactor to DF
                            $http.post("get-team-differential-selection", p)
                                .success(function (data) {
                                    self.teamSel = data;
                                    self.structureSelData();
                                });
                        }
                        if (self.currentStage.chat) {
                            updateChat();
                        }
                    }
                });
                if (self.currentStageId != null) {
                    $http.post("get-differentials-stage", 
                        { stageid: self.currentStageId }).success(function (data) {
                        self.dfs = data;
                        if (self.dfs.length > 0 && self.sel.length > 0) {
                            self.populateDFs();
                        }
                    });
                    $http.post("get-diff-selection-stage", 
                        { stageid: self.currentStageId }).success(function (data) {
                        self.sel = data;
                        if (self.dfs.length > 0 && self.sel.length > 0) {
                            self.populateDFs();
                        }
                    });
                }

            };

            self.populateDFs = function () {
                self.sel.forEach(function (s) {
                    var a = self.dfs.find(function (e) {
                        return e.id == s.did;
                    });
                    a.comment = s.comment;
                    a.select = s.sel;
                    a.sent = s.comment != "" && s.comment != null;
                });
            };

            self.populateDFsPrev = function () {
                self.selPrev.forEach(function (s) {
                    var a = self.dfsPrev.find(function (e) {
                        return e.id == s.did;
                    });
                    if (a) {
                        a.comment = s.comment;
                        a.select = s.sel;
                        a.sent = s.comment != "" && s.comment != null;
                    }
                });
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
            };

            self.selectStage = function (i) {
                if (self.stages[self.selectedStage] && self.stages[self.selectedStage].dirty) {
                    notify("Error", "Debe completar el diferencial antes de cambiar");
                    return;
                }
                self.selectedStage = i;
                self.stages[self.selectedStage].cr = self.stages[self.selectedStage].c;
                self.showDoc = false;
                self.chatmsg = "";
                self.selPrev = [];
                self.dfsPrev = [];
                self.chatMsgsPrev = {};

                $http.post("get-differentials-stage", 
                    { stageid: self.stages[self.selectedStage].id }).success(function (data) {
                    self.dfsPrev = data;
                    if (self.selPrev.length == self.dfsPrev.length && self.selPrev.length > 0) {
                        self.populateDFsPrev();
                    }
                });
                $http.post("get-diff-selection-stage", 
                    { stageid: self.stages[self.selectedStage].id }).success(function (data) {
                    self.selPrev = data;
                    if (self.selPrev.length == self.dfsPrev.length && self.dfsPrev.length > 0) {
                        self.populateDFsPrev();
                    }
                });

                var st = self.stages[self.selectedStage];
                self.teamPrev = [];
                self.teamMapPrev = {};
                self.teamSelPrev = [];
                self.prevResPrev = {};
                self.prevStagesPrev = {};

                if (st.type == "team") {
                    $http.post("get-team-stage", { stageid: st.id }).success(function (data) {
                        self.teamPrev = data;
                        self.teamMapPrev = {};
                        var alph = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                        data.forEach(function (u, i) {
                            self.teamMapPrev[u.id] = st.anon ? alph[i] : u.name;
                            self.tmId = u.tmid;
                        });
                    });
                    if (st.prev_ans != "" && st.prev_ans != null) {
                        var p = {
                            stageid:    st.id,
                            prevstages: st.prev_ans
                        };
                        $http.post("get-team-differential-selection", p).success(function (data) {
                            self.teamSelPrev = data;
                            self.structureSelDataPrev();
                        });
                    }
                }
                if (st.chat) {
                    $http.post("get-diff-chat-stage", {
                        stageid: st.id
                    }).success(function (data) {
                        self.chatMsgsPrev = {};
                        data.forEach(function (msg) {
                            if (msg.parent_id) msg.parent = data.find(function (e) {
                                return e.id == msg.parent_id;
                            });
                            self.chatMsgsPrev[msg.did] = self.chatMsgsPrev[msg.did] || [];
                            self.chatMsgsPrev[msg.did].push(msg);
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
                    self.showDoc = true;
                }
                else{
                    self.showDoc = false;

                }
                self.chatmsg = "";
                self.selPrev = [];
                self.dfsPrev = [];
                self.chatMsgsPrev = {};

                $http.post("get-differentials-stage", 
                    { stageid: self.stages[self.selectedStage].id }).success(function (data) {
                    self.dfsPrev = data;
                    if (self.selPrev.length == self.dfsPrev.length && self.selPrev.length > 0) {
                        self.populateDFsPrev();
                    }
                });
                $http.post("get-diff-selection-stage", 
                    { stageid: self.stages[self.selectedStage].id }).success(function (data) {
                    self.selPrev = data;
                    if (self.selPrev.length == self.dfsPrev.length && self.dfsPrev.length > 0) {
                        self.populateDFsPrev();
                    }
                });

                var st = self.stages[self.selectedStage];
                self.teamPrev = [];
                self.teamMapPrev = {};
                self.teamSelPrev = [];
                self.prevResPrev = {};
                self.prevStagesPrev = {};

                if (st.type == "team") {
                    $http.post("get-team-stage", { stageid: st.id }).success(function (data) {
                        self.teamPrev = data;
                        self.teamMapPrev = {};
                        var alph = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                        data.forEach(function (u, i) {
                            self.teamMapPrev[u.id] = st.anon ? alph[i] : u.name;
                            self.tmId = u.tmid;
                        });
                    });
                    if (st.prev_ans != "" && st.prev_ans != null) {
                        var p = {
                            stageid:    st.id,
                            prevstages: st.prev_ans
                        };
                        $http.post("get-team-differential-selection", p).success(function (data) {
                            self.teamSelPrev = data;
                            self.structureSelDataPrev();
                        });
                    }
                }
                if (st.chat) {
                    $http.post("get-diff-chat-stage", {
                        stageid: st.id
                    }).success(function (data) {
                        self.chatMsgsPrev = {};
                        data.forEach(function (msg) {
                            if (msg.parent_id) msg.parent = data.find(function (e) {
                                return e.id == msg.parent_id;
                            });
                            self.chatMsgsPrev[msg.did] = self.chatMsgsPrev[msg.did] || [];
                            self.chatMsgsPrev[msg.did].push(msg);
                        });
                    });
                }
            };

            self.sendDFSel = function (df) {
                if (df.select == null || df.select == -1) {
                    notify("Error", "El diferencial no está completo");
                    return;
                }
                var postdata = {
                    sel:       df.select,
                    comment:   df.comment,
                    did:       df.id,
                    iteration: 0
                };
                $http.post("send-diff-selection", postdata).success(function () {
                    df.dirty = false;
                    df.sent = true;
                });
                self.selectedDF = null;
            };

            self.sendChatMsg = function () {
                var postdata = {
                    did:       self.selectedDF,
                    content:   self.chatmsg,
                    tmid:      self.tmId,
                    parent_id: self.chatmsgreply
                };
                $http.post("add-chat-msg", postdata).success(function () {
                    self.chatmsg = "";
                    self.chatmsgreply = null;
                });
            };

            self.getDocURL = function () {
                return $sce.trustAsResourceUrl("https://docs.google.com/viewer?url=" + 
                BASE_APP + self.documents[self.selectedDocument].path + "&embedded=true");
            };

            var notify = function notify(title, message) {
                $uibModal.open({
                    template: '<div><div class="modal-header"><h4>' + title + 
                    '</h4></div><div class="modal-body"><p>' + message + "</p></div></div>"
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
                    templateUrl:  "templ/direct-content.html",
                    controller:   "DirectContentController",
                    controllerAs: "vm",
                    scope:        self,
                    resolve:      {
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
                    element: "#tabd0",
                    intro:   "En esta pestaña encontrarás el caso a leer"
                }, {
                    element: "#tabq0",
                    intro:   "En esta pestaña se encuentra la lista de items" + 
                    " que debes categorizar y justificar"
                }, {
                    element: "#seslistbtn",
                    intro:   "Usando este botón puedes volver a la lista de sesiones"
                }],
                showStepNumbers:    false,
                showBullets:        false,
                exitOnOverlayClick: true,
                exitOnEsc:          true,
                tooltipPosition:    "auto",
                nextLabel:          "Siguiente",
                prevLabel:          "Anterior",
                skipLabel:          "Salir",
                doneLabel:          "Listo"
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

            self.buildArray = function (n) {
                var a = [];
                for (var i = 1; i <= n; i++) {
                    a.push(i);
                }
                return a;
            };

            self.init();
        }]);

app.controller("DirectContentController",
    ["$scope", "$uibModalInstance", "data", function ($scope, $uibModalInstance, data) {
        var vm = this;
        vm.data = data;
        vm.data.title = "Diferencial recibido";

        setTimeout(function () {
            document.getElementById("modal-content").innerHTML = vm.data.content;
        }, 500);

        vm.cancel = function () {
            $uibModalInstance.dismiss("cancel");
        };
    }]);

window.DIC = null;
window.warnDIC = {};

app.filter("lang", function () {
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


app.directive("bindHtmlCompile", ["$compile", function ($compile) {
    return {
        restrict: "A",
        link:     function link(scope, element, attrs) {
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

app.filter("linkfy", function () {
    var replacePattern1 = /(\b(https?|ftp):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/gim;
    var replacePattern2 = /(^|[^\/])(www\.[\S]+(\b|$))/gim;
    var replacePattern3 = /(\w+@[a-zA-Z_]+?\.[a-zA-Z]{2,6})/gim;

    return function (text) {
        if (text == null) return text;
        angular.forEach(text.match(replacePattern1), function () {
            text = text.replace(replacePattern1, "<a href=\"$1\" target=\"_blank\">$1</a>");
        });
        angular.forEach(text.match(replacePattern2), function () {
            text = text.replace(replacePattern2, 
                "$1<a href=\"http://$2\" target=\"_blank\">$2</a>");
        });
        angular.forEach(text.match(replacePattern3), function () {
            text = text.replace(replacePattern3, "<a href=\"mailto:$1\">$1</a>");
        });
        return text;
    };
});