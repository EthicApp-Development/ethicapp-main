/*eslint func-style: ["error", "expression"]*/
export let DashboardController = ($scope, $socket,ActivityStateService,
    $http, $timeout, $uibModal, Notification) => {
    
    var self = $scope;
    self.iterationIndicator = 1;
    self.currentTimer = null;
    self.showCf = false;
    self.dataDF = [];
    self.dataChatCount = {};
    self.activityState = ActivityStateService;
    

    self.formatContentAnalysis = function (data) {
        const stageId = data.stage_id;
        if (!self.contentAnalysis) {
            self.contentAnalysis = {};
        }
        
        if (!self.contentAnalysis[stageId]) {
            self.contentAnalysis[stageId] = {};
        }

        data.response_selections.forEach((selection) => {
            const questionId = selection.question_id;
        
            if (!self.contentAnalysis[stageId][questionId]) {
                self.contentAnalysis[stageId][questionId] = {
                    top: [],
                    worst: []
                };
            }
        
            selection.responses.forEach((response) => {

                const responseDict = {
                    response_text: response.response_text,
                    did: questionId,
                    uid: response.user_id
                };

                if (response.ranking_type === 'top') {
                    self.contentAnalysis[stageId][questionId].top[response.ranking - 1] = responseDict;
                } else if (response.ranking_type === 'worst') {
                    self.contentAnalysis[stageId][questionId].worst[response.ranking - 1] = responseDict;
                }
            });
        });
    };

    self.init = self.init = function () {
        /*
        var _postdata2;
        _postdata2 = {
            stageid: self.iterationIndicator
        };
        $http({
            url: "get-content-analysis", method: "post", data: _postdata2
        }).success(function (dataArray) {
            dataArray.forEach(function(data) {
                self.formatContentAnalysis(data);
                console.log(self.contentAnalysis)
            });
        });
        */
        // CONTENT ANALYSIS SOCKET
        $socket.on("contentUpdate", (data) => {
            if(data.data.sesid === self.selectedSes.id){
                self.formatContentAnalysis(data.data);
            } else {
                console.log("Datos no coinciden con la sesión actual:");
            }
        });
    };

    self.selectCurrentQuestion = function(did) {
        self.selectQuestion = did;
    };

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
        if (self.activityState.dashboardAutoreload  && self.selectedSes.status < 9) {
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
            self.activityState.dashboardAutoreloadTime * 1000);
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
        else {
            self.updateStateRub();
        }
        self.shared.refreshUsers();
    };

    self.shared.updateState = self.updateState;

    self.shared.setIterationIndicator = function(i){
        self.iterationIndicator = i;
        self.updateState();
    };

    self.updateStateIni = function () {
        var _postdata2;
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
                    self.posFreqTable = window.computePosFreqTable(data, self.rawActors);
                    if(self.posFreqTable != null) {
                        self.freqMax = Object.values(self.posFreqTable)
                            .reduce(
                                (v, e) => Math.max(v, Object.values(e)
                                    .reduce((v2, e2) => Math.max(e2, v2), 0)), 0
                            );
                    }
                    self.indvTable = window.computeIndTable(data, self.rawActors);
                    self.shared.roleIndTable = self.indvTable;
                    self.indvTableSorted = window.sortIndTable(self.indvTable, self.users);
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
            console.log("datos", _postdata2)
            self.dfsStage = [];
            $http.post("get-differentials-stage", _postdata2).success(function(data) {
                self.dfsStage = data;
                console.log("DIFFERENTIAL DEBUG DATA:",data);
                $http.post("get-differential-all-stage", _postdata2).success(function (data) {
                    self.shared.difTable = window.buildDifTable(
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
            $http({
                url: "get-content-analysis", method: "post", data: _postdata2
            }).success(function (dataArray) {
                dataArray.forEach(function(data) {
                    self.formatContentAnalysis(data);
                    console.log(self.contentAnalysis)
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
                    self.posFreqTable = window.computePosFreqTable(data, self.rawActors);
                    if(self.posFreqTable != null) {
                        self.freqMax = Object.values(self.posFreqTable)
                            .reduce(
                                (v, e) => Math.max(v, Object.values(e)
                                    .reduce((v2, e2) => Math.max(e2, v2), 0)),
                                0
                            );
                    }
                    self.indvTable = window.computeIndTable(data, self.rawActors);
                    self.shared.roleIndTable = self.indvTable;
                    self.indvTableSorted = window.sortIndTable(self.indvTable, self.users);
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
        console.log(self.shared);
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

    self.avgAlum = function (uid) {
        if (self.alumState != null && self.alumState[uid] != null) {
            var t = 0;
            var c = 0;
            for (var k in self.alumState[uid]) {
                if (self.alumState[uid][k]) c++;
                t++;
            }
            return t > 0 ? 100 * c / t : 0;
        }
        return 0;
    };

    self.avgPreg = function (pid) {
        if (self.alumState != null) {
            var t = 0;
            var c = 0;
            for (var k in self.alumState) {
                if (self.alumState[k] != null && self.alumState[k][pid] != null) {
                    if (self.alumState[k][pid]) c++;
                    t++;
                }
            }
            return t > 0 ? 100 * c / t : 0;
        }
        return 0;
    };

    self.avgAll = function () {
        var t = 0;
        var c = 0;
        if (self.alumState != null) {
            for (var u in self.alumState) {
                for (var k in self.alumState[u]) {
                    if (self.alumState[u][k]) c++;
                    t++;
                }
            }
        }
        return t > 0 ? 100 * c / t : 0;
    };

    self.progress = function () {
        var t = 0;
        if (self.alumState != null) {
            for (var u in self.alumState) {
                self.alumState[u].forEach(() => t++);
            }
            return 100 * t / (Object.keys(self.alumState).length * self.questions.length);
        }
        return 0;
    };

    self.progressAlum = function (uid) {
        var t = 0;
        if (self.alumState != null && self.alumState[uid] != null) {
            self.alumState[uid].forEach(() => t++);
            return 100 * t / self.questions.length;
        }
        return 0;
    };

    self.progressPreg = function (pid) {
        var t = 0;
        if (self.alumState != null) {
            for (var u in self.alumState) {
                if (self.alumState[u][pid] != null) {
                    t++;
                }
            }
            return 100 * t / Object.keys(self.alumState).length;
        }
        return 0;
    };

    self.lectPerformance = function () {
        var t = 0;
        var c = 0;
        if (self.alumState != null) {
            for (var u in self.alumState) {
                var a = self.alumState[u];
                t++;
                c += a.score;
            }
            return 100 * c / t;
        }
        return 0;
    };

    self.DFAll = function (ans, orden) {
        return ans.filter(function (e) {
            return e.orden == orden;
        }).map(function (e) {
            return e.sel;
        });
    };

    self.DFL = function (ans, orden) {
        return ans.filter(function (e) {
            return e.orden == orden;
        }).length;
    };

    self.DFAvg = function (ans, orden) {
        var a = ans.filter(function (e) {
            return e.orden == orden;
        }).map(function (e) {
            return e.sel;
        });
        return a.length > 0 ? a.reduce(function (v, e) {
            return v + e;
        }, 0) / a.length : 0;
    };

    self.DFMinMax = function (ans, orden) {
        var a = ans.filter(function (e) {
            return e.orden == orden;
        }).map(function (e) {
            return e.sel;
        });
        a.sort();
        var n = a.length - 1;
        return a[n] - a[0];
    };

    self.DFColor = function (ans, orden) {
        var avg = self.DFAvg(ans, orden);
        var sd = 0;
        var arr = ans.filter(function (e) {
            return e.orden == orden;
        }).map(function (e) {
            return e.sel;
        });
        arr.forEach(function (a) {
            sd += (a - avg) * (a - avg);
        });
        var dif = Math.sqrt(sd / (arr.length - 1));

        if (dif <= 1) return "bg-darkgreen";
        else if (dif > 2.8) return "bg-red";
        else return "bg-yellow";
    };

    self.getAlumDoneTime = function (postdata) {
        $http({
            url: "get-alum-done-time", method: "post", data: postdata
        }).success(function (data) {
            self.numComplete = 0;
            data.forEach(function (row) {
                self.numComplete += 1;
                if (self.alumState[row.uid] == null)
                    self.alumState[row.uid] = row;else self.alumState[row.uid].dtime = ~~row.dtime;
            });
        });
    };

    self.buildBarData = function (data) {
        var N = 5;
        self.barData[0].values = [];
        for (var i = 0; i < N; i++) {
            var lbl = i * 20 + "% - " + (i + 1) * 20 + "%";
            self.barData[0].values.push({ label: lbl, value: 0 });
        }
        data.forEach(function (d) {
            var rank = Math.min(Math.floor(N * d.score), N - 1);
            self.barData[0].values[rank].value += 1;
        });
        self.barOpts.chart.xAxis.axisLabel = self.flang("performance");
    };

    self.updateStateRub = function () {
        if (self.iterationIndicator == 5) self.computeDif();
        else if (self.iterationIndicator == 6) self.getAllReportResult();
    };

    self.showName = function (report) {
        if (report.example)
            return report.title + " - " + self.flang("exampleReport");
        else return report.id + " - " + self.flang("reportOf") + " " + self.users[report.uid].name;
    };

    self.shared.getReports = function () {
        var postdata = { sesid: self.selectedSes.id };
        $http({ url: "get-report-list", method: "post", data: postdata }).success(function (data) {
            self.reports = data;
            self.exampleReports = data.filter(function (e) {
                return e.example;
            });
        });
    };

    self.getReportResult = function () {
        var postdata = { repid: self.selectedReport.id };
        $http({
            url: "get-report-result", method: "post", data: postdata
        }).success(function (data) {
            self.result = data;
            self.updateState();
        });
    };

    self.getAllReportResult = function () {
        var postdata = { sesid: self.selectedSes.id };
        $http({
            url: "get-report-result-all", method: "post", data: postdata
        }).success(function (data) {
            self.resultAll = {};
            var n = data.length;
            for (var uid in self.users) {
                if (self.users[uid].role == "A") self.resultAll[uid] = { reviews: 0, data: [] };
            }
            data.forEach(function (d) {
                if (d != null && d.length > 0) {
                    var _uid = self.getReportAuthor(d[0].rid);
                    if (_uid != -1 && self.resultAll[_uid].data == null) {
                        self.resultAll[_uid].data = d;
                    } else if (_uid != -1) {
                        self.resultAll[_uid].data = d;
                    }
                    d.forEach(function (ev) {
                        self.resultAll[ev.uid].reviews += n;
                    });
                }
            });
            self.pairArr = data[0] ? new Array(data[0].length) : [];
            //console.log(self.resul);
            self.buildRubricaBarData(data);
        });
    };

    self.buildRubricaBarData = function (data) {
        var N = 3;
        var rubnms = ["1 - 2", "2 - 3", "3 - 4"];
        self.barData[0].values = [];
        for (var i = 0; i < N; i++) {
            var lbl = i + 1 + " - " + (i + 2) + " (" + rubnms[i] + ")";
            self.barData[0].values.push({ label: lbl, value: 0 });
        }
        data.forEach(function (d) {
            var score = d.reduce(function (e, v) {
                return e + v.val;
            }, 0) / d.length;
            var rank = Math.min(Math.floor(score - 1), N - 1);
            self.barData[0].values[rank].value += 1;
        });
        self.barOpts.chart.xAxis.axisLabel = self.flang("scoreDist");
    };

    self.computeDif = function () {
        if (self.result) {
            var pi = self.result.findIndex(function (e) {
                return self.users[e.uid].role == "P";
            });
            if (pi != -1) {
                var pval = self.result[pi].val;
                var difs = [];
                self.result.forEach(function (e, i) {
                    if (i != pi) {
                        difs.push(Math.abs(pval - e.val));
                    }
                });
                self.buildRubricaDiffData(difs);
            }
        }
    };

    self.buildRubricaDiffData = function (difs) {
        console.log("difs", difs);
        var N = 5;
        var lblnms = self.flang("high2lowScale").split(",");
        self.barData[0].values = [];
        for (var i = 0; i < N; i++) {
            // let lbl = (i * 0.5) + " - " + (i + 1) * 0.5;
            self.barData[0].values.push({ label: lblnms[i], value: 0 });
        }
        difs.forEach(function (d) {
            var rank = Math.min(Math.floor(d * 2), N - 1);
            self.barData[0].values[rank].value += 1;
        });
        self.barOpts.chart.xAxis.axisLabel = self.flang("correctDistance");
    };

    self.getReportAuthor = function (rid) {
        if (self.reports) {
            var rep = self.reports.find(function (e) {
                return e.id == rid;
            });
            return rep ? rep.uid : -1;
        }
        return -1;
    };

    self.getAvg = function (row) {
        if (row == null || row.length == 0) return "";
        var s = row.reduce(function (v, e) {
            return v + e.val;
        }, 0);
        return s / row.length;
    };

    self.getInMax = function (res) {
        if (res == null) return [];
        var n = 0;
        for (var u in res) {
            n = Math.max(n, res[u].data.length);
        }
        return new Array(n);
    };

    self.showReport = function (rid) {
        var postdata = { rid: rid };
        $http({ url: "get-report", method: "post", data: postdata }).success(function (data) {
            var modalData = { report: data, criterios: self.shared.obtainCriterios() };
            modalData.report.author = self.users[data.uid];
            var postdata = { repid: data.id };
            $http({
                url: "get-report-result", method: "post", data: postdata
            }).success(function (data) {
                modalData.answers = data;
                $http.post("get-criteria-selection-by-report", postdata).success(function (data) {
                    modalData.answersRubrica = {};
                    data.forEach(function (row) {
                        if (modalData.answersRubrica[row.uid] == null)
                            modalData.answersRubrica[row.uid] = {};
                        modalData.answersRubrica[row.uid][row.cid] = row.selection;
                    });
                    $http.post("get-report-evaluators", postdata).success(function (data) {
                        data.forEach(function (row) {
                            var i = modalData.answers.findIndex(function (e) {
                                return e.uid == row.uid;
                            });
                            if (i == -1) modalData.answers.push({
                                uid: row.uid, evaluatorName: self.users[row.uid].name
                            });
                            else modalData.answers[i].evaluatorName = self.users[row.uid].name;
                        });
                        $uibModal.open({
                            templateUrl:  "static/report-details.html",
                            controller:   "ReportModalController",
                            controllerAs: "vm",
                            size:         "lg",
                            scope:        self,
                            resolve:      {
                                data: function data() {
                                    return modalData;
                                }
                            }
                        });
                    });
                });
            });
        });
    };

    self.showReportByUid = function (uid) {
        console.log(uid);
        var postdata = { uid: uid, sesid: self.selectedSes.id };
        $http({ url: "get-report-uid", method: "post", data: postdata }).success(function (data) {
            var modalData = { report: data };
            modalData.report.author = self.users[uid];
            $uibModal.open({
                templateUrl:  "static/report-details.html",
                controller:   "ReportModalController",
                controllerAs: "vm",
                scope:        self,
                resolve:      {
                    data: function data() {
                        return modalData;
                    }
                }
            });
        });
    };

    self.broadcastReport = function (rid) {
        var postdata = { sesid: self.selectedSes.id, rid: rid };
        $http({ url: "set-eval-report", method: "post", data: postdata }).success(function () {
            Notification.success("Reporte enviado a alumnos");
        });
    };

    self.showDetailAnswer = function (qid, uid, it) {
        var opts = ["A", "B", "C", "D", "E"];
        var postdata = { uid: uid, qid: qid, iteration: it };
        var qs = self.questions.reduce(function (e, v) {
            return v.id == qid ? v : e;
        }, null);
        if (it < 3) {
            $http({
                url: "get-selection-comment", method: "post", data: postdata
            }).success(function (_data) {
                if (_data == null || _data.answer == null) {
                    Notification.warning("No hay respuesta registrada para el alumno");
                    return;
                }
                var alt = opts[_data.answer] + ". " + qs.options[_data.answer];
                var qstxt = qs.content;
                $uibModal.open({
                    templateUrl:  "static/content-dialog.html",
                    controller:   "ContentModalController",
                    controllerAs: "vm",
                    scope:        self,
                    resolve:      {
                        data: function data() {
                            _data.title = self.flang("answerOf") + " " + self.users[uid].name;
                            _data.content = self.flang("question") + ":\n" + qstxt + "\n\n" +
                                self.flang("answer") + ":\n" + alt + "\n\n" + self.flang("comment")
                                + ":\n" + (_data.comment ? _data.comment : "");
                            if (_data.confidence) {
                                _data.content += "\n\n" + self.flang("confidenceLevel") + ": " +
                                    _data.confidence + "%";
                            }
                            return _data;
                        }
                    }
                });
            });
        } else {
            postdata.tmid = self.leaderTeamId[uid];
            $http({
                url: "get-selection-team-comment", method: "post", data: postdata
            }).success(function (res) {
                if (res == null || res.length == 0) {
                    Notification.warning("No hay respuesta registrada para el grupo");
                    return;
                }
                var alt = opts[res[0].answer] + ". " + qs.options[res[0].answer];
                var qstxt = qs.content;
                $uibModal.open({
                    templateUrl:  "static/content-dialog.html",
                    controller:   "ContentModalController",
                    controllerAs: "vm",
                    scope:        self,
                    resolve:      {
                        data: function data() {
                            var data = {};
                            data.title = self.flang("answerOf") + " " + self.leaderTeamStr[uid];
                            data.content = self.flang("question") + ":\n" + qstxt + "\n\n" +
                                self.flang("answer") + ":\n" + alt + "\n\n";
                            res.forEach(function (r) {
                                data.content += self.flang("comment") + " " + r.uname + ":\n" +
                                    (r.comment != null ? r.comment : "") + "\n";
                                if (r.confidence != null) {
                                    data.content += self.flang("confidenceLevel") + ": " +
                                        r.confidence + "%\n";
                                }
                                data.content += "\n";
                            });

                            return data;
                        }
                    }
                });
            });
        }
    };

    self.openDFDetails = function (group, orden) {
        var postdata = {
            sesid: self.selectedSes.id,
            tmid:  group,
            orden: orden
        };
        $http.post("get-team-chat", postdata).success(function (res) {
            $uibModal.open({
                templateUrl:  "static/differential-group.html",
                controller:   "EthicsModalController",
                controllerAs: "vm",
                scope:        self,
                resolve:      {
                    data: function data() {
                        var data = {};
                        data.names = [
                            self.flang("individual"), self.flang("anon"), self.flang("teamWork")
                        ];
                        data.orden = orden;
                        data.group = group;
                        data.users = self.users;
                        var dfgr = self.dataDF.find(function (e) {
                            return e.tmid == group;
                        });
                        // console.log(self.shared);
                        if (dfgr.ind.some(function (e) {
                            return e.orden == orden;
                        })) {
                            var dfgri = dfgr.ind.find(function (e) {
                                return e.orden == orden;
                            });
                            data.master = self.shared.dfs.filter(function (e) {
                                return e.id;
                            }).find(function (e) {
                                return e.id == dfgri.did;
                            });
                        }
                        data.dfIters = [];
                        data.dfIters.push(dfgr.ind.filter(function (e) {
                            return e.orden == orden;
                        }));
                        data.dfIters.push(dfgr.anon.filter(function (e) {
                            return e.orden == orden;
                        }));
                        data.dfIters.push(dfgr.team.filter(function (e) {
                            return e.orden == orden;
                        }));
                        data.anonNames = {};
                        data.sesid = self.selectedSes.id;
                        var abcd = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                        var c = 0;
                        data.dfIters.flat().forEach(function (e) {
                            if (!data.anonNames[e.uid]) {
                                data.anonNames[e.uid] = abcd[c];
                                c++;
                            }
                        });
                        data.chat = res;
                        data.chat.forEach(function (msg) {
                            if (msg.parent_id) msg.parent = data.chat.find(function (e) {
                                return e.id == msg.parent_id;
                            });
                        });
                        console.log(data);
                        return data;
                    }
                }
            });
        });
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
                            console.log(self.shared.difTable)
                            console.log(group)
                            if (group){
                                data.arr = self.shared.difTable.filter(e =>
                                    e.tmid == group && !e.group
                                );
                            }
                            else{
                                data.arr = self.shared.difTable.filter(e =>
                                    e.uid == uid && !e.group
                                );
                            }
                            
                            console.log("array",data.arr);
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

    self.openActorDetails = function  (uid, stageid) {

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



    self.exportCSV = function(){
        var postdata = {
            sesid: self.selectedSes.id
        };
        $http.post("get-sel-data-csv", postdata).success(function (res) {
            if(res != null && res.length > 0) {
                saveCsv(res, {
                    filename:  "seleccion_" + self.selectedSes.id + ".csv",
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
                Notification.error("No hay datos de selección para exportar");
            }
        });
        $http.post("get-chat-data-csv", postdata).success(function (res) {
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
                Notification.error("No hay datos de chat para exportar");
            }
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

    self.sortByAutorName = (a, b) => {
        let ua = self.users[a] ? self.users[a].name : a;
        let ub = self.users[b] ? self.users[b].name : b;
        return ua < ub ? -1 : 1;
    };

    self.sortByAutorGroup = (a, b) => {
        return self.shared.groupByUid[a].index - self.shared.groupByUid[b].index;
    };

    self.init();
};