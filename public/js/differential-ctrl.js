"use strict";

let BASE_APP = "https://saduewa.dcc.uchile.cl:8888/Readings/";

let app = angular.module("Differential", ['ui.tree', 'btford.socket-io', "timer", "ui-notification"]);

app.factory("$socket", ["socketFactory", function (socketFactory) {
    return socketFactory();
}]);

app.controller("DifferentialController", ["$scope", "$http", "$timeout", "$socket", "Notification", "$sce", function ($scope, $http, $timeout, $socket, Notification, $sce) {
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
    self.tmId = -1;
    self.sesId = -1;
    self.finished = false;

    self.userAnon = {};

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
        $socket.on("chatMsg", (data) => {
            console.log("SOCKET.IO", data);
            if (data.ses == self.sesId && data.tmid == self.tmId && self.iteration == 3) {
                updateChat();
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
            // self.useConfidence = (data.options != null && data.options.includes("C"));
            if (self.iteration > 1) {
                $http({url: "get-team-diff-selection", method: "post", data: {iteration: 1}}).success((data) => {
                    data.forEach((ans) => {
                        self.ansIter1[ans.did] = self.ansIter1[ans.did] || [];
                        self.ansIter1[ans.did].push({select: ans.sel, comment: ans.comment, uid: ans.uid});
                    });
                });
                $http.post("get-anon-team").success((data) => {
                    let alph = ["A", "B", "C", "D", "E"];
                    data.forEach((u,i) => {
                        self.userAnon[u.id] = alph[i];
                        self.tmId = u.tmid;
                    });
                });
            }
            if (self.iteration > 2) {
                $http({url: "get-team-diff-selection", method: "post", data: {iteration: 2}}).success((data) => {
                    data.forEach((ans) => {
                        self.ansIter2[ans.did] = self.ansIter2[ans.did] || [];
                        self.ansIter2[ans.did].push({select: ans.sel, comment: ans.comment, uid: ans.uid});
                    });
                });
                updateChat();
            }
            if (self.iteration >= 4) {
                self.finished = true;
            }
            if(self.iteration > 0) {
                self.loadDocuments();
                self.loadDifferentials();
            }
        });
    };

    let updateChat = () => {
        $http.post("get-chat-msgs").success((data) => {
            self.chatMsgs = {};
            data.forEach(msg => {
                let df = self.dfs.find(e => e.id == msg.did);
                df.c = df.c ? df.c + 1 : 1;
                self.chatMsgs[msg.did] = self.chatMsgs[msg.did] || [];
                self.chatMsgs[msg.did].push(msg);
            })
        });
    };

    self.getMe = () => {
        $http.post("get-my-name").success((data) => {
            self.lang = data.lang;
            self.updateLang(self.lang);
        });
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

    self.loadDocuments = () => {
        $http({url: "get-documents", method: "post"}).success((data) => {
            self.documents = data;
        });
    };

    self.loadDifferentials = () => {
        $http({url: "get-differentials", method: "post"}).success((data) => {
            self.dfs = data;
            self.loadDiffSelection();
        });
    };

    self.loadDiffSelection = () => {
        let postdata = {
            iteration: self.iteration
        };
        $http.post("get-diff-selection", postdata).success((data) => {
            data.forEach(d => {
                let df = self.dfs.find(e => d.did == e.id);
                df.select = d.sel;
                df.comment = d.comment;
            });
        });
    };

    self.selectDocument = (i) => {
        self.selectedDocument = i;
        self.showDoc = true;
    };

    self.selectDF = (i) => {
        self.selectedDF = i;
        self.dfs[self.selectedDF].c = 0;
        self.showDoc = false;
        self.chatmsg = "";
    };

    self.sendDFSel = () => {
        let df = self.dfs[self.selectedDF];
        if(df.select == null || df.select == -1 || df.comment == null || df.comment == ""){
            notify("Error", "El diferencial no está completo");
            return;
        }
        let postdata = {
            sel: df.select,
            comment: df.comment,
            did: df.id,
            iteration: self.iteration
        };
        $http.post("send-diff-selection", postdata).success((data) => {
            df.dirty = false;
        });
    };

    self.finishState = () => {
        if(self.finished){
            return;
        }
        if(self.iteration <= 3) {
            if (self.dfs.some(e => e.id == null)) {
                notify("Error", "Falta responder algunos diferenciales semánticos");
                return;
            }
        }
        let confirm = window.confirm("¿Esta seguro que desea terminar la actividad?\nEsto implica no volver a poder editar sus respuestas");
        if(confirm) {
            let postdata = {status: self.iteration + 2};
            $http({url: "record-finish", method: "post", data: postdata}).success((data) => {
                self.hasFinished = true;
                self.finished = true;
                console.log("FINISH");
                //if(self.iteration == 3)
                //    self.updateSignal();
            });
        }
    };

    self.sendChatMsg = () => {
        let postdata = {
            did: self.dfs[self.selectedDF].id,
            content: self.chatmsg,
            tmid: self.tmId
        };
        $http.post("add-chat-msg", postdata).success(data => {
            self.chatmsg = "";
        });
    };

    self.getDocURL = () => {
        return $sce.trustAsResourceUrl("https://docs.google.com/viewer?url=" + BASE_APP + self.documents[self.selectedDocument].path + "&embedded=true");
    };

    self.dfSelect = (i) => {
        self.dfs[self.selectedDF].select = i;
        self.dfs[self.selectedDF].dirty = true;
    };

    let notify = (title, message, closable) => {
        $uibModal.open({
            template: '<div><div class="modal-header"><h4>' + title + '</h4></div><div class="modal-body"><p>' +
                message + '</p></div></div>'
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

    self.init();

}]);

window.DIC = null;
window.warnDIC = {};

app.filter('lang', function(){
    filt.$stateful = true;
    return filt;

    function filt(label){
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
});

let indexById = (arr, id) => {
    return arr.findIndex(e => e.id == id);
};