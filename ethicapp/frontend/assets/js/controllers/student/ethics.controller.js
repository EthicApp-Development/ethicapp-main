export function EthicsController($scope, $http, $timeout, 
    $socket, Notification, $sce, $uibModal, ngIntroService) {
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

    self.lang = "ES_CL/spanish";
    self.selectedDF = null;
    self.selectedDFPrev = null;

    

    self.init = function () {
        self.getSesInfo()
            .then(function () {
                $socket.on("stateChange", function (data) {
                    console.log("SOCKET.IO", data);
                    if (data.ses == self.sesId) {
                        window.location.reload();
                    }
                });

                $socket.on("chatMsg", function (data) {
                    console.log("SOCKET.IO", data);
                    if (data.tmid == self.tmId && self.currentStage.chat) {
                        updateChat();
                    }
                });

                $socket.on("diffReceived", function (data) {
                    console.log("SOCKET.IO", data);
                    if (data.ses == self.sesId) {
                        console.log("Open");
                        self.openDetails(data);
                    }
                });

                self.loadDocuments();
            })
            .catch(function (error) {
                console.error("Error:", error);
            });

        self.getMe();
    };

    self.getSesInfo = function () {
        return new Promise(function (resolve, reject) {
            $http({ url: "get-ses-info", method: "post" })
                .then(function (response) {
                    var data = response.data;
                    self.iteration = data.iteration + 1;
                    self.myUid = data.uid;
                    self.sesName = data.name;
                    self.sesId = data.id;
                    self.sesSTime = data.stime;
                    self.sesDescr = data.descr;
                    self.currentStageId = data.current_stage;
    
                    self.getDesignId(self.sesId)
                        .then(resolve)
                        .catch(reject);
    
                    if (self.iteration > 1) {
                        self.finished = true;
                    }
                    if (self.currentStageId != null || self.iteration >= 1) {
                        self.loadStageData();
                    }
                })
                .catch(reject);
        });
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

    function updateChat(count) {
        $http.post("get-diff-chat-stage", { stageid: self.currentStageId })
            .then(function (response) {
                var data = response.data;
                self.chatMsgs = {};
                self.dfs.forEach(function (e) {
                    e.c = 0;
                });
                data.forEach(function (msg) {
                    var df = self.dfs.find(function (e) {
                        return e.id == msg.did;
                    });
                    df.c = df.c ? df.c + 1 : 1;
                    if (count || df.id == self.selectedDF) df.cr = df.c;
                    if (msg.parent_id) {
                        msg.parent = data.find(function (e) {
                            return e.id == msg.parent_id;
                        });
                    }
                    self.chatMsgs[msg.did] = self.chatMsgs[msg.did] || [];
                    self.chatMsgs[msg.did].push(msg);
                });
                self.dfs.forEach(function (e) {
                    e.cr = e.cr == null ? e.c : e.cr;
                });
                if (self.dfs.length == 1) {
                    self.openChat(self.dfs[0]);
                }
            })
            .catch(function (error) {
                console.error("Error updating chat:", error);
            });
    }
    

    self.openChat = function (df) {
        self.selDF = df;
        self.selectedDF = df.id;
        self.chatExp = true;
        df.cr = df.c;
    };

    self.getMe = function () {
        $http.post("get-my-name")
            .then(function (response) {
                var data = response.data;
                self.lang = data.lang == "spanish" ? "ES_CL/spanish" : "EN_US/english";
                self.updateLang(self.lang);
            })
            .catch(function (error) {
                console.error("Error fetching user language:", error);
            });
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
    
    self.loadStageData = function () {
        $http.post("get-stages", {})
            .then(function (response) {
                var data = response.data;
                self.stages = data;
                console.log(self.stages);
                self.selectStage2(self.stages.find(e => e.id == self.currentStageId).number - 1);
    
                self.currentStage = self.stages.find(function (e) {
                    return e.id == self.currentStageId;
                });
                self.stagesMap = {};
                data.forEach(function (s) {
                    self.stagesMap[s.id] = s;
                });
    
                if (self.currentStage && self.currentStage.type == "team") {
                    $http.post("get-team-stage", { stageid: self.currentStageId })
                        .then(function (response) {
                            var data = response.data;
                            self.team = data;
                            self.teamMap = {};
                            var alph = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                            data.forEach(function (u, i) {
                                self.teamMap[u.id] = self.currentStage.anon ? alph[i] : u.name;
                                self.tmId = u.tmid;
                            });
                        })
                        .catch(function (error) {
                            console.error("Error loading team stage:", error);
                        });
    
                    if (self.currentStage.prev_ans !== "" && self.currentStage.prev_ans != null) {
                        var p = {
                            stageid: self.currentStageId,
                            prevstages: self.currentStage.prev_ans
                        };
                        $http.post("get-team-differential-selection", p)
                            .then(function (response) {
                                self.teamSel = response.data;
                                self.structureSelData();
                            })
                            .catch(function (error) {
                                console.error("Error loading team differential selection:", error);
                            });
                    }
                    if (self.currentStage.chat) {
                        updateChat();
                    }
                }
            })
            .catch(function (error) {
                console.error("Error loading stages:", error);
            });
    
        if (self.currentStageId != null) {
            $http.post("get-differentials-stage", { stageid: self.currentStageId })
                .then(function (response) {
                    self.dfs = response.data;
                    if (self.dfs.length > 0 && self.sel.length > 0) {
                        self.populateDFs();
                    }
                })
                .catch(function (error) {
                    console.error("Error loading differentials stage:", error);
                });
    
            $http.post("get-diff-selection-stage", { stageid: self.currentStageId })
                .then(function (response) {
                    self.sel = response.data;
                    if (self.dfs.length > 0 && self.sel.length > 0) {
                        self.populateDFs();
                    }
                })
                .catch(function (error) {
                    console.error("Error loading differential selection stage:", error);
                });
        }
    };
    
    self.populateDFs = function () {
        self.sel.forEach(function (s) {
            var a = self.dfs.find(function (e) {
                return e.id == s.did;
            });
            a.comment = s.comment;
            a.select = s.sel;
            a.sent = s.comment != "" && s.comment != null;
        });
        
    };

    self.populateDFsPrev = function () {
        self.selPrev.forEach(function (s) {
            var a = self.dfsPrev.find(function (e) {
                return e.id == s.did;
            });
            if (a) {
                a.comment = s.comment;
                a.select = s.sel;
                a.sent = s.comment != "" && s.comment != null;
            }
        });
    };

    self.structureSelData = function () {
        var byStage = {};
        self.teamSel.forEach(function (e) {
            if (!byStage[e.stageid]) {
                byStage[e.stageid] = [];
            }
            byStage[e.stageid].push(e);
        });
        self.prevStages = Object.keys(byStage);
        byStage = Object.values(byStage);
        byStage = byStage.map(function (arr) {
            var byUser = {};
            arr.forEach(function (e) {
                if (!byUser[e.uid]) {
                    byUser[e.uid] = [];
                }
                byUser[e.uid].push(e);
            });
            return byUser;
        });
        self.prevRes = byStage;
    };

    self.structureSelDataPrev = function () {
        var byStage = {};
        self.teamSelPrev.forEach(function (e) {
            if (!byStage[e.stageid]) {
                byStage[e.stageid] = [];
            }
            byStage[e.stageid].push(e);
        });
        self.prevStagesPrev = Object.keys(byStage);
        byStage = Object.values(byStage);
        byStage = byStage.map(function (arr) {
            var byUser = {};
            arr.forEach(function (e) {
                if (!byUser[e.uid]) {
                    byUser[e.uid] = [];
                }
                byUser[e.uid].push(e);
            });
            return byUser;
        });
        self.prevResPrev = byStage;
    };

    self.selectDocument = function (i) {
        self.selectedDocument = i;
        self.showDoc = true;
    };

    self.selectStage = function (i) {
        if (self.stages[self.selectedStage] && self.stages[self.selectedStage].dirty) {
            notify("Error", "Debe completar el diferencial antes de cambiar");
            return;
        }
        self.selectedStage = i;
        self.stages[self.selectedStage].cr = self.stages[self.selectedStage].c;
        self.showDoc = false;
        self.chatmsg = "";
        self.selPrev = [];
        self.dfsPrev = [];
        self.chatMsgsPrev = {};
    
        $http.post("get-differentials-stage", { stageid: self.stages[self.selectedStage].id })
            .then(function (response) {
                self.dfsPrev = response.data;
                if (self.selPrev.length === self.dfsPrev.length && self.selPrev.length > 0) {
                    self.populateDFsPrev();
                }
            })
            .catch(function (error) {
                console.error("Error loading differentials stage:", error);
            });
    
        $http.post("get-diff-selection-stage", { stageid: self.stages[self.selectedStage].id })
            .then(function (response) {
                self.selPrev = response.data;
                if (self.selPrev.length === self.dfsPrev.length && self.dfsPrev.length > 0) {
                    self.populateDFsPrev();
                }
            })
            .catch(function (error) {
                console.error("Error loading differential selection stage:", error);
            });
    
        var st = self.stages[self.selectedStage];
        self.teamPrev = [];
        self.teamMapPrev = {};
        self.teamSelPrev = [];
        self.prevResPrev = {};
        self.prevStagesPrev = {};
    
        if (st.type === "team") {
            $http.post("get-team-stage", { stageid: st.id })
                .then(function (response) {
                    var data = response.data;
                    self.teamPrev = data;
                    self.teamMapPrev = {};
                    var alph = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                    data.forEach(function (u, i) {
                        self.teamMapPrev[u.id] = st.anon ? alph[i] : u.name;
                        self.tmId = u.tmid;
                    });
                })
                .catch(function (error) {
                    console.error("Error loading team stage:", error);
                });
    
            if (st.prev_ans !== "" && st.prev_ans != null) {
                var p = {
                    stageid: st.id,
                    prevstages: st.prev_ans
                };
                $http.post("get-team-differential-selection", p)
                    .then(function (response) {
                        self.teamSelPrev = response.data;
                        self.structureSelDataPrev();
                    })
                    .catch(function (error) {
                        console.error("Error loading team differential selection:", error);
                    });
            }
        }
        if (st.chat) {
            $http.post("get-diff-chat-stage", { stageid: st.id })
                .then(function (response) {
                    var data = response.data;
                    self.chatMsgsPrev = {};
                    data.forEach(function (msg) {
                        if (msg.parent_id) {
                            msg.parent = data.find(function (e) {
                                return e.id == msg.parent_id;
                            });
                        }
                        self.chatMsgsPrev[msg.did] = self.chatMsgsPrev[msg.did] || [];
                        self.chatMsgsPrev[msg.did].push(msg);
                    });
                })
                .catch(function (error) {
                    console.error("Error loading chat messages:", error);
                });
        }
    };
    
    self.selectStage2 = function (i) {
        if (self.stages[self.selectedStage] && self.stages[self.selectedStage].dirty) {
            notify("Error", "Debe completar el diferencial antes de cambiar");
            return;
        }
        self.selectedStage = i;
        self.stages[self.selectedStage].cr = self.stages[self.selectedStage].c;
        self.showDoc = i === 0;
        self.chatmsg = "";
        self.selPrev = [];
        self.dfsPrev = [];
        self.chatMsgsPrev = {};
    
        $http.post("get-differentials-stage", { stageid: self.stages[self.selectedStage].id })
            .then(function (response) {
                self.dfsPrev = response.data;
                if (self.selPrev.length === self.dfsPrev.length && self.selPrev.length > 0) {
                    self.populateDFsPrev();
                }
            })
            .catch(function (error) {
                console.error("Error loading differentials stage:", error);
            });
    
        $http.post("get-diff-selection-stage", { stageid: self.stages[self.selectedStage].id })
            .then(function (response) {
                self.selPrev = response.data;
                if (self.selPrev.length === self.dfsPrev.length && self.dfsPrev.length > 0) {
                    self.populateDFsPrev();
                }
            })
            .catch(function (error) {
                console.error("Error loading differential selection stage:", error);
            });
    
        var st = self.stages[self.selectedStage];
        self.teamPrev = [];
        self.teamMapPrev = {};
        self.teamSelPrev = [];
        self.prevResPrev = {};
        self.prevStagesPrev = {};
    
        if (st.type === "team") {
            $http.post("get-team-stage", { stageid: st.id })
                .then(function (response) {
                    var data = response.data;
                    self.teamPrev = data;
                    self.teamMapPrev = {};
                    var alph = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
                    data.forEach(function (u, i) {
                        self.teamMapPrev[u.id] = st.anon ? alph[i] : u.name;
                        self.tmId = u.tmid;
                    });
                })
                .catch(function (error) {
                    console.error("Error loading team stage:", error);
                });
    
            if (st.prev_ans !== "" && st.prev_ans != null) {
                var p = {
                    stageid: st.id,
                    prevstages: st.prev_ans
                };
                $http.post("get-team-differential-selection", p)
                    .then(function (response) {
                        self.teamSelPrev = response.data;
                        self.structureSelDataPrev();
                    })
                    .catch(function (error) {
                        console.error("Error loading team differential selection:", error);
                    });
            }
        }
        if (st.chat) {
            $http.post("get-diff-chat-stage", { stageid: st.id })
                .then(function (response) {
                    var data = response.data;
                    self.chatMsgsPrev = {};
                    data.forEach(function (msg) {
                        if (msg.parent_id) {
                            msg.parent = data.find(function (e) {
                                return e.id == msg.parent_id;
                            });
                        }
                        self.chatMsgsPrev[msg.did] = self.chatMsgsPrev[msg.did] || [];
                        self.chatMsgsPrev[msg.did].push(msg);
                    });
                })
                .catch(function (error) {
                    console.error("Error loading chat messages:", error);
                });
        }
    };
    
    self.sendDFSel = function (df) {
        if (df.select == null || df.select == -1) {
            notify("Error", "El diferencial no está completo");
            return;
        }
        if (df.justify === true && self.wordCount(df.comment) < df.word_count) {
            notify("Error", "El comentario está incompleto");
            return;
        }
        var postdata = {
            sel: df.select,
            comment: df.comment,
            did: df.id,
            iteration: 0
        };
        $http.post("send-diff-selection", postdata)
            .then(function () {
                df.dirty = false;
                df.sent = true;
            })
            .catch(function (error) {
                console.error("Error sending differential selection:", error);
            });
        self.selectedDF = null;
    };
    
    self.sendChatMsg = function () {
        var postdata = {
            did: self.selectedDF,
            content: self.chatmsg,
            tmid: self.tmId,
            parent_id: self.chatmsgreply
        };
        $http.post("add-chat-msg", postdata)
            .then(function () {
                self.chatmsg = "";
                self.chatmsgreply = null;
            })
            .catch(function (error) {
                console.error("Error sending chat message:", error);
            });
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

    self.showInfo = function () {
        notify("Factor Detonante", self.sesDescr, false);
    };

    self.updateLang = function (lang) {
        $http.get("assets/i18n/" + lang + ".json")
            .then(function (response) {
                window.DIC = response.data;
            })
            .catch(function (error) {
                console.error("Error loading language file:", error);
            });
    };
    

    self.changeLang = function () {
        self.lang = self.lang == "EN_US/english" ? "ES_CL/spanish" : "EN_US/english";
        self.updateLang(self.lang);
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

    var introOptions = {
        steps: [{
            element: "#tabd0",
            intro:   "En esta pestaña encontrarás el caso a leer"
        }, {
            element: "#tabq0",
            intro:   "En esta pestaña se encuentra la lista de items" + 
            " que debes categorizar y justificar"
        }, {
            element: "#seslistbtn",
            intro:   "Usando este botón puedes volver a la lista de sesiones"
        }],
        showStepNumbers:    false,
        showBullets:        false,
        exitOnOverlayClick: true,
        exitOnEsc:          true,
        tooltipPosition:    "auto",
        nextLabel:          "Siguiente",
        prevLabel:          "Anterior",
        skipLabel:          "Salir",
        doneLabel:          "Listo"
    };

    ngIntroService.setOptions(introOptions);

    self.startTour = function () {
        ngIntroService.start();
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