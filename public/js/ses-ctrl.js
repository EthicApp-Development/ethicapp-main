"use strict";

let app = angular.module("SesList", []);

app.controller("SesListController", function ($scope, $http) {
    let self = $scope;
    self.sessions = [];
    self.sesOpen = false;

    self.init = () => {
        $http({url: "get-session-list", method: "post"}).success((data) => {
            self.sessions = data;
        });
    };

    self.openSes = () => {
        self.sesOpen = true;
    };

    self.init();
});