"use strict";

let BASE_APP = window.location.href.replace("differential", "");

let app = angular.module("Differential", [
    "ngSanitize", "ui.bootstrap", "ui.tree", "btford.socket-io", "timer", "ui-notification",
    "luegg.directives"
]);

app.factory("$socket", ["socketFactory", function (socketFactory) {
    return socketFactory();
}]);

app.controller("DifferentialController", [
    "$scope", "$http", "$timeout", "$socket", "Notification", "$sce", "$uibModal",
    function ($scope, $http, $timeout, $socket, Notification, $sce, $uibModal) {
        let self = $scope;

        self.iteration = 1;
        self.myUid = -1;
        self.documents = [];
        self.dfs = [];
        self.showDoc = true;
        self.selectedDocument = 0;
        self.selectedDF = 0;

        self.ansIter1 = {};
        self.ansIter2 = {};
        self.chatMsgs = {};
        self.chatmsg = "";
        self.chatmsgreply = null;
        self.tmId = -1;
        self.sesId = -1;
        self.finished = false;

        self.chatExp = true;

        self.userAnon = {};

        self.sesStatusses = ["individual", "anon", "discussion", "finished"];

        self.lang = "ES_CL/spanish";

        self.init = () => {
            self.getSesInfo();
            $socket.on("stateChange", (data) => {
                //console.log("SOCKET.IO", data);
                if (data.ses == self.sesId) {
                    window.location.reload();
                }
            });
            $socket.on("chatMsg", (data) => {
                //console.log("SOCKET.IO", data);
                if (data.ses == self.sesId && data.tmid == self.tmId && self.iteration == 3) {
                    updateChat();
                }
            });
            $socket.on("diffReceived", (data) => {
                //console.log("SOCKET.IO", data);
                if(data.ses == self.sesId){
                    self.openDetails(data);
                }
            });
            self.getMe();
        };

        self.getSesInfo = async () => {
            try {
                const sesInfo = await $http({ url: "get-ses-info", method: "post" });
                const data = sesInfo.data;
                self.iteration = data.iteration + 1;
                self.myUid = data.uid;
                self.sesName = data.name;
                self.sesId = data.id;
                self.sesSTime = data.stime;
                self.sesDescr = data.descr;
        
                // Load additional data based on iteration
                if (self.iteration > 1) {
                    const teamDiff1 = await $http({
                        url: "get-team-diff-selection",
                        method: "post",
                        data: { iteration: 1 }
                    });
                    teamDiff1.data.forEach((ans) => {
                        self.ansIter1[ans.did] = self.ansIter1[ans.did] || [];
                        self.ansIter1[ans.did].push({
                            select: ans.sel,
                            comment: ans.comment,
                            uid: ans.uid
                        });
                    });
                }
        
                if (self.iteration > 2) {
                    const teamDiff2 = await $http({
                        url: "get-team-diff-selection",
                        method: "post",
                        data: { iteration: 2 }
                    });
                    teamDiff2.data.forEach((ans) => {
                        self.ansIter2[ans.did] = self.ansIter2[ans.did] || [];
                        self.ansIter2[ans.did].push({
                            select: ans.sel,
                            comment: ans.comment,
                            uid: ans.uid
                        });
                    });
                }
        
                if (self.iteration >= 4) {
                    self.finished = true;
                }
        
                if (self.iteration > 0) {
                    await self.loadDocuments();
                    await self.loadDifferentials();
                    
                    const anonTeamData = await $http.post("get-anon-team");
                    let alph = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                    anonTeamData.data.forEach((u, i) => {
                        self.userAnon[u.id] = alph[i];
                        self.tmId = u.tmid;
                    });
                }
            } catch (error) {
                console.error("Error loading session information:", error);
                Notification.error("Failed to load session information");
            }
        };
        
        async function updateChat(count) {
            try {
                const response = await $http.post("get-chat-msgs");
                const data = response.data;
        
                self.chatMsgs = {};
                self.dfs.forEach(e => {
                    e.c = 0;
                });
        
                data.forEach(msg => {
                    let df = self.dfs.find(e => e.id === msg.did);
                    df.c = (df.c || 0) + 1;
                    
                    if (count || df.id === self.dfs[self.selectedDF].id) {
                        df.cr = df.c;
                    }
        
                    if (msg.parent_id) {
                        msg.parent = data.find(e => e.id === msg.parent_id);
                    }
        
                    self.chatMsgs[msg.did] = self.chatMsgs[msg.did] || [];
                    self.chatMsgs[msg.did].push(msg);
                });
            } catch (error) {
                console.error("Error fetching chat messages:", error);
                Notification.error("Failed to load chat messages");
            }
        }
        
        self.getMe = async () => {
            try {
                const response = await $http.post("get-my-name");
                const data = response.data;
                self.lang = data.lang === "spanish" ? "ES_CL/spanish" : "EN_US/english";
                await self.updateLang(self.lang);
            } catch (error) {
                console.error("Error fetching user information:", error);
                Notification.error("Failed to load user information");
            }
        };
        
        /*self.updateTeam = () => {
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
        };*/

        self.loadDocuments = async () => {
            try {
                const response = await $http({ url: "get-documents", method: "post" });
                self.documents = response.data;
            } catch (error) {
                console.error("Error loading documents:", error);
                Notification.error("Failed to load documents");
            }
        };
        
        self.loadDifferentials = async () => {
            try {
                const response = await $http({ url: "get-differentials", method: "post" });
                self.dfs = response.data;
                await self.loadDiffSelection();
                await updateChat(true);
            } catch (error) {
                console.error("Error loading differentials:", error);
                Notification.error("Failed to load differentials");
            }
        };
        
        self.loadDiffSelection = async () => {
            try {
                const postdata = { iteration: self.iteration };
                const response = await $http.post("get-diff-selection", postdata);
                
                response.data.forEach(d => {
                    let df = self.dfs.find(e => d.did === e.id);
                    if (df) {
                        df.select = d.sel;
                        df.comment = d.comment;
                    }
                });
            } catch (error) {
                console.error("Error loading differential selections:", error);
                Notification.error("Failed to load differential selections");
            }
        };
        
        self.selectDocument = (i) => {
            self.selectedDocument = i;
            self.showDoc = true;
        };

        self.selectDF = (i) => {
            if(self.dfs[self.selectedDF].dirty){
                notify("Error", "Debe completar el diferencial antes de cambiar");
                return;
            }
            self.selectedDF = i;
            self.dfs[self.selectedDF].cr = self.dfs[self.selectedDF].c;
            self.showDoc = false;
            self.chatmsg = "";
        };

        self.sendDFSel = async () => {
            let df = self.dfs[self.selectedDF];
            
            if (df.select == null || df.select === -1 || !df.comment) {
                notify("Error", "El diferencial no está completo");
                return;
            }
        
            let postdata = {
                sel: df.select,
                comment: df.comment,
                did: df.id,
                iteration: self.iteration
            };
        
            try {
                await $http.post("send-diff-selection", postdata);
                df.dirty = false;
            } catch (error) {
                console.error("Error sending differential selection:", error);
                Notification.error("Failed to send differential selection");
            }
        };
        
        self.finishState = async () => {
            if (self.finished) {
                return;
            }
        
            // Check if all differentials are answered when iteration is less than or equal to 3
            if (self.iteration <= 3 && self.dfs.some(e => e.id == null)) {
                notify("Error", "Falta responder algunos diferenciales semánticos");
                return;
            }
        
            // Confirm if the user wants to finish the activity
            const confirmFinish = window.confirm(
                "¿Está seguro que desea terminar la actividad?\n" +
                "Esto implica no volver a poder editar sus respuestas"
            );
        
            if (confirmFinish) {
                const postdata = { status: self.iteration + 2 };
                try {
                    await $http({ url: "record-finish", method: "post", data: postdata });
                    self.hasFinished = true;
                    self.finished = true;
                    // Uncomment the following lines if necessary
                    // if (self.iteration === 3) {
                    //     self.updateSignal();
                    // }
                } catch (error) {
                    console.error("Error finishing activity:", error);
                    Notification.error("Error al finalizar la actividad");
                }
            }
        };
        
        self.sendChatMsg = async () => {
            const postdata = {
                did:       self.dfs[self.selectedDF].id,
                content:   self.chatmsg,
                tmid:      self.tmId,
                parent_id: self.chatmsgreply
            };
        
            try {
                await $http.post("add-chat-msg", postdata);
                // Clear the input fields after successful submission
                self.chatmsg = "";
                self.chatmsgreply = null;
            } catch (error) {
                console.error("Error sending chat message:", error);
                Notification.error("Error al enviar el mensaje de chat");
            }
        };
        
        self.getDocURL = () => {
            return $sce.trustAsResourceUrl(
                "https://docs.google.com/viewer?url=" + BASE_APP +
                self.documents[self.selectedDocument].path + "&embedded=true"
            );
        };

        self.dfSelect = (i) => {
            if(self.finished || self.hasFinished)
                return;
            self.dfs[self.selectedDF].select = i;
            self.dfs[self.selectedDF].dirty = true;
        };

        function notify (title, message)  {
            $uibModal.open({
                template: `
                <div>
                    <div class="modal-header">
                        <h4> ${title} </h4>
                    </div>
                    <div class="modal-body">
                        <p> ${message} </p>
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
                console.error("Error updating language data:", error);
                Notification.error("Error al cargar los datos del idioma");
            }
        };
        
        self.changeLang = () => {
            self.lang = (self.lang == "EN_US/english") ? "ES_CL/spanish" : "EN_US/english";
            self.updateLang(self.lang);
        };

        self.openDetails = (data) => {
            $uibModal.open({
                templateUrl:  "../../frontend/static/direct-content.html",
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

        self.init();
    }
]);

app.controller("DirectContentController", [
    "$scope", "$uibModalInstance", "data",
    function ($scope, $uibModalInstance, data) {
        var vm = this;
        vm.data = data;
        vm.data.title = "Diferencial recibido";

        setTimeout(() => {
            //console.log(vm);
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

    return function(text) {
        if(text == null) return text;
        angular.forEach(text.match(replacePattern1), function() {
            text = text.replace(replacePattern1, "<a href=\"$1\" target=\"_blank\">$1</a>");
        });
        angular.forEach(text.match(replacePattern2), function() {
            text = text.replace(
                replacePattern2, "$1<a href=\"http://$2\" target=\"_blank\">$2</a>"
            );
        });
        angular.forEach(text.match(replacePattern3), function() {
            text = text.replace(replacePattern3, "<a href=\"mailto:$1\">$1</a>");
        });
        return text;
    };
});
