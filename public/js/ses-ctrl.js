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
        let postdata = {code: self.invCode.toLowerCase()};
        $http.post("enter-session-code", postdata).success((data) => {
            if(data.status == "ok"){
                window.location.replace(data.redirect);
            }
            else{
                $uibModal.open({
                    template: '<div><div class="modal-header"><h4>Error</h4></div><div class="modal-body">' +
                        '<p>El código ingresado no es válido</p></div></div>'
                });
            }
        });
    };

    self.init();
}]);