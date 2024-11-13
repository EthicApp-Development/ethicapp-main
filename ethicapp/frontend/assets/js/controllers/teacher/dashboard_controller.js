/*eslint func-style: ["error", "expression"]*/
export function DashboardController($scope, $routeParams, $socket, $http, 
    $timeout, $uibModal, ActivityStateService, Notification) {
    
    const vm = this;
    vm.iterationIndicator = 1;
    vm.currentTimer = null;
    vm.showCf = false;
    vm.dataDF = [];
    vm.dataChatCount = {};
    vm.activityState = ActivityStateService;
    
    vm.init = function () {
        let id = $routeParams.id;
        if (typeof id === 'undefined' || id === null || id === '') {
            $scope.navigateTo("/error/404/2");
        }

        vm.sessionId = Number(id);

        $socket.on("contentUpdate", (data) => {
            if(data.data.sesid === ActivityStateService.sessionDescriptor.id){
                vm.formatContentAnalysis(data.data);
            }
        });
    };

    vm.formatContentAnalysis = function (data) {
        const stageId = data.stage_id;
        if (!vm.contentAnalysis) {
            vm.contentAnalysis = {};
        }
        
        if (!vm.contentAnalysis[stageId]) {
            vm.contentAnalysis[stageId] = {};
        }

        data.response_selections.forEach((selection) => {
            const questionId = selection.question_id;
        
            if (!vm.contentAnalysis[stageId][questionId]) {
                vm.contentAnalysis[stageId][questionId] = {
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
                    vm.contentAnalysis[stageId][questionId].top[response.ranking - 1] = responseDict;
                } else if (response.ranking_type === 'worst') {
                    vm.contentAnalysis[stageId][questionId].worst[response.ranking - 1] = responseDict;
                }
            });
        });
    };

    vm.selectCurrentQuestion = function(did) {
        vm.selectQuestion = did;
    };

    vm.shared.resetGraphs = function () { //THIS HAS TO BE CALLED ON ADMIN
        if (
            (ActivityStateService.sessionDescriptor.type == "R") ||
            (ActivityStateService.sessionDescriptor.type == "T") ||
            (ActivityStateService.sessionDescriptor.type == "J")
        ) {
            vm.iterationIndicator = ActivityStateService.sessionDescriptor.current_stage || -1;
        }
        vm.alumState = null;
        vm.barOpts = {
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
                    axisLabel: vm.flang("students")
                }
            }
        };
        vm.barData = [{ key: vm.flang("students"), color: "#0077c1", values: [] }];
        vm.updateState();
        if (ActivityStateService.activityDescriptor.dashboardAutoreload && 
                ActivityStateService.sessionDescriptor.status < 9) {
            vm.reload(true);
        }
    };

    vm.reload = function (k) {
        if (!k) {
            vm.updateState();
        }
        if (vm.currentTimer != null) {
            $timeout.cancel(vm.currentTimer);
        }
        vm.currentTimer = $timeout(vm.reload, 
            vm.activityState.dashboardAutoreloadTime * 1000);
    };

    vm.updateState = function () {
        if (ActivityStateService.sessionDescriptor.status == 1) {
            vm.shared.refreshUsers();
        }
        else if ( vm.iterationIndicator <= 4 ||
            ["R", "T", "J"].includes(ActivityStateService.sessionDescriptor.type)) {
            vm.updateStateIni();
        }
        else {
            vm.updateStateRub();
        }
        vm.shared.refreshUsers();
    };

    vm.shared.updateState = vm.updateState;

    vm.shared.setIterationIndicator = function(i){
        vm.iterationIndicator = i;
        vm.updateState();
    };

    vm.updateStateIni = async function () {
        const _postdata2 = { stageid: vm.iterationIndicator };
        vm.alumTime = {};
        
        try {
            if (ActivityStateService.sessionDescriptor.type === "R") {
                // Step 1: Fetch actors
                const actorsResponse = await $http.post("get-actors", _postdata2);
                vm.rawActors = actorsResponse.data;
                vm.actorMap = {};
                actorsResponse.data.forEach(a => {
                    vm.actorMap[a.id] = a;
                });
                
                // Step 2: Fetch role selections
                const roleSelResponse = await $http.post("get-role-sel-all", _postdata2);
                vm.rawRoleData = roleSelResponse.data;
                vm.posFreqTable = window.computePosFreqTable(roleSelResponse.data, vm.rawActors);
                if (vm.posFreqTable) {
                    vm.freqMax = Object.values(vm.posFreqTable)
                        .reduce((v, e) => Math.max(v, Object.values(e).reduce((v2, e2) => Math.max(e2, v2), 0)), 0);
                }
                vm.indvTable = window.computeIndTable(roleSelResponse.data, vm.rawActors);
                vm.shared.roleIndTable = vm.indvTable;
                vm.indvTableSorted = window.sortIndTable(vm.indvTable, vm.users);
                
                // Step 3: Group proposal
                const groupProposalResponse = await $http.post("group-proposal-stage", _postdata2);
                vm.shared.groupByUid = {};
                groupProposalResponse.data.forEach((s, i) => {
                    s.forEach(u => {
                        vm.shared.groupByUid[u.uid] = { index: i + 1, tmid: u.tmid };
                    });
                });
    
                // Step 4: Count chat messages by stage
                const chatCountResponse = await $http.post("get-chat-count-stage", _postdata2);
                vm.shared.chatByUid = {};
                vm.shared.chatByTeam = {};
                chatCountResponse.data.forEach(c => {
                    vm.shared.chatByUid[c.uid] = +c.count;
                    if (!vm.shared.chatByTeam[c.tmid]) {
                        vm.shared.chatByTeam[c.tmid] = 0;
                    }
                    vm.shared.chatByTeam[c.tmid] += +c.count;
                });
            } else if (ActivityStateService.sessionDescriptor.type === "T") {
                // Step 1: Fetch differentials for the stage
                const diffStageResponse = await $http.post("get-differentials-stage", _postdata2);
                vm.dfsStage = diffStageResponse.data;
    
                // Step 2: Fetch all stage differentials
                const allDiffStageResponse = await $http.post("get-differential-all-stage", _postdata2);
                vm.shared.difTable = window.buildDifTable(allDiffStageResponse.data, vm.users, vm.dfsStage, vm.shared.groupByUid);
                vm.shared.difTableUsers = vm.shared.difTable.filter(e => !e.group).length;
                
                // Step 3: Group proposal
                const groupProposalResponse = await $http.post("group-proposal-stage", _postdata2);
                vm.shared.groupByUid = {};
                vm.shared.groupByTmid = {};
                groupProposalResponse.data.forEach((s, i) => {
                    s.forEach(u => {
                        vm.shared.groupByUid[u.uid] = { index: i + 1, tmid: u.tmid };
                        vm.shared.groupByTmid[u.tmid] = { index: i + 1, tmid: u.tmid };
                    });
                });
    
                // Step 4: Count chat messages by differential stage
                const diffChatCountResponse = await $http.post("get-dif-chat-count", _postdata2);
                vm.shared.chatByUid = {};
                vm.shared.chatByTeam = {};
                diffChatCountResponse.data.forEach(c => {
                    if (!vm.shared.chatByUid[c.did]) vm.shared.chatByUid[c.did] = {};
                    vm.shared.chatByUid[c.did][c.uid] = +c.count;
    
                    if (!vm.shared.chatByTeam[c.did]) vm.shared.chatByTeam[c.did] = {};
                    if (!vm.shared.chatByTeam[c.did][c.tmid]) vm.shared.chatByTeam[c.did][c.tmid] = 0;
                    vm.shared.chatByTeam[c.did][c.tmid] += +c.count;
                });
    
                // Step 5: Fetch content analysis data
                const contentAnalysisResponse = await $http.post("get-content-analysis", _postdata2);
                contentAnalysisResponse.data.forEach(data => {
                    vm.formatContentAnalysis(data);
                });
            } else if (ActivityStateService.sessionDescriptor.type === "J") {
                // Step 1: Fetch actors
                if (vm.shared.inputAssignedRoles) {
                    vm.shared.inputAssignedRoles();
                }
    
                const actorsResponse = await $http.post("get-actors", _postdata2);
                vm.rawActors = actorsResponse.data;
                vm.actorMap = {};
                actorsResponse.data.forEach(a => {
                    vm.actorMap[a.id] = a;
                });
    
                // Step 2: Fetch role selections
                const roleSelResponse = await $http.post("get-role-sel-all", _postdata2);
                vm.rawRoleData = roleSelResponse.data;
                vm.posFreqTable = window.computePosFreqTable(roleSelResponse.data, vm.rawActors);
                if (vm.posFreqTable) {
                    vm.freqMax = Object.values(vm.posFreqTable)
                        .reduce((v, e) => Math.max(v, Object.values(e).reduce((v2, e2) => Math.max(e2, v2), 0)), 0);
                }
                vm.indvTable = window.computeIndTable(roleSelResponse.data, vm.rawActors);
                vm.shared.roleIndTable = vm.indvTable;
                vm.indvTableSorted = window.sortIndTable(vm.indvTable, vm.users);
    
                // Step 3: Group proposal
                const groupProposalResponse = await $http.post("group-proposal-stage", _postdata2);
                vm.shared.groupByUid = {};
                groupProposalResponse.data.forEach((s, i) => {
                    s.forEach(u => {
                        vm.shared.groupByUid[u.uid] = { index: i + 1, tmid: u.tmid };
                    });
                });
    
                // Step 4: Count chat messages by stage
                const chatCountResponse = await $http.post("get-chat-count-stage", _postdata2);
                vm.shared.chatByUid = {};
                vm.shared.chatByTeam = {};
                chatCountResponse.data.forEach(c => {
                    vm.shared.chatByUid[c.uid] = +c.count;
                    if (!vm.shared.chatByTeam[c.tmid]) {
                        vm.shared.chatByTeam[c.tmid] = 0;
                    }
                    vm.shared.chatByTeam[c.tmid] += +c.count;
                });
            }
        } catch (error) {
            console.error("Error in updateStateIni:", error);
        }
    };
    

    vm.getFreqColor = function(aid, pos){
        if(vm.posFreqTable && vm.posFreqTable[aid]) {
            let val = vm.posFreqTable[aid][pos] || 0;
            let p = val / vm.freqMax;

            return {
                "background": "rgba(0, 184, 166, " + p + ")"
            };
        }
    };

    vm.avgAlum = function (uid) {
        if (vm.alumState != null && vm.alumState[uid] != null) {
            var t = 0;
            var c = 0;
            for (var k in vm.alumState[uid]) {
                if (vm.alumState[uid][k]) c++;
                t++;
            }
            return t > 0 ? 100 * c / t : 0;
        }
        return 0;
    };

    vm.avgPreg = function (pid) {
        if (vm.alumState != null) {
            var t = 0;
            var c = 0;
            for (var k in vm.alumState) {
                if (vm.alumState[k] != null && vm.alumState[k][pid] != null) {
                    if (vm.alumState[k][pid]) c++;
                    t++;
                }
            }
            return t > 0 ? 100 * c / t : 0;
        }
        return 0;
    };

    vm.avgAll = function () {
        var t = 0;
        var c = 0;
        if (vm.alumState != null) {
            for (var u in vm.alumState) {
                for (var k in vm.alumState[u]) {
                    if (vm.alumState[u][k]) c++;
                    t++;
                }
            }
        }
        return t > 0 ? 100 * c / t : 0;
    };

    vm.progress = function () {
        var t = 0;
        if (vm.alumState != null) {
            for (var u in vm.alumState) {
                vm.alumState[u].forEach(() => t++);
            }
            return 100 * t / (Object.keys(vm.alumState).length * vm.questions.length);
        }
        return 0;
    };

    vm.progressAlum = function (uid) {
        var t = 0;
        if (vm.alumState != null && vm.alumState[uid] != null) {
            vm.alumState[uid].forEach(() => t++);
            return 100 * t / vm.questions.length;
        }
        return 0;
    };

    vm.progressPreg = function (pid) {
        var t = 0;
        if (vm.alumState != null) {
            for (var u in vm.alumState) {
                if (vm.alumState[u][pid] != null) {
                    t++;
                }
            }
            return 100 * t / Object.keys(vm.alumState).length;
        }
        return 0;
    };

    vm.lectPerformance = function () {
        var t = 0;
        var c = 0;
        if (vm.alumState != null) {
            for (var u in vm.alumState) {
                var a = vm.alumState[u];
                t++;
                c += a.score;
            }
            return 100 * c / t;
        }
        return 0;
    };

    vm.DFAll = function (ans, orden) {
        return ans.filter(function (e) {
            return e.orden == orden;
        }).map(function (e) {
            return e.sel;
        });
    };

    vm.DFL = function (ans, orden) {
        return ans.filter(function (e) {
            return e.orden == orden;
        }).length;
    };

    vm.DFAvg = function (ans, orden) {
        var a = ans.filter(function (e) {
            return e.orden == orden;
        }).map(function (e) {
            return e.sel;
        });
        return a.length > 0 ? a.reduce(function (v, e) {
            return v + e;
        }, 0) / a.length : 0;
    };

    vm.DFMinMax = function (ans, orden) {
        var a = ans.filter(function (e) {
            return e.orden == orden;
        }).map(function (e) {
            return e.sel;
        });
        a.sort();
        var n = a.length - 1;
        return a[n] - a[0];
    };

    vm.DFColor = function (ans, orden) {
        var avg = vm.DFAvg(ans, orden);
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

    vm.getAlumDoneTime = async function (postdata) {
        try {
            const response = await $http({
                url: "get-alum-done-time",
                method: "post",
                data: postdata
            });
            
            vm.numComplete = 0;
            response.data.forEach(function (row) {
                vm.numComplete += 1;
                if (vm.alumState[row.uid] == null) {
                    vm.alumState[row.uid] = row;
                } else {
                    vm.alumState[row.uid].dtime = ~~row.dtime;
                }
            });
        } catch (error) {
            console.error("Error fetching alum done time:", error);
        }
    };    

    vm.buildBarData = function (data) {
        var N = 5;
        vm.barData[0].values = [];
        for (var i = 0; i < N; i++) {
            var lbl = i * 20 + "% - " + (i + 1) * 20 + "%";
            vm.barData[0].values.push({ label: lbl, value: 0 });
        }
        data.forEach(function (d) {
            var rank = Math.min(Math.floor(N * d.score), N - 1);
            vm.barData[0].values[rank].value += 1;
        });
        vm.barOpts.chart.xAxis.axisLabel = vm.flang("performance");
    };

    vm.updateStateRub = function () {
        if (vm.iterationIndicator == 5) vm.computeDif();
        else if (vm.iterationIndicator == 6) vm.getAllReportResult();
    };

    vm.showName = function (report) {
        if (report.example)
            return report.title + " - " + vm.flang("exampleReport");
        else return report.id + " - " + vm.flang("reportOf") + " " + vm.users[report.uid].name;
    };

    vm.shared.getReports = async function () {
        try {
            const postdata = { sesid: ActivityStateService.sessionDescriptor.id };
            const response = await $http({ url: "get-report-list", method: "post", data: postdata });
            
            vm.reports = response.data;
            vm.exampleReports = response.data.filter(function (e) {
                return e.example;
            });
        } catch (error) {
            console.error("Error fetching report list:", error);
        }
    };
    
    vm.getReportResult = async function () {
        try {
            const postdata = { repid: vm.selectedReport.id };
            const response = await $http({ url: "get-report-result", method: "post", data: postdata });
            
            vm.result = response.data;
            vm.updateState();
        } catch (error) {
            console.error("Error fetching report result:", error);
        }
    };
    
    vm.getAllReportResult = async function () {
        try {
            const postdata = { sesid: ActivityStateService.sessionDescriptor.id };
            const response = await $http({
                url: "get-report-result-all",
                method: "post",
                data: postdata
            });
            
            vm.resultAll = {};
            const data = response.data;
            const n = data.length;
    
            // Initialize resultAll for users with role "A"
            for (const uid in vm.users) {
                if (vm.users[uid].role === "A") {
                    vm.resultAll[uid] = { reviews: 0, data: [] };
                }
            }
    
            // Process data
            data.forEach(function (d) {
                if (d && d.length > 0) {
                    const _uid = vm.getReportAuthor(d[0].rid);
                    
                    if (_uid !== -1) {
                        vm.resultAll[_uid].data = d;  // Set or update data for the user
                    }
    
                    // Update reviews count for each event
                    d.forEach(function (ev) {
                        if (vm.resultAll[ev.uid]) {
                            vm.resultAll[ev.uid].reviews += n;
                        }
                    });
                }
            });
    
            // Initialize pairArr based on the length of data[0]
            vm.pairArr = data[0] ? new Array(data[0].length) : [];
            
            // Build the rubric bar data
            vm.buildRubricaBarData(data);
        } catch (error) {
            console.error("Error fetching all report results:", error);
        }
    };
    
    vm.buildRubricaBarData = function (data) {
        var N = 3;
        var rubnms = ["1 - 2", "2 - 3", "3 - 4"];
        vm.barData[0].values = [];
        for (var i = 0; i < N; i++) {
            var lbl = i + 1 + " - " + (i + 2) + " (" + rubnms[i] + ")";
            vm.barData[0].values.push({ label: lbl, value: 0 });
        }
        data.forEach(function (d) {
            var score = d.reduce(function (e, v) {
                return e + v.val;
            }, 0) / d.length;
            var rank = Math.min(Math.floor(score - 1), N - 1);
            vm.barData[0].values[rank].value += 1;
        });
        vm.barOpts.chart.xAxis.axisLabel = $scope.translate("scoreDist");
    };

    vm.computeDif = function () {
        if (vm.result) {
            var pi = vm.result.findIndex(function (e) {
                return vm.users[e.uid].role == "P";
            });
            if (pi != -1) {
                var pval = vm.result[pi].val;
                var difs = [];
                vm.result.forEach(function (e, i) {
                    if (i != pi) {
                        difs.push(Math.abs(pval - e.val));
                    }
                });
                vm.buildRubricaDiffData(difs);
            }
        }
    };

    vm.buildRubricaDiffData = function (difs) {
        console.log("difs", difs);
        var N = 5;
        var lblnms = vm.flang("high2lowScale").split(",");
        vm.barData[0].values = [];
        for (var i = 0; i < N; i++) {
            // let lbl = (i * 0.5) + " - " + (i + 1) * 0.5;
            vm.barData[0].values.push({ label: lblnms[i], value: 0 });
        }
        difs.forEach(function (d) {
            var rank = Math.min(Math.floor(d * 2), N - 1);
            vm.barData[0].values[rank].value += 1;
        });
        vm.barOpts.chart.xAxis.axisLabel = vm.flang("correctDistance");
    };

    vm.getReportAuthor = function (rid) {
        if (vm.reports) {
            var rep = vm.reports.find(function (e) {
                return e.id == rid;
            });
            return rep ? rep.uid : -1;
        }
        return -1;
    };

    vm.getAvg = function (row) {
        if (row == null || row.length == 0) return "";
        var s = row.reduce(function (v, e) {
            return v + e.val;
        }, 0);
        return s / row.length;
    };

    vm.getInMax = function (res) {
        if (res == null) return [];
        var n = 0;
        for (var u in res) {
            n = Math.max(n, res[u].data.length);
        }
        return new Array(n);
    };

    vm.showReport = async function (rid) {
        try {
            // Step 1: Fetch the report data
            let postdata = { rid: rid };
            const reportResponse = await $http({ url: "get-report", method: "post", data: postdata });
            
            const modalData = { 
                report: reportResponse.data, 
                criterios: vm.shared.obtainCriterios() 
            };
            modalData.report.author = vm.users[reportResponse.data.uid];
    
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
                        evaluatorName: vm.users[row.uid].name
                    });
                } else {
                    modalData.answers[i].evaluatorName = vm.users[row.uid].name;
                }
            });
    
            // Step 5: Open the modal with the report details
            $uibModal.open({
                templateUrl: "static/report-details.html",
                controller: "ReportModalController",
                controllerAs: "vmc",
                size: "lg",
                scope: vm,
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
    
    vm.showReportByUid = async function (uid) {
        try {
            console.log(uid);
            const postdata = { uid: uid, sesid: ActivityStateService.sessionDescriptor.id };
            const response = await $http({ url: "get-report-uid", method: "post", data: postdata });
    
            const modalData = { report: response.data };
            modalData.report.author = vm.users[uid];
    
            $uibModal.open({
                templateUrl: "static/report-details.html",
                controller: "ReportModalController",
                controllerAs: "vmc",
                scope: vm,
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
    
    vm.broadcastReport = async function (rid) {
        try {
            const postdata = { sesid: ActivityStateService.sessionDescriptor.id, rid: rid };
            await $http({ url: "set-eval-report", method: "post", data: postdata });
            
            Notification.success("Reporte enviado a alumnos");
        } catch (error) {
            console.error("Error in broadcastReport:", error);
        }
    };
    
    vm.showDetailAnswer = async function (qid, uid, it) {
        const opts = ["A", "B", "C", "D", "E"];
        const postdata = { uid: uid, qid: qid, iteration: it };
        const qs = vm.questions.find(v => v.id === qid);
    
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
                    controllerAs: "vmc",
                    scope: vm,
                    resolve: {
                        data: function () {
                            _data.title = `${$scope.translate("answerOf")} ${$scope.users[uid].name}`;
                            _data.content = `${$scope.translate("question")}:\n${qstxt}\n\n` +
                                `${$scope.flang("answer")}:\n${alt}\n\n${$scope.flang("comment")}:\n` +
                                (_data.comment || "");
                            if (_data.confidence) {
                                _data.content += `\n\n${$scope.flang("confidenceLevel")}: ${_data.confidence}%`;
                            }
                            return _data;
                        }
                    }
                });
            } else {
                // Team-based selection (Step 2)
                postdata.tmid = vm.leaderTeamId[uid];
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
                    controllerAs: "vmc",
                    scope: vm,
                    resolve: {
                        data: function () {
                            let data = {};
                            data.title = `${$scope.translate("answerOf")} ${vm.leaderTeamStr[uid]}`;
                            data.content = `${$scope.translate("question")}:\n${qstxt}\n\n` +
                                `${$scope.translate("answer")}:\n${alt}\n\n`;
                            res.forEach(r => {
                                data.content += `${$scope.translate("comment")} ${r.uname}:\n${r.comment || ""}\n`;
                                if (r.confidence) {
                                    data.content += `${$scope.translate("confidenceLevel")}: ${r.confidence}%\n`;
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
    
    vm.openDFDetails = async function (group, orden) {
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
                controllerAs: "vmc",
                scope: vm,
                resolve: {
                    data: function () {
                        const data = {};
                        data.names = [
                            $scope.translate("individual"),
                            $scope.translate("anon"),
                            $scope.translate("teamWork")
                        ];
                        data.orden = orden;
                        data.group = group;
                        data.users = vm.users;
    
                        // Find group data for differential
                        const dfgr = vm.dataDF.find(e => e.tmid === group);
    
                        // Identify master data
                        const individualDF = dfgr.ind.find(e => e.orden === orden);
                        if (individualDF) {
                            data.master = vm.shared.dfs.find(e => e.id === individualDF.did);
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
    
    vm.openDF2Details = async function (group, did, uid) {
        console.log(group, did, uid);
        const postdata = {
            stageid: vm.iterationIndicator,
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
                controllerAs: "vmc",
                scope: vm,
                resolve: {
                    data: function () {
                        const data = {};
                        data.names = [vm.flang("answer")];
                        data.group = group;
                        data.users = vm.users;
                        data.df = vm.dfsStage.find(e => e.id === did);
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
                        data.stage = vm.shared.stagesMap[vm.iterationIndicator];
                        if (data.stage.type === "team") {
                            data.arr = group
                                ? vm.shared.difTable.filter(e => e.tmid === group && !e.group)
                                : vm.shared.difTable.filter(e => e.uid === uid && !e.group);
                        } else {
                            data.arr = vm.shared.difTable.filter(e => e.uid === uid && !e.group);
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
                        data.dfarr = vm.shared.buildArray(data.df.num);
    
                        return data;
                    }
                }
            });
        } catch (error) {
            console.error("Error in openDF2Details:", error);
        }
    };
    
    vm.openActorDetails = async function (uid, stageid) {
        // Determine the group ID for the user
        const group = vm.shared.groupByUid && vm.shared.groupByUid[uid] 
            ? vm.shared.groupByUid[uid].tmid 
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
                controllerAs: "vmc",
                scope: vm,
                resolve: {
                    data: function () {
                        const data = {};
                        data.group = group;
                        data.users = vm.users;
                        data.actorMap = vm.actorMap;
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
                        data.stage = vm.shared.stagesMap[stageid];
    
                        // Select the relevant entries based on the stage type
                        if (data.stage.type === "team") {
                            data.sel = vm.indvTableSorted.filter(e =>
                                vm.shared.groupByUid[e.uid].index ===
                                vm.shared.groupByUid[uid].index
                            );
                        } else {
                            data.sel = vm.indvTableSorted.filter(e => e.uid === uid);
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

    vm.exportCSV = async function () {
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
    
    vm.exportChatCSV = async function () {
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
    
    vm.exportSelCSV = async function () {
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
    
    vm.sortByAutorName = (a, b) => {
        let ua = vm.users[a] ? vm.users[a].name : a;
        let ub = vm.users[b] ? vm.users[b].name : b;
        return ua < ub ? -1 : 1;
    };

    vm.sortByAutorGroup = (a, b) => {
        return vm.shared.groupByUid[a].index - vm.shared.groupByUid[b].index;
    };

    vm.init();
};