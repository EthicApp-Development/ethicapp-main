/*eslint func-style: ["error", "expression"]*/
export let DashboardController = ($scope, $socket, $http, 
    $timeout, $uibModal, ActivityStateService, Notification) => {
    
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
        $socket.on("contentUpdate", (data) => { // Content Analysis callback socket
            if(data.data.sesid === ActivityStateService.sessionDescriptor.id){
                self.formatContentAnalysis(data.data);
            }
        });
    };

    self.selectCurrentQuestion = function(did) {
        self.selectQuestion = did;
    };

    self.shared.resetGraphs = function () { //THIS HAS TO BE CALLED ON ADMIN
        if (
            (ActivityStateService.sessionDescriptor.type == "R") ||
            (ActivityStateService.sessionDescriptor.type == "T") ||
            (ActivityStateService.sessionDescriptor.type == "J")
        ) {
            self.iterationIndicator = ActivityStateService.sessionDescriptor.current_stage || -1;
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
        if (ActivityStateService.activityDescriptor.dashboardAutoreload && 
                ActivityStateService.sessionDescriptor.status < 9) {
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
        if (ActivityStateService.sessionDescriptor.status == 1) {
            self.shared.refreshUsers();
        }
        else if ( self.iterationIndicator <= 4 ||
            ["R", "T", "J"].includes(ActivityStateService.sessionDescriptor.type)) {
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

    self.updateStateIni = async function () {
        const _postdata2 = { stageid: self.iterationIndicator };
        self.alumTime = {};
        
        try {
            if (ActivityStateService.sessionDescriptor.type === "R") {
                // Step 1: Fetch actors
                const actorsResponse = await $http.post("get-actors", _postdata2);
                self.rawActors = actorsResponse.data;
                self.actorMap = {};
                actorsResponse.data.forEach(a => {
                    self.actorMap[a.id] = a;
                });
                
                // Step 2: Fetch role selections
                const roleSelResponse = await $http.post("get-role-sel-all", _postdata2);
                self.rawRoleData = roleSelResponse.data;
                self.posFreqTable = window.computePosFreqTable(roleSelResponse.data, self.rawActors);
                if (self.posFreqTable) {
                    self.freqMax = Object.values(self.posFreqTable)
                        .reduce((v, e) => Math.max(v, Object.values(e).reduce((v2, e2) => Math.max(e2, v2), 0)), 0);
                }
                self.indvTable = window.computeIndTable(roleSelResponse.data, self.rawActors);
                self.shared.roleIndTable = self.indvTable;
                self.indvTableSorted = window.sortIndTable(self.indvTable, self.users);
                
                // Step 3: Group proposal
                const groupProposalResponse = await $http.post("group-proposal-stage", _postdata2);
                self.shared.groupByUid = {};
                groupProposalResponse.data.forEach((s, i) => {
                    s.forEach(u => {
                        self.shared.groupByUid[u.uid] = { index: i + 1, tmid: u.tmid };
                    });
                });
    
                // Step 4: Count chat messages by stage
                const chatCountResponse = await $http.post("get-chat-count-stage", _postdata2);
                self.shared.chatByUid = {};
                self.shared.chatByTeam = {};
                chatCountResponse.data.forEach(c => {
                    self.shared.chatByUid[c.uid] = +c.count;
                    if (!self.shared.chatByTeam[c.tmid]) {
                        self.shared.chatByTeam[c.tmid] = 0;
                    }
                    self.shared.chatByTeam[c.tmid] += +c.count;
                });
            } else if (ActivityStateService.sessionDescriptor.type === "T") {
                // Step 1: Fetch differentials for the stage
                const diffStageResponse = await $http.post("get-differentials-stage", _postdata2);
                self.dfsStage = diffStageResponse.data;
    
                // Step 2: Fetch all stage differentials
                const allDiffStageResponse = await $http.post("get-differential-all-stage", _postdata2);
                self.shared.difTable = window.buildDifTable(allDiffStageResponse.data, self.users, self.dfsStage, self.shared.groupByUid);
                self.shared.difTableUsers = self.shared.difTable.filter(e => !e.group).length;
                
                // Step 3: Group proposal
                const groupProposalResponse = await $http.post("group-proposal-stage", _postdata2);
                self.shared.groupByUid = {};
                self.shared.groupByTmid = {};
                groupProposalResponse.data.forEach((s, i) => {
                    s.forEach(u => {
                        self.shared.groupByUid[u.uid] = { index: i + 1, tmid: u.tmid };
                        self.shared.groupByTmid[u.tmid] = { index: i + 1, tmid: u.tmid };
                    });
                });
    
                // Step 4: Count chat messages by differential stage
                const diffChatCountResponse = await $http.post("get-dif-chat-count", _postdata2);
                self.shared.chatByUid = {};
                self.shared.chatByTeam = {};
                diffChatCountResponse.data.forEach(c => {
                    if (!self.shared.chatByUid[c.did]) self.shared.chatByUid[c.did] = {};
                    self.shared.chatByUid[c.did][c.uid] = +c.count;
    
                    if (!self.shared.chatByTeam[c.did]) self.shared.chatByTeam[c.did] = {};
                    if (!self.shared.chatByTeam[c.did][c.tmid]) self.shared.chatByTeam[c.did][c.tmid] = 0;
                    self.shared.chatByTeam[c.did][c.tmid] += +c.count;
                });
    
                // Step 5: Fetch content analysis data
                const contentAnalysisResponse = await $http.post("get-content-analysis", _postdata2);
                contentAnalysisResponse.data.forEach(data => {
                    self.formatContentAnalysis(data);
                });
            } else if (ActivityStateService.sessionDescriptor.type === "J") {
                // Step 1: Fetch actors
                if (self.shared.inputAssignedRoles) {
                    self.shared.inputAssignedRoles();
                }
    
                const actorsResponse = await $http.post("get-actors", _postdata2);
                self.rawActors = actorsResponse.data;
                self.actorMap = {};
                actorsResponse.data.forEach(a => {
                    self.actorMap[a.id] = a;
                });
    
                // Step 2: Fetch role selections
                const roleSelResponse = await $http.post("get-role-sel-all", _postdata2);
                self.rawRoleData = roleSelResponse.data;
                self.posFreqTable = window.computePosFreqTable(roleSelResponse.data, self.rawActors);
                if (self.posFreqTable) {
                    self.freqMax = Object.values(self.posFreqTable)
                        .reduce((v, e) => Math.max(v, Object.values(e).reduce((v2, e2) => Math.max(e2, v2), 0)), 0);
                }
                self.indvTable = window.computeIndTable(roleSelResponse.data, self.rawActors);
                self.shared.roleIndTable = self.indvTable;
                self.indvTableSorted = window.sortIndTable(self.indvTable, self.users);
    
                // Step 3: Group proposal
                const groupProposalResponse = await $http.post("group-proposal-stage", _postdata2);
                self.shared.groupByUid = {};
                groupProposalResponse.data.forEach((s, i) => {
                    s.forEach(u => {
                        self.shared.groupByUid[u.uid] = { index: i + 1, tmid: u.tmid };
                    });
                });
    
                // Step 4: Count chat messages by stage
                const chatCountResponse = await $http.post("get-chat-count-stage", _postdata2);
                self.shared.chatByUid = {};
                self.shared.chatByTeam = {};
                chatCountResponse.data.forEach(c => {
                    self.shared.chatByUid[c.uid] = +c.count;
                    if (!self.shared.chatByTeam[c.tmid]) {
                        self.shared.chatByTeam[c.tmid] = 0;
                    }
                    self.shared.chatByTeam[c.tmid] += +c.count;
                });
            }
        } catch (error) {
            console.error("Error in updateStateIni:", error);
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

    self.getAlumDoneTime = async function (postdata) {
        try {
            const response = await $http({
                url: "get-alum-done-time",
                method: "post",
                data: postdata
            });
            
            self.numComplete = 0;
            response.data.forEach(function (row) {
                self.numComplete += 1;
                if (self.alumState[row.uid] == null) {
                    self.alumState[row.uid] = row;
                } else {
                    self.alumState[row.uid].dtime = ~~row.dtime;
                }
            });
        } catch (error) {
            console.error("Error fetching alum done time:", error);
        }
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

    self.shared.getReports = async function () {
        try {
            const postdata = { sesid: ActivityStateService.sessionDescriptor.id };
            const response = await $http({ url: "get-report-list", method: "post", data: postdata });
            
            self.reports = response.data;
            self.exampleReports = response.data.filter(function (e) {
                return e.example;
            });
        } catch (error) {
            console.error("Error fetching report list:", error);
        }
    };
    
    self.getReportResult = async function () {
        try {
            const postdata = { repid: self.selectedReport.id };
            const response = await $http({ url: "get-report-result", method: "post", data: postdata });
            
            self.result = response.data;
            self.updateState();
        } catch (error) {
            console.error("Error fetching report result:", error);
        }
    };
    
    self.getAllReportResult = async function () {
        try {
            const postdata = { sesid: ActivityStateService.sessionDescriptor.id };
            const response = await $http({
                url: "get-report-result-all",
                method: "post",
                data: postdata
            });
            
            self.resultAll = {};
            const data = response.data;
            const n = data.length;
    
            // Initialize resultAll for users with role "A"
            for (const uid in self.users) {
                if (self.users[uid].role === "A") {
                    self.resultAll[uid] = { reviews: 0, data: [] };
                }
            }
    
            // Process data
            data.forEach(function (d) {
                if (d && d.length > 0) {
                    const _uid = self.getReportAuthor(d[0].rid);
                    
                    if (_uid !== -1) {
                        self.resultAll[_uid].data = d;  // Set or update data for the user
                    }
    
                    // Update reviews count for each event
                    d.forEach(function (ev) {
                        if (self.resultAll[ev.uid]) {
                            self.resultAll[ev.uid].reviews += n;
                        }
                    });
                }
            });
    
            // Initialize pairArr based on the length of data[0]
            self.pairArr = data[0] ? new Array(data[0].length) : [];
            
            // Build the rubric bar data
            self.buildRubricaBarData(data);
        } catch (error) {
            console.error("Error fetching all report results:", error);
        }
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

    self.showReport = async function (rid) {
        try {
            // Step 1: Fetch the report data
            let postdata = { rid: rid };
            const reportResponse = await $http({ url: "get-report", method: "post", data: postdata });
            
            const modalData = { 
                report: reportResponse.data, 
                criterios: self.shared.obtainCriterios() 
            };
            modalData.report.author = self.users[reportResponse.data.uid];
    
            // Step 2: Fetch report results
            postdata = { repid: reportResponse.data.id };
            const reportResultResponse = await $http({
                url: "get-report-result",
                method: "post",
                data: postdata
            });
            modalData.answers = reportResultResponse.data;
    
            // Step 3: Fetch criteria selection by report
            const criteriaSelectionResponse = await $http.post("get-criteria-selection-by-report", postdata);
            modalData.answersRubrica = {};
            criteriaSelectionResponse.data.forEach(row => {
                if (!modalData.answersRubrica[row.uid]) {
                    modalData.answersRubrica[row.uid] = {};
                }
                modalData.answersRubrica[row.uid][row.cid] = row.selection;
            });
    
            // Step 4: Fetch report evaluators
            const evaluatorsResponse = await $http.post("get-report-evaluators", postdata);
            evaluatorsResponse.data.forEach(row => {
                const i = modalData.answers.findIndex(e => e.uid === row.uid);
                if (i === -1) {
                    modalData.answers.push({
                        uid: row.uid,
                        evaluatorName: self.users[row.uid].name
                    });
                } else {
                    modalData.answers[i].evaluatorName = self.users[row.uid].name;
                }
            });
    
            // Step 5: Open the modal with the report details
            $uibModal.open({
                templateUrl: "static/report-details.html",
                controller: "ReportModalController",
                controllerAs: "vm",
                size: "lg",
                scope: self,
                resolve: {
                    data: function () {
                        return modalData;
                    }
                }
            });
        } catch (error) {
            console.error("Error in showReport:", error);
        }
    };
    
    self.showReportByUid = async function (uid) {
        try {
            console.log(uid);
            const postdata = { uid: uid, sesid: ActivityStateService.sessionDescriptor.id };
            const response = await $http({ url: "get-report-uid", method: "post", data: postdata });
    
            const modalData = { report: response.data };
            modalData.report.author = self.users[uid];
    
            $uibModal.open({
                templateUrl: "static/report-details.html",
                controller: "ReportModalController",
                controllerAs: "vm",
                scope: self,
                resolve: {
                    data: function () {
                        return modalData;
                    }
                }
            });
        } catch (error) {
            console.error("Error in showReportByUid:", error);
        }
    };
    
    self.broadcastReport = async function (rid) {
        try {
            const postdata = { sesid: ActivityStateService.sessionDescriptor.id, rid: rid };
            await $http({ url: "set-eval-report", method: "post", data: postdata });
            
            Notification.success("Reporte enviado a alumnos");
        } catch (error) {
            console.error("Error in broadcastReport:", error);
        }
    };
    
    self.showDetailAnswer = async function (qid, uid, it) {
        const opts = ["A", "B", "C", "D", "E"];
        const postdata = { uid: uid, qid: qid, iteration: it };
        const qs = self.questions.find(v => v.id === qid);
    
        try {
            if (it < 3) {
                // Step 1: Fetch individual selection comment
                const response = await $http({
                    url: "get-selection-comment",
                    method: "post",
                    data: postdata
                });
                const _data = response.data;
    
                if (!_data || !_data.answer) {
                    Notification.warning("No hay respuesta registrada para el alumno");
                    return;
                }
    
                // Prepare answer content for the modal
                const alt = `${opts[_data.answer]}. ${qs.options[_data.answer]}`;
                const qstxt = qs.content;
    
                $uibModal.open({
                    templateUrl: "static/content-dialog.html",
                    controller: "ContentModalController",
                    controllerAs: "vm",
                    scope: self,
                    resolve: {
                        data: function () {
                            _data.title = `${self.flang("answerOf")} ${self.users[uid].name}`;
                            _data.content = `${self.flang("question")}:\n${qstxt}\n\n` +
                                `${self.flang("answer")}:\n${alt}\n\n${self.flang("comment")}:\n` +
                                (_data.comment || "");
                            if (_data.confidence) {
                                _data.content += `\n\n${self.flang("confidenceLevel")}: ${_data.confidence}%`;
                            }
                            return _data;
                        }
                    }
                });
            } else {
                // Team-based selection (Step 2)
                postdata.tmid = self.leaderTeamId[uid];
                const teamResponse = await $http({
                    url: "get-selection-team-comment",
                    method: "post",
                    data: postdata
                });
                const res = teamResponse.data;
    
                if (!res || res.length === 0) {
                    Notification.warning("No hay respuesta registrada para el grupo");
                    return;
                }
    
                // Prepare team answer content for the modal
                const alt = `${opts[res[0].answer]}. ${qs.options[res[0].answer]}`;
                const qstxt = qs.content;
    
                $uibModal.open({
                    templateUrl: "static/content-dialog.html",
                    controller: "ContentModalController",
                    controllerAs: "vm",
                    scope: self,
                    resolve: {
                        data: function () {
                            let data = {};
                            data.title = `${self.flang("answerOf")} ${self.leaderTeamStr[uid]}`;
                            data.content = `${self.flang("question")}:\n${qstxt}\n\n` +
                                `${self.flang("answer")}:\n${alt}\n\n`;
                            res.forEach(r => {
                                data.content += `${self.flang("comment")} ${r.uname}:\n${r.comment || ""}\n`;
                                if (r.confidence) {
                                    data.content += `${self.flang("confidenceLevel")}: ${r.confidence}%\n`;
                                }
                                data.content += "\n";
                            });
    
                            return data;
                        }
                    }
                });
            }
        } catch (error) {
            console.error("Error in showDetailAnswer:", error);
        }
    };
    
    self.openDFDetails = async function (group, orden) {
        const postdata = {
            sesid: ActivityStateService.sessionDescriptor.id,
            tmid: group,
            orden: orden
        };
    
        try {
            // Step 1: Fetch team chat
            const response = await $http.post("get-team-chat", postdata);
            const res = response.data;
    
            $uibModal.open({
                templateUrl: "static/differential-group.html",
                controller: "EthicsModalController",
                controllerAs: "vm",
                scope: self,
                resolve: {
                    data: function () {
                        const data = {};
                        data.names = [
                            self.flang("individual"),
                            self.flang("anon"),
                            self.flang("teamWork")
                        ];
                        data.orden = orden;
                        data.group = group;
                        data.users = self.users;
    
                        // Find group data for differential
                        const dfgr = self.dataDF.find(e => e.tmid === group);
    
                        // Identify master data
                        const individualDF = dfgr.ind.find(e => e.orden === orden);
                        if (individualDF) {
                            data.master = self.shared.dfs.find(e => e.id === individualDF.did);
                        }
    
                        // Organize differential iterations
                        data.dfIters = [
                            dfgr.ind.filter(e => e.orden === orden),
                            dfgr.anon.filter(e => e.orden === orden),
                            dfgr.team.filter(e => e.orden === orden)
                        ];
    
                        // Generate anonymous names
                        data.anonNames = {};
                        data.sesid = ActivityStateService.sessionDescriptor.id;
                        const abcd = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                        let c = 0;
                        data.dfIters.flat().forEach(e => {
                            if (!data.anonNames[e.uid]) {
                                data.anonNames[e.uid] = abcd[c];
                                c++;
                            }
                        });
    
                        // Process chat messages to link parent messages
                        data.chat = res;
                        data.chat.forEach(msg => {
                            if (msg.parent_id) {
                                msg.parent = data.chat.find(e => e.id === msg.parent_id);
                            }
                        });
    
                        console.log(data);
                        return data;
                    }
                }
            });
        } catch (error) {
            console.error("Error in openDFDetails:", error);
        }
    };
    
    self.openDF2Details = async function (group, did, uid) {
        console.log(group, did, uid);
        const postdata = {
            stageid: self.iterationIndicator,
            tmid: group,
            did: did
        };
    
        try {
            // Step 1: Fetch team chat for the differential stage
            const response = await $http.post("get-team-chat-stage-df", postdata);
            const res = response.data;
    
            $uibModal.open({
                templateUrl: "static/differential-group-2.html",
                controller: "EthicsModalController",
                controllerAs: "vm",
                scope: self,
                resolve: {
                    data: function () {
                        const data = {};
                        data.names = [self.flang("answer")];
                        data.group = group;
                        data.users = self.users;
                        data.df = self.dfsStage.find(e => e.id === did);
                        data.anonNames = {};
                        data.sesid = ActivityStateService.sessionDescriptor.id;
                        data.chat = res;
    
                        // Generate anonymous names for each user in chat
                        let i = 0;
                        const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                        data.chat.forEach(msg => {
                            if (msg.parent_id) {
                                msg.parent = data.chat.find(e => e.id === msg.parent_id);
                            }
                            if (!data.anonNames[msg.uid]) {
                                data.anonNames[msg.uid] = abc[i];
                                i += 1;
                            }
                        });
    
                        // Retrieve stage type and differential data
                        data.stage = self.shared.stagesMap[self.iterationIndicator];
                        if (data.stage.type === "team") {
                            data.arr = group
                                ? self.shared.difTable.filter(e => e.tmid === group && !e.group)
                                : self.shared.difTable.filter(e => e.uid === uid && !e.group);
                        } else {
                            data.arr = self.shared.difTable.filter(e => e.uid === uid && !e.group);
                        }
    
                        // Assign selection and comments to differential array
                        data.arr.forEach(e => {
                            const el = e.arr.find(item => item && item.did === did);
                            e.sel = el ? el.sel : null;
                            e.comment = el ? el.comment : null;
                            if (!data.anonNames[e.uid]) {
                                data.anonNames[e.uid] = abc[i];
                                i += 1;
                            }
                        });
    
                        // Build the array for displaying the differential options
                        data.dfarr = self.shared.buildArray(data.df.num);
    
                        return data;
                    }
                }
            });
        } catch (error) {
            console.error("Error in openDF2Details:", error);
        }
    };
    
    self.openActorDetails = async function (uid, stageid) {
        // Determine the group ID for the user
        const group = self.shared.groupByUid && self.shared.groupByUid[uid] 
            ? self.shared.groupByUid[uid].tmid 
            : null;
    
        const postdata = {
            stageid: stageid,
            tmid: group
        };
    
        try {
            // Step 1: Fetch team chat for the actor
            const response = await $http.post("get-team-chat-stage", postdata);
            const res = response.data;
    
            $uibModal.open({
                templateUrl: "static/actor-dialog.html",
                controller: "EthicsModalController",
                controllerAs: "vm",
                scope: self,
                resolve: {
                    data: function () {
                        const data = {};
                        data.group = group;
                        data.users = self.users;
                        data.actorMap = self.actorMap;
                        data.anonNames = {};
                        data.sesid = ActivityStateService.sessionDescriptor.id;
                        data.chat = res;
    
                        // Generate anonymous names for users in the chat
                        let i = 0;
                        const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                        data.chat.forEach(msg => {
                            if (msg.parent_id) {
                                msg.parent = data.chat.find(e => e.id === msg.parent_id);
                            }
                            if (!data.anonNames[msg.uid]) {
                                data.anonNames[msg.uid] = abc[i];
                                i += 1;
                            }
                        });
    
                        // Retrieve the stage information
                        data.stage = self.shared.stagesMap[stageid];
    
                        // Select the relevant entries based on the stage type
                        if (data.stage.type === "team") {
                            data.sel = self.indvTableSorted.filter(e =>
                                self.shared.groupByUid[e.uid].index ===
                                self.shared.groupByUid[uid].index
                            );
                        } else {
                            data.sel = self.indvTableSorted.filter(e => e.uid === uid);
                        }
    
                        // Assign anonymous names for each user in the selection
                        data.sel.forEach(e => {
                            if (!data.anonNames[e.uid]) {
                                data.anonNames[e.uid] = abc[i];
                                i += 1;
                            }
                        });
    
                        return data;
                    }
                }
            });
        } catch (error) {
            console.error("Error in openActorDetails:", error);
        }
    };

    self.exportCSV = async function () {
        const postdata = {
            sesid: ActivityStateService.sessionDescriptor.id
        };
    
        try {
            // Step 1: Fetch selection data for CSV export
            const selectionResponse = await $http.post("get-sel-data-csv", postdata);
            const selectionData = selectionResponse.data;
    
            if (selectionData && selectionData.length > 0) {
                saveCsv(selectionData, {
                    filename: "seleccion_" + ActivityStateService.sessionDescriptor.id + ".csv",
                    formatter: function (v) {
                        if (v == null) {
                            return "";
                        }
                        if (typeof v === "string") {
                            v = v.replace(/"/g, "'").replace(/\n/g, "");
                            return '"' + v + '"';
                        }
                        return "" + v;
                    }
                });
            } else {
                Notification.error("No hay datos de selección para exportar");
            }
    
            // Step 2: Fetch chat data for CSV export
            const chatResponse = await $http.post("get-chat-data-csv", postdata);
            const chatData = chatResponse.data;
    
            if (chatData && chatData.length > 0) {
                saveCsv(chatData, {
                    filename: "chat_" + ActivityStateService.sessionDescriptor.id + ".csv",
                    formatter: function (v) {
                        if (v == null) {
                            return "";
                        }
                        if (typeof v === "string") {
                            v = v.replace(/"/g, "'").replace(/\n/g, "");
                            return '"' + v + '"';
                        }
                        return "" + v;
                    }
                });
            } else {
                Notification.error("No hay datos de chat para exportar");
            }
        } catch (error) {
            console.error("Error exporting CSV data:", error);
            Notification.error("Error al exportar datos CSV");
        }
    };
    
    self.exportChatCSV = async function () {
        const postdata = {
            sesid: ActivityStateService.sessionDescriptor.id
        };
        const url = ActivityStateService.sessionDescriptor.type === "T" ? "get-chat-data-csv-ethics" :
            ActivityStateService.sessionDescriptor.type === "R" ? "get-chat-data-csv-role" : null;
    
        if (!url) {
            Notification.error("No se puede exportar los datos");
            return;
        }
    
        try {
            // Step 1: Fetch chat data based on session type
            const response = await $http.post(url, postdata);
            const res = response.data;
    
            if (res && res.length > 0) {
                saveCsv(res, {
                    filename: "chat_" + ActivityStateService.sessionDescriptor.id + ".csv",
                    formatter: function (v) {
                        if (v == null) {
                            return "";
                        }
                        if (typeof v === "string") {
                            v = v.replace(/"/g, "'").replace(/\n/g, "");
                            return '"' + v + '"';
                        }
                        return "" + v;
                    }
                });
            } else {
                Notification.error("No hay datos para exportar");
            }
        } catch (error) {
            console.error("Error exporting chat CSV data:", error);
            Notification.error("Error al exportar datos de chat");
        }
    };
    
    self.exportSelCSV = async function () {
        const postdata = {
            sesid: ActivityStateService.sessionDescriptor.id
        };
        const url = ActivityStateService.sessionDescriptor.type === "T" ? "get-sel-data-csv-ethics" :
            ActivityStateService.sessionDescriptor.type === "R" ? "get-sel-data-csv-role" :
            ActivityStateService.sessionDescriptor.type === "J" ? "get-sel-data-csv-jigsaw" : null;
        
        if (!url) {
            Notification.error("No se puede exportar los datos");
            return;
        }
    
        try {
            // Step 1: Fetch selection data based on session type
            const response = await $http.post(url, postdata);
            const res = response.data;
    
            if (res && res.length > 0) {
                saveCsv(res, {
                    filename: "sel_" + ActivityStateService.sessionDescriptor.id + ".csv",
                    formatter: function (v) {
                        if (v == null) {
                            return "";
                        }
                        if (typeof v === "string") {
                            v = v.replace(/"/g, "'").replace(/\n/g, "");
                            return '"' + v + '"';
                        }
                        return "" + v;
                    }
                });
            } else {
                Notification.error("No hay datos para exportar");
            }
        } catch (error) {
            console.error("Error exporting selection CSV data:", error);
            Notification.error("Error al exportar datos de selección");
        }
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