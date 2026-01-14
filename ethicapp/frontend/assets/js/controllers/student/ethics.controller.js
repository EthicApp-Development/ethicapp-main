import { sdAddChatMessage } from "../../helpers/student-chat-helper.js"

export function EthicsController($scope, $http, $timeout, 
    StudentActivityStateService, StudentSocketService, 
    Notification, $sce, $uibModal, $translate) {
    var self = $scope;
    self.designId = -1;
    self.iteration = 1;
    self.myUid = -1;
    self.documents = [];
    self.showDoc = true;
    self.selectedDocument = 0;
    self.finished = false;
    self.sesId = -1;
    self.chatExp = false;

    self.stages = [];
    self.currentStageId = 0;
    self.currentStage = null;
    self.stagesMap = {};

    self.selectedStage = null;

    self.dfs = [];
    self.sel = [];

    self.dfsPrev = [];
    self.selPrev = [];

    self.selections = [];

    self.chatMsgs = {};
    self.chatMsgsPrev = {};
    self.chatmsg = "";
    self.chatmsgreply = null;

    self.tmId = -1;
    self.teamMap = {};

    self.selectedDF = null;
    self.selectedDFPrev = null;

    self.init = async function () {
        await self.loadSessionInfo();
        self.loadDocuments();
        self.initializeSocket();
    };

    self.initializeSocket = function () {
        if (!self.sesId || self.sesId < 0) {
            const msg = "Session Id is not defined";
            console.error(`[EthicsController::initializeSocket] ${msg}`);
            throw new Error(msg);
        }
        StudentSocketService.joinSession(self.sesId);

        $scope.$on("destroy", () => {
            StudentSocketService.disconnect();
        });

        $scope.$watch('tmId', function (newVal, oldVal) {
            if (oldVal > 0) {
                StudentSocketService.emitEvent("leaveGroup", `${oldVal}`);
                console.debug(`Left group: group-${oldVal}`);
            }

            if (newVal > 0) {
                StudentSocketService.emitEvent("joinGroup", `${newVal}`);
                console.debug(`Joined group: group-${newVal}`);
            }
        });

        StudentSocketService.onEvent("onPhaseTransition", (data) => {
            window.location.reload();
        });

        StudentSocketService.onEvent("onGroupMessage", (data) => {
            console.log(`[EthicsController::initializeSocket] onGroupMessage ${JSON.stringify(data)}`);
            $scope.$applyAsync(() => {
                if (!sdAddChatMessage(self, data)) {
                    console.error("[EthicsController::initializeSocket] Failed to add chat message to the scope");
                }
            });
        })

        StudentSocketService.onEvent("onShareResponse", (data) => {
            self.openDetails(data);
        });

        StudentSocketService.onEvent("onEndSession", (data) => {

        });
    };

    self.loadSessionInfo = async function () {
        try {
            const response = await $http({ url: "/get-ses-info", method: "post" });
            const data = response.data;

            self.iteration = data.iteration + 1;
            self.myUid = data.uid;
            self.sesName = data.name;
            self.sesId = data.id;
            self.sesSTime = data.stime;
            self.sesDescr = data.descr;
            self.currentStageId = data.current_stage;

            if (self.iteration > 1) {
                self.finished = true;
            }

            if (self.currentStageId != null || self.iteration >= 1) {
                await self.loadStageData();
            }

            await self.getDesignId(self.sesId);
        } catch (error) {
            console.error("Error in loadSessionInfo:", error);
            throw error; // Re-throw the error to propagate it if needed
        }
    };

    self.getDesignId = function (sesId) {
        return new Promise(function (resolve, reject) {
            var postData = {
                sesid: sesId
            };
            $http({
                url:     "get-design-by-sesid",
                method:  "post",
                data:    postData,
                headers: { "Content-Type": "application/json" }
            })
                .then(function (response) {
                    self.designId = response.data[0].design;
                    resolve(); 
                })
                .catch(reject); 
        });
    };

    async function updateChat(count) {
        try {
            // Make the POST request
            const response = await $http.post("get-diff-chat-stage", { stageid: self.currentStageId });
            const data = response.data;
    
            // Reset chat messages and update counts
            self.chatMsgs = {};
            self.dfs.forEach((e) => {
                e.c = 0;
            });
    
            // Process each message
            data.forEach((msg) => {
                // Find the differential
                const df = self.dfs.find((e) => e.id === msg.did);
                df.c = df.c ? df.c + 1 : 1;
    
                if (count || df.id === self.selectedDF) {
                    df.cr = df.c;
                }
    
                if (msg.parent_id) {
                    // Assign the parent message
                    msg.parent = data.find((e) => e.id === msg.parent_id);
                }
    
                // Group messages by differential ID
                self.chatMsgs[msg.did] = self.chatMsgs[msg.did] || [];
                self.chatMsgs[msg.did].push(msg);
            });
    
            // Update remaining counts
            self.dfs.forEach((e) => {
                e.cr = e.cr == null ? e.c : e.cr;
            });
    
            // Open chat for the first differential if only one exists
            if (self.dfs.length === 1) {
                self.openChat(self.dfs[0]);
            }
        } catch (error) {
            // Log the error for debugging
            console.error("Error updating chat:", error);
        }
    }
    
    self.openChat = function (df) {
        self.selDF = df;
        self.selectedDF = df.id;
        self.chatExp = true;
        df.cr = df.c;
    };

    // self.selectDF = (i) => {
    //     self.selectedDF = i;
    // };
    //
    // self.selectDFView = (i) => {
    //     self.selectedDFPrev = i;
    // };   

    self.loadDocuments = function () {
        var postdata = { dsgnid: self.designId };
        $http({
            url: "designs-documents",
            method: "post",
            data: postdata
        })
        .then(function (response) {
            self.documents = response.data;
        })
        .catch(function (error) {
            console.error("Error loading documents:", error);
        });
    };
    
    self.loadStageData = async function () {
        try {
            // Load stages
            const stagesResponse = await $http.post("get-stages", {});
            const stagesData = stagesResponse.data;
            self.stages = stagesData;
    
            const currentStage = self.stages.find(e => e.id == self.currentStageId);
            if (currentStage) {
                self.loadStageDetails(currentStage.number - 1);
                self.currentStage = currentStage;
            }
    
            self.stagesMap = self.stages.reduce((map, stage) => {
                map[stage.id] = stage;
                return map;
            }, {});
    
            if (self.currentStage?.type === "team") {
                try {
                    // Load team stage
                    const teamResponse = await $http.post("get-team-stage", { stageid: self.currentStageId });
                    const teamData = teamResponse.data;
                    self.team = teamData;
    
                    const alph = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                    self.teamMap = teamData.reduce((map, user, index) => {
                        map[user.id] = self.currentStage.anon ? alph[index] : user.name;
                        self.tmId = user.tmid;
                        return map;
                    }, {});
                } catch (error) {
                    console.error("Error loading team stage:", error);
                }
    
                if (self.currentStage.prev_ans) {
                    try {
                        // Load team differential selection
                        const prevResponse = await $http.post("/get-team-differential-selection", {
                            stageid: self.currentStageId,
                            prevstages: self.currentStage.prev_ans
                        });
                        self.teamSel = prevResponse.data.responses;
                        self.structureSelData();
                    } catch (error) {
                        console.error("Error loading team differential selection:", error);
                    }
                }
    
                if (self.currentStage.chat) {
                    await updateChat();
                }
            }
        } catch (error) {
            console.error("Error loading stages:", error);
        }
    
        if (self.currentStageId != null) {
            try {
                // Load differentials stage
                const dfsResponse = await $http.post("get-differentials-stage", { stageid: self.currentStageId });
                self.dfs = dfsResponse.data;
                if (self.dfs.length > 0 && self.sel.length > 0) {
                    self.populateDFs();
                }
            } catch (error) {
                console.error("Error loading differentials stage:", error);
            }
    
            try {
                // Load differential selection stage
                const selResponse = await $http.post("get-diff-selection-stage", { stageid: self.currentStageId });
                self.sel = selResponse.data;
                if (self.dfs.length > 0 && self.sel.length > 0) {
                    self.populateDFs();
                }
            } catch (error) {
                console.error("Error loading differential selection stage:", error);
            }
        }
    };
        
    self.populateDFs = function () {
        self.sel.forEach(s => {
            const df = self.dfs.find(e => e.id === s.did);
            if (df) {
                df.comment = s.comment || "";
                df.select = s.sel;
                df.sent = Boolean(s.comment);
            }
        });
    };
    
    self.populateDFsPrev = function () {
        self.selPrev.forEach(s => {
            const df = self.dfsPrev.find(e => e.id === s.did);
            if (df) {
                df.comment = s.comment || "";
                df.select = s.sel;
                df.sent = Boolean(s.comment);
            }
        });
    };
    
    self.structureSelData = function () {
        if (!Array.isArray(self.teamSel) || self.teamSel.length === 0) {
            // Nothing to update
            return;
        }
    
        // Group teamSel by stageid
        const byStage = self.teamSel.reduce((acc, item) => {
            acc[item.stageid] = acc[item.stageid] || [];
            acc[item.stageid].push(item);
            return acc;
        }, {});
    
        // Extract stage IDs
        self.prevStages = Object.keys(byStage);
    
        // Transform grouped stages into a user-based grouping
        self.prevRes = Object.values(byStage).map(stageArray =>
            stageArray.reduce((acc, item) => {
                acc[item.uid] = acc[item.uid] || [];
                acc[item.uid].push(item);
                return acc;
            }, {})
        );
    };
    
    self.structureSelDataPrev = function () {
        if (!Array.isArray(self.teamSelPrev) || self.teamSelPrev.length === 0) {
            // Nothing to update
            return;
        }
    
        // Group teamSelPrev by stageid
        const byStage = self.teamSelPrev.reduce((acc, item) => {
            acc[item.stageid] = acc[item.stageid] || [];
            acc[item.stageid].push(item);
            return acc;
        }, {});
    
        // Extract stage IDs
        self.prevStagesPrev = Object.keys(byStage);
    
        // Transform grouped stages into a user-based grouping
        self.prevResPrev = Object.values(byStage).map(stageArray =>
            stageArray.reduce((acc, item) => {
                acc[item.uid] = acc[item.uid] || [];
                acc[item.uid].push(item);
                return acc;
            }, {})
        );
    };
    
    self.selectDocument = function (i) {
        self.selectedDocument = i;
        self.showDoc = true;
    };

    self.switchStage = async function (stageIndex, showDocCondition = null) {
        if (self.stages[self.selectedStage] && self.stages[self.selectedStage].dirty) {
            const title = await $translate('error_response_dialog_title');
            const message = await $translate('incomplete_response_error_text');
            notify(title, message);
            return;
        }
    
        self.selectedStage = stageIndex;
        self.stages[self.selectedStage].cr = self.stages[self.selectedStage].c;
    
        // Apply specific showDoc logic if provided
        self.showDoc = showDocCondition !== null ? showDocCondition(stageIndex) : false;
    
        self.chatmsg = "";
        self.selPrev = [];
        self.dfsPrev = [];
        self.chatMsgsPrev = {};
    
        try {
            // Load differentials stage
            const dfsResponse = await $http.post("get-differentials-stage", { stageid: self.stages[self.selectedStage].id });
            self.dfsPrev = dfsResponse.data;
            if (self.selPrev.length === self.dfsPrev.length && self.selPrev.length > 0) {
                self.populateDFsPrev();
            }
        } catch (error) {
            console.error("Error loading differentials stage:", error);
        }
    
        try {
            // Load differential selection stage
            const selResponse = await $http.post("get-diff-selection-stage", { stageid: self.stages[self.selectedStage].id });
            self.selPrev = selResponse.data;
            if (self.selPrev.length === self.dfsPrev.length && self.dfsPrev.length > 0) {
                self.populateDFsPrev();
            }
        } catch (error) {
            console.error("Error loading differential selection stage:", error);
        }
    
        const st = self.stages[self.selectedStage];
        self.teamPrev = [];
        self.teamMapPrev = {};
        self.teamSelPrev = [];
        self.prevResPrev = {};
        self.prevStagesPrev = {};
    
        if (st.type === "team") {
            try {
                // Load team stage
                const teamResponse = await $http.post("get-team-stage", { stageid: st.id });
                const data = teamResponse.data;
                self.teamPrev = data;
                const alph = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                self.teamMapPrev = data.reduce((map, user, index) => {
                    map[user.id] = st.anon ? alph[index] : user.name;
                    self.tmId = user.tmid;
                    return map;
                }, {});
            } catch (error) {
                console.error("Error loading team stage:", error);
            }
    
            if (st.prev_ans !== "" && st.prev_ans != null) {
                try {
                    // Load team differential selection
                    const teamSelResponse = await $http.post("get-team-differential-selection", {
                        stageid: st.id,
                        prevstages: st.prev_ans,
                    });
                    self.teamSelPrev = teamSelResponse.data;
                    self.structureSelDataPrev();
                } catch (error) {
                    console.error("Error loading team differential selection:", error);
                }
            }
        }
    
        if (st.chat) {
            try {
                // Load chat messages
                const chatResponse = await $http.post("get-diff-chat-stage", { stageid: st.id });
                const chatData = chatResponse.data;
                self.chatMsgsPrev = chatData.reduce((map, msg) => {
                    if (msg.parent_id) {
                        msg.parent = chatData.find(e => e.id == msg.parent_id);
                    }
                    map[msg.did] = map[msg.did] || [];
                    map[msg.did].push(msg);
                    return map;
                }, {});
            } catch (error) {
                console.error("Error loading chat messages:", error);
            }
        }
    };

    self.selectStage = function (stageIndex) {
        self.switchStage(stageIndex)
            .catch(error => console.error("Error in selectStage:", error));
    };
    
    self.loadStageDetails = function (stageIndex) {
        self.switchStage(stageIndex, index => index === 0)
            .catch(error => console.error("Error in selectStage2:", error));
    };
        
    self.sendDFSel = async function (df) {
        const errorTitle = await $translate('error_response_dialog_title');

        if (df.select == null || df.select == -1) {
            const errorMessage = await $translate('semantic_differential_value_incomplete_text');
            notify(errorTitle, errorMessage);
            return;
        }
        
        if (df.justify === true && self.wordCount(df.comment) < df.word_count) {
            const errorMessage = await $translate('no_justification_error_text');
            notify(errorTitle, errorMessage);
            return;
        }

        var postdata = {
            response: [{
                sel: df.select,
                comment: df.comment,
                did: df.id,
                iteration: 0
            }]
        };

        const phaseId = self.currentStageId;

        // Submit the response
        $http.post(`/phases/${phaseId}/responses`, postdata)
            .then(function () {
                df.dirty = false;
                df.sent = true;
            })
            .catch(function (error) {
                console.error("Error sending response:", error);
            });

        self.selectedDF = null;
    };
    
    self.sendChatMsg = function () {
        try {
            // groupId, itemId, message
            StudentActivityStateService.sendMessageToGroup(
                self.tmid, self.selectedDF, self.chatmsg);
        }
        catch (error) { 
            console.error("Error sending chat message:", error);
        }
    };
    
    self.getDocURL = function () {
        var pdfPath = self.documents[self.selectedDocument].path;
        var escapedPdfPath = encodeURIComponent(pdfPath);
        var completeUrl = $sce.trustAsResourceUrl(escapedPdfPath);

        return completeUrl;
    };

    function notify(title, message) {
        $uibModal.open({
            template: '<div><div class="modal-header"><h4>' + title + 
            '</h4></div><div class="modal-body"><p>' + message + "</p></div></div>"
        });
    }

    self.openComment = function (com) {
        notify("Comentario", com);
    };

    self.openDetails = function (_data) {
        $uibModal.open({
            templateUrl:  "../../frontend/static/direct-content.html",
            controller:   "DirectContentController",
            controllerAs: "vm",
            scope:        self,
            resolve:      {
                data: function data() {
                    return _data;
                }
            }
        });
    };

    self.setReply = function (msg) {
        self.chatmsgreply = msg == null ? null : msg.id;
        document.getElementById("chat-input").focus();
    };

    self.wordCount = function (s) {
        return s ? s.split(" ").filter(function (e) {
            return e != "";
        }).length : 0;
    };

    self.buildArray = function (n) {
        var a = [];
        for (var i = 1; i <= n; i++) {
            a.push(i);
        }
        return a;
    };

    self.openPDFInNewTab = function (pdfPath) {
        window.open(pdfPath, "_blank");
    };
    self.init();
}