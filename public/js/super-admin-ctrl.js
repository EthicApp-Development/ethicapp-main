"use strict";

let app = angular.module("SuperAdmin", []);

app.controller("SuperAdminController", function ($scope, $http) {

    let self = $scope;

    self.sec = -1;

    self.setSec = (idx) => {
        self.sec = idx;
        if(idx == 0) self.getStats();
    };

    self.getStats = () => {
        $http.get("stats").success((data) => {
            self.sts = {
                alive: data.check.ping,
                memory: data.memory.process.heapUsed / 1024 / 1024,
                cpu: data.cpu["1m"][0],
                uptime: data.uptime.process
            };
        });
    };

});