"use strict";

let app = angular.module("Admin", []);

app.controller("AdminController", function ($scope, $http) {
    let self = $scope;
    self.sessions = [];
    self.selectedSes = null;
    self.selectedIndex = -1;
    self.sesStatusses = ["No Publicada", "Lectura", "Edición", "Finalizada"];

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

app.controller("SesEditorController", function($scope,$http){
    let self = $scope;

    self.updateSession = () => {
        if(self.selectedSes.name.length < 3 || self.selectedSes.descr.length < 5) return;
        let postdata = {name: self.selectedSes.name, descr: self.selectedSes.descr, id: self.selectedSes.id};
        $http({url: "update-session", method: "post", data: postdata}).success((data) => {
            console.log("Session updated");
        });
    };
});