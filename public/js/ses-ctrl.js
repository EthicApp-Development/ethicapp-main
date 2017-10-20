"use strict";

let adpp = angular.module("SesList", ['btford.socket-io']);

adpp.factory("$socket", ["socketFactory", function (socketFactory) {
    return socketFactory();
}]);

adpp.controller("SesListController", ["$scope", "$http", "$socket", function ($scope, $http, $socket) {
    let self = $scope;
    self.sessions = [];
    self.sesOpen = false;

    self.init = () => {
        self.updateSessions();
        $socket.on("stateChange", (data) => {
            console.log("SOCKET.IO", data);
            self.updateSessions();
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

    self.init();
}]);