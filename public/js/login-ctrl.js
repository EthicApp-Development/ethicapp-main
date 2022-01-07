"use strict";
var adpp = angular.module("Login",[]);


window.DIC = "data/" + "english" + ".json";
adpp.controller('LoginController', ['$scope','$http',function ($scope,$http, Login) 
{
    var self = $scope;
    self.lang = "english";


    self.init = function () {
        self.updateLang(self.lang);
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



    self.init();
}]);