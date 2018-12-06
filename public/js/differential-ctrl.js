"use strict";

let app = angular.module("Differential", ['ui.tree', 'btford.socket-io', "timer", "ui-notification"]);

app.factory("$socket", ["socketFactory", function (socketFactory) {
    return socketFactory();
}]);

app.controller("DifferentialController", ["$scope", "$http", "$timeout", "$socket", "Notification", function ($scope, $http, $timeout, $socket, Notification) {
    let self = $scope;

    self.iteration = 1;
    self.myUid = -1;
    self.documents = [];
    self.dfs = [];
    self.showDoc = true;
    self.selectedDocument = 0;
    self.selectedDF = 0;

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
        /*$socket.on("teamProgress", (data) => {
            console.log("SOCKET.IO", data);
            if (data.ses == self.sesId && data.tmid == self.teamId && self.iteration == 3) {
                self.updateTeam();
            }
        });*/
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
            /*if (self.iteration > 1) {
                $http({url: "get-team-selection", method: "post", data: {iteration: 1}}).success((data) => {
                    data.forEach((ans) => {
                        self.ansIter1[ans.qid] = self.ansIter1[ans.qid] || {};
                        self.ansIter1[ans.qid][ans.uid] = {answer: ans.answer, comment: ans.comment};
                        set.add(ans.uid);
                    });
                    self.teamUids = Array.from(set);
                    self.shared.updateOverlayList();
                });
            }
            if (self.iteration > 2) {
                $http({url: "get-team-selection", method: "post", data: {iteration: 2}}).success((data) => {
                    data.forEach((ans) => {
                        self.ansIter2[ans.qid] = self.ansIter2[ans.qid] || {};
                        self.ansIter2[ans.qid][ans.uid] = {answer: ans.answer, comment: ans.comment};
                        set.add(ans.uid);
                    });
                    self.teamUids = Array.from(set);
                });
                self.updateTeam();
                self.shared.updateOverlayList();
            }
            if (self.iteration >= 4) {
                self.finished = true;
                self.loadAnskey();
            }*/
            if(self.iteration > 0) {
                self.loadDocuments();
                self.loadDifferentials();
            }
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
        });
    };

    self.selectDocument = (i) => {
        self.selectedDocument = i;
        self.showDoc = true;
    };

    self.selectDF = (i) => {
        self.selectedDF = i;
        self.showDoc = false;
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