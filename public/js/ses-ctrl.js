"use strict";

let adpp = angular.module("SesList", ["ui.bootstrap",'btford.socket-io']);

adpp.factory("$socket", ["socketFactory", function (socketFactory) {
    return socketFactory();
}]);

adpp.controller("SesListController", ["$scope", "$http", "$socket", "$uibModal", function ($scope, $http, $socket, $uibModal) {
    let self = $scope;
    self.sessions = [];
    self.sesOpen = false;
    self.invCode = "";
    self.showCodeError = false;
    self.routes= {
        L: "to-visor",
        M: "to-semantic",
        S: "to-select",
        E: "to-differential"
    };

    self.init = () => {
        self.updateSessions();
        $socket.on("stateChange", (data) => {
            console.log("SOCKET.IO", data);
            self.updateSessions();
        });
        self.showName();
    };

    self.showName = () => {
        $http.post("get-my-name").success((data) => {
            self.username = data.name;
            self.mylang = data.lang;
        });
    };

    self.updateSessions = () => {
        $http({url: "get-session-list", method: "post"}).success((data) => {
            self.sessions = data;
        });
    };

    self.openSes = () => {
        self.sesOpen = true;
    };

    self.enterCode = () => {
        if(self.checkCode(self.invCode.toLowerCase())) {
            let postdata = {code: self.invCode.toLowerCase()};
            $http.post("enter-session-code", postdata).success((data) => {
                if (data.status == "ok") {
                    window.location.replace(data.redirect);
                }
                else {
                    $uibModal.open({
                        template: '<div><div class="modal-header"><h4>Error</h4></div><div class="modal-body">' +
                            '<p>El código ingresado no es válido</p></div></div>'
                    });
                }
            });
        }
    };

    self.checkCode = (code) => {
        console.log(self.sessions, code);
        let s = self.sessions.find(e => e.code == code);
        console.log(s);
        if(s == null)
            return true;
        let url = self.routes[s.type]+ "?sesid=" + s.id;
        window.location.replace(url);
        return false;
    };

    self.changeLang = () => {
        let newlang = (self.mylang == "english") ? "spanish" : "english";
        $http.post("update-lang", {lang: newlang}).success((data) => {
            self.showName();
        });
    };

    self.init();
}]);