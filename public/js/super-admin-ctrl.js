"use strict";

let app = angular.module("SuperAdmin", []);

app.controller("SuperAdminController", function ($scope, $http) {

    let self = $scope;

    self.sec = -1;
    self.newProfAc = true;
    self.alumUsers = [];
    self.profUsers = [];
    self.selectedUser = null;
    self.search = "";


    self.setSec = (idx) => {
        self.sec = idx;
        if(idx == 0) self.getStats();
    };

    self.getStats = () => {
        $http.get("stats").success((data) => {
            self.sts = {
                alive:  data.check.ping,
                memory: data.memory.process.heapUsed / 1024 / 1024,
                cpu:    data.cpu["1m"][0],
                uptime: data.uptime.process
            };
        });
    };

    self.getUsers = () => {
        $http.post("/get-all-users").success((data) => {
            self.alumUsers = data.filter(e => e.role == "A");
            self.profUsers = data.filter(e => e.role == "P");
        });
    };

    self.convertUser = () => {
        let postdata = {
            uid: self.selectedUser
        };
        $http.post("/convert-prof", postdata).success((data) => {
            self.getUsers();
            alert("Profesor creado correctamente");
        });
    };

    self.removeProf = (uid) => {
        if(!window.confirm("Estas seguro de eliminar la cuenta de profesor?"))
            return;
        let postdata = {
            uid: uid
        };
        $http.post("/remove-prof", postdata).success((data) => {
            self.getUsers();
            alert("Profesor eliminado correctamente");
        });
    };

    self.selectUser = (uid) => {
        self.selectedUser = uid;
    };

    self.superLogin = (uid) => {
        if(!window.confirm("Estas seguro de entrar como la cuenta de profesor?"))
            return;
        let postdata = {
            uid: uid
        };
        $http.post("/super-login-as", postdata).success((data) => {
            window.location.replace("/");
        });
    };

    self.getUsers();

});

app.controller("instituciones",["$scope","$http",function($scope,$http,Admin){
    var self = $scope;
    self.accepted = [];
    self.pending = [];
    self.institutions = [];

    self.init = function () {
        self.get_temporary_institutions();
    };



    self.get_temporary_institutions = function() {
        var postdata = 500;
        $http({ url: "get_temporary_institutions", method: "post",data: postdata }).success(function (data) {
            var inst = [];
            if(data != null){
                for(var i = 0;i < data.data.rows.length ;i++){
                    inst.push(data.data.rows[i]);
                }
                self.institutions = inst;
                console.log(data.data.rows[0]);
            }
        });
    };


    self.init();
}]);
