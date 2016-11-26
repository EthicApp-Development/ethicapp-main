"use strict";

let app = angular.module("Admin", []);

app.controller("AdminController", function ($scope, $http) {
    let self = $scope;
    self.sessions = [];
    self.selectedSes = null;
    self.selectedIndex = -1;

    self.init = () => {
        $http({url: "get-session-list", method: "post"}).success((data) => {
            self.sessions = data;
        });
    };

    self.selectSession = (idx) => {
        self.selectedIndex = idx;
        self.selectedSes = self.sessions[idx];
    };

    self.init();
});


app.controller("TabsController", function($scope, $http){
    let self = $scope;
    self.tabOptions = ["Editar","Usuarios","Dashboard","Visor"];
    self.selectedTab = 0;

    self.setTab = (idx) => {
        self.selectedTab = idx;
    };

});