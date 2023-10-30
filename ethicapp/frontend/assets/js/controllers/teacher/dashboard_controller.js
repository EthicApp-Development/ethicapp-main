import { computeRankingFrequencyTable, computeIndTable, sortIndTable } from "../../libs/dashboards/ranking.js";
import { buildSemanticDifferentialsTable } from "../../libs/dashboards/semantic_differential.js";

/*eslint func-style: ["error", "expression"]*/
export let DashboardController = ($scope, ActivityStateService,
    $http, $timeout, $uibModal, Notification) => {
    
    var self = $scope;
    self.iterationIndicator = 1;
    self.currentTimer = null;
    self.showCf = false;
    self.dataDF = [];
    self.dataChatCount = {};

    self.shared.resetGraphs = function () { //THIS HAS TO BE CALLED ON ADMIN
        if (
            (self.selectedSes.type == "R") ||
            (self.selectedSes.type == "T") ||
            (self.selectedSes.type == "J")
        ) {
            self.iterationIndicator = self.selectedSes.current_stage || -1;
        }
        self.alumState = null;
        self.barOpts = {
            chart: {
                type:   "multiBarChart",
                height: 320,
                x:      function x(d) {
                    return d.label;
                },
                y: function y(d) {
                    return d.value;
                },
                showControls: false,
                showValues:   false,
                duration:     500,
                xAxis:        {
                    showMaxMin: false
                },
                yAxis: {
                    axisLabel: self.flang("students")
                }
            }
        };
        self.barData = [{ key: self.flang("students"), color: "#0077c1", values: [] }];
        self.updateState();
        if (ActivityStateService.dashboardAutoreload  && self.selectedSes.status < 9) {
            self.reload(true);
        }
    };

    self.reload = function (k) {
        if (!k) {
            self.updateState();
        }
        if (self.currentTimer != null) {
            $timeout.cancel(self.currentTimer);
        }
        self.currentTimer = $timeout(self.reload, 
            ActivityStateService.dashboardAutoreloadTime * 1000);
    };

    self.updateState = function () {
        if (self.selectedSes.status == 1) {
            self.shared.refreshUsers();
        }
        else if (
            (self.iterationIndicator <= 4) ||
            (self.selectedSes.type == "R") ||
            (self.selectedSes.type == "T") ||
            (self.selectedSes.type == "J")
        ) {
            self.updateStateIni();
        }
        /* Deprecated
        else {
            self.updateStateRub();
        }*/
        self.shared.refreshUsers();
    };

    self.shared.updateState = self.updateState;

    self.shared.setIterationIndicator = function(i){
        console.log("Set iteration Indicatior:",i);
        self.iterationIndicator = i;
        self.updateState();
    };

    self.updateStateIni = function () {
        var _postdata2;
        console.log(self.iterationIndicator);
        self.alumTime = {};
        if (self.selectedSes.type == "R") {
            _postdata2 = {
                stageid: self.iterationIndicator
            };
            $http.post("get-actors", _postdata2).success(function(data){
                self.rawActors = data;
                self.actorMap = {};
                data.forEach(a => {
                    self.actorMap[a.id] = a;
                });
                $http.post("get-role-sel-all", _postdata2).success(function (data) {
                    self.rawRoleData = data;
                    self.posFreqTable = computeRankingFrequencyTable(data, self.rawActors);
                    if(self.posFreqTable != null) {
                        self.freqMax = Object.values(self.posFreqTable)
                            .reduce(
                                (v, e) => Math.max(v, Object.values(e)
                                    .reduce((v2, e2) => Math.max(e2, v2), 0)), 0
                            );
                    }
                    self.indvTable = computeIndTable(data, self.rawActors);
                    self.shared.roleIndTable = self.indvTable;
                    self.indvTableSorted = sortIndTable(self.indvTable, self.users);
                });
                $http({
                    url: "group-proposal-stage", method: "post", data: _postdata2
                }).success(function (data) {
                    self.shared.groupByUid = {};
                    data.forEach(function (s, i) {
                        s.forEach(function (u) {
                            self.shared.groupByUid[u.uid] = { index: i + 1, tmid: u.tmid };
                        });
                    });
                });
                $http({
                    url: "get-chat-count-stage", method: "post", data: _postdata2
                }).success(function (data) {
                    self.shared.chatByUid = {};
                    self.shared.chatByTeam = {};
                    data.forEach(function(c) {
                        self.shared.chatByUid[c.uid] = +c.count;
                        if(!self.shared.chatByTeam[c.tmid]){
                            self.shared.chatByTeam[c.tmid] = 0;
                        }
                        self.shared.chatByTeam[c.tmid] += +c.count;
                    });
                });
            });
        }
        else if (self.selectedSes.type == "T"){
            _postdata2 = {
                stageid: self.iterationIndicator
            };
            self.dfsStage = [];
            $http.post("get-differentials-stage", _postdata2).success(function(data) {
                self.dfsStage = data;
                console.log("DIFFERENTIAL DEBUG DATA:",data);
                $http.post("get-differential-all-stage", _postdata2).success(function (data) {
                    self.shared.difTable = buildSemanticDifferentialsTable(
                        data, self.users, self.dfsStage, self.shared.groupByUid
                    );
                    self.shared.difTableUsers = self.shared.difTable.filter(e => !e.group).length;
                });
            });
            $http({
                url: "group-proposal-stage", method: "post", data: _postdata2
            }).success(function (data) {
                self.shared.groupByUid = {};
                self.shared.groupByTmid = {};
                data.forEach(function (s, i) {
                    s.forEach(function (u) {
                        self.shared.groupByUid[u.uid] = { index: i + 1, tmid: u.tmid };
                        self.shared.groupByTmid[u.tmid] = { index: i + 1, tmid: u.tmid };
                    });
                });
            });
            $http({
                url: "get-dif-chat-count", method: "post", data: _postdata2
            }).success(function (data) {
                self.shared.chatByUid = {};
                self.shared.chatByTeam = {};
                data.forEach(function(c) {
                    if(!self.shared.chatByUid[c.did])
                        self.shared.chatByUid[c.did] = {};
                    self.shared.chatByUid[c.did][c.uid] = +c.count;
                    if(!self.shared.chatByTeam[c.did])
                        self.shared.chatByTeam[c.did] = {};
                    if(!self.shared.chatByTeam[c.did][c.tmid]){
                        self.shared.chatByTeam[c.did][c.tmid] = 0;
                    }
                    self.shared.chatByTeam[c.did][c.tmid] += +c.count;
                });
            });
        }
        else if (self.selectedSes.type == "J"){
            _postdata2 = {
                stageid: self.iterationIndicator
            };
            if(self.shared.inputAssignedRoles) {
                self.shared.inputAssignedRoles();
            }
            $http.post("get-actors", _postdata2).success(function(data){
                self.rawActors = data;
                self.actorMap = {};
                data.forEach(a => {
                    self.actorMap[a.id] = a;
                });
                $http.post("get-role-sel-all", _postdata2).success(function (data) {
                    self.rawRoleData = data;
                    self.posFreqTable = computeRankingFrequencyTable(data, self.rawActors);
                    if(self.posFreqTable != null) {
                        self.freqMax = Object.values(self.posFreqTable)
                            .reduce(
                                (v, e) => Math.max(v, Object.values(e)
                                    .reduce((v2, e2) => Math.max(e2, v2), 0)),
                                0
                            );
                    }
                    self.indvTable = computeIndTable(data, self.rawActors);
                    self.shared.roleIndTable = self.indvTable;
                    self.indvTableSorted = sortIndTable(self.indvTable, self.users);
                });
                $http({
                    url: "group-proposal-stage", method: "post", data: _postdata2
                }).success(function (data) {
                    self.shared.groupByUid = {};
                    data.forEach(function (s, i) {
                        s.forEach(function (u) {
                            self.shared.groupByUid[u.uid] = { index: i + 1, tmid: u.tmid };
                        });
                    });
                });
                $http({
                    url: "get-chat-count-stage", method: "post", data: _postdata2
                }).success(function (data) {
                    self.shared.chatByUid = {};
                    self.shared.chatByTeam = {};
                    data.forEach(function(c) {
                        self.shared.chatByUid[c.uid] = +c.count;
                        if(!self.shared.chatByTeam[c.tmid]){
                            self.shared.chatByTeam[c.tmid] = 0;
                        }
                        self.shared.chatByTeam[c.tmid] += +c.count;
                    });
                });
            });
        }
    };

    self.getFreqColor = function(aid, pos){
        if(self.posFreqTable && self.posFreqTable[aid]) {
            let val = self.posFreqTable[aid][pos] || 0;
            let p = val / self.freqMax;

            return {
                "background": "rgba(0, 184, 166, " + p + ")"
            };
        }
    };

    self.openDF2Details = function (group, did, uid) {
        console.log(group, did, uid);   
        var postdata = {
            stageid: self.iterationIndicator,
            tmid:    group,
            did:     did
        };
        $http.post("get-team-chat-stage-df", postdata).success(function (res) {
            $uibModal.open({
                templateUrl:  "static/differential-group-2.html",
                controller:   "EthicsModalController",
                controllerAs: "vm",
                scope:        self,
                resolve:      {
                    data: function data() {
                        var data = {};
                        data.names = [self.flang("answer")];
                        data.group = group;
                        data.users = self.users;

                        data.df = self.dfsStage.find(e => e.id == did);

                        data.anonNames = {};
                        data.sesid = self.selectedSes.id;

                        data.chat = res;
                        let i = 0;
                        let abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                        data.chat.forEach(function (msg) {
                            if (msg.parent_id) msg.parent = data.chat.find(function (e) {
                                return e.id == msg.parent_id;
                            });
                            if(!data.anonNames[msg.uid]){
                                data.anonNames[msg.uid] = abc[i];
                                i += 1;
                            }
                        });

                        data.stage = self.shared.stagesMap[self.iterationIndicator];

                        if(data.stage.type == "team"){
                            data.arr = self.shared.difTable.filter(e =>
                                e.tmid == group && !e.group
                            );
                        }
                        else {
                            data.arr = self.shared.difTable.filter(e => e.uid == uid && !e.group);
                        }

                        data.arr.forEach(e => {
                            let el = e.arr.find(e => e && e.did == did);
                            e.sel = el ? el.sel : null;
                            e.comment = el ? el.comment : null;
                            if(!data.anonNames[e.uid]){
                                data.anonNames[e.uid] = abc[i];
                                i += 1;
                            }
                        });

                        data.dfarr = self.shared.buildArray(data.df.num);

                        return data;
                    }
                }
            });
        });
    };

    self.openActorDetails = function(uid, stageid) {

        let group = self.shared.groupByUid ? self.shared.groupByUid[uid] ?
            self.shared.groupByUid[uid].tmid : null : null;
        var postdata = {
            stageid: stageid,
            tmid:    group
        };
        $http.post("get-team-chat-stage", postdata).success(function (res) {
            $uibModal.open({
                templateUrl:  "static/actor-dialog.html",
                controller:   "EthicsModalController",
                controllerAs: "vm",
                scope:        self,
                resolve:      {
                    data: function data() {
                        var data = {};
                        data.group = group;
                        data.users = self.users;
                        data.actorMap = self.actorMap;

                        data.anonNames = {};
                        data.sesid = self.selectedSes.id;

                        data.chat = res;
                        let i = 0;
                        let abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                        data.chat.forEach(function (msg) {
                            if (msg.parent_id) msg.parent = data.chat.find(function (e) {
                                return e.id == msg.parent_id;
                            });
                            if(!data.anonNames[msg.uid]){
                                data.anonNames[msg.uid] = abc[i];
                                i += 1;
                            }
                        });

                        data.stage = self.shared.stagesMap[stageid];

                        if(data.stage.type == "team"){
                            data.sel = self.indvTableSorted.filter(e =>
                                self.shared.groupByUid[e.uid].index ==
                                self.shared.groupByUid[uid].index
                            );
                        }
                        else {
                            data.sel = self.indvTableSorted.filter(e => e.uid == uid);
                        }

                        data.sel.forEach(e => {
                            if(!data.anonNames[e.uid]){
                                data.anonNames[e.uid] = abc[i];
                                i += 1;
                            }
                        });
                        return data;
                    }
                }
            });
        });
    };

    self.exportChatCSV = function(){
        var postdata = {
            sesid: self.selectedSes.id
        };
        let url = self.selectedSes.type == "T" ? "get-chat-data-csv-ethics" :
            self.selectedSes.type == "R" ? "get-chat-data-csv-role" : null;
        if(url == null){
            Notification.error("No se puede exportar los datos");
            return;
        }
        $http.post(url, postdata).success(function (res) {
            if(res != null && res.length > 0) {
                saveCsv(res, {
                    filename:  "chat_" + self.selectedSes.id + ".csv",
                    formatter: function(v){
                        if(v == null){
                            return "";
                        }
                        if(typeof(v) == "string"){
                            v = v.replace(/"/g, "'").replace(/\n/g, "");
                            return '"' + v + '"';
                        }
                        return "" + v;
                    }
                });
            }
            else {
                Notification.error("No hay datos para exportar");
            }
        });
    };

    self.exportSelCSV = function(){
        var postdata = {
            sesid: self.selectedSes.id
        };
        let url = self.selectedSes.type == "T" ? "get-sel-data-csv-ethics" :
            self.selectedSes.type == "R" ? "get-sel-data-csv-role" :
                self.selectedSes.type == "J" ? "get-sel-data-csv-jigsaw" : null;
        console.log(self.selectedSes);
        if(url == null){
            Notification.error("No se puede exportar los datos");
            return;
        }
        $http.post(url, postdata).success(function (res) {
            if(res != null && res.length > 0) {
                saveCsv(res, {
                    filename:  "sel_" + self.selectedSes.id + ".csv",
                    formatter: function(v){
                        if(v == null){
                            return "";
                        }
                        if(typeof(v) == "string"){
                            v = v.replace(/"/g, "'").replace(/\n/g, "");
                            return '"' + v + '"';
                        }
                        return "" + v;
                    }
                });
            }
            else {
                Notification.error("No hay datos para exportar");
            }
        });
    };

    self.sortByAuthorName = (a, b) => {
        let ua = self.users[a] ? self.users[a].name : a;
        let ub = self.users[b] ? self.users[b].name : b;
        return ua < ub ? -1 : 1;
    };

    self.sortByAuthorGroup = (a, b) => {
        return self.shared.groupByUid[a].index - self.shared.groupByUid[b].index;
    };
};