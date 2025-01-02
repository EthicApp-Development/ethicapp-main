export function RolePlayingController($scope, $http, $timeout, $socket, Notification, $sce, $uibModal) {
    var self = $scope;
    self.designId = -1;
    self.iteration = 1;
    self.myUid = -1;
    self.documents = [];
    self.showDoc = true;
    self.showRole = false;
    self.selectedDocument = 0;
    self.finished = false;
    self.sesId = -1;
    self.chatExp = true;
    self.isJigsaw = false;

    self.stages = [];
    self.currentStageId = 0;
    self.currentStage = null;
    self.stagesMap = {};

    self.selectedStage = null;

    self.actors = [];
    self.jroles = [];
    self.jigsawMap = {};
    self.myJigsaw = null;
    self.sel = [];

    self.actorsPrev = [];
    self.selPrev = [];

    self.selections = [];

    self.ansIter1 = {};
    self.ansIter2 = {};

    self.chatMsgs = {};
    self.chatMsgsPrev = {};
    self.chatmsg = "";
    self.chatmsgreply = null;

    self.tmId = -1;
    self.teamMap = {};
    self.teamMapPrev = {};

    self.lang = "ES_CL/spanish";
    self.selectedActor = null;
    self.selectedActorPrev = null;

    self.posToJustify = {};
    self.justifyPosition = false;

    self.verified = false;

    self.init = function () {
        self.getSesInfo()
            .then(function () {
                $socket.on("stateChange", function (data) {
                    console.log("SOCKET.IO", data);
                    if (data.ses == self.sesId) {
                        window.location.reload();
                    }
                });

                $socket.on("chatMsgStage", function (data) {
                    console.log("SOCKET.IO", data);
                    if (data.stageid == self.currentStageId && 
                        data.tmid == self.tmId && self.currentStage.chat) {
                        updateChat();
                    }
                });

                $socket.on("diffReceived", function (data) {
                    console.log("SOCKET.IO", data);
                    if (data.ses == self.sesId) {
                        self.openDetails(data);
                    }
                });

                self.getMe();
            })
            .catch(function (error) {
                console.error("Error:", error);
            });
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
                    self.isJigsaw = data.type == "J";
    
                    if (self.iteration >= 1) {
                        // self.finished = true;
                    }
    
                    if (self.currentStageId != null || self.iteration >= 1) {
                        self.getDesignId(self.sesId)
                            .then(function () {
                                self.loadDocuments();
                                self.loadStageData();
                            })
                            .catch(reject);
                    }
    
                    if (self.isJigsaw) {
                        self.getJigsawRoles();
                    }
                    console.log(data);
    
                    resolve();
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
                url: "get-design-by-sesid",
                method: "post",
                data: postData,
                headers: { "Content-Type": "application/json" }
            })
                .then(function (response) {
                    console.log("Response data:", response.data[0].design);
                    self.designId = response.data[0].design;
                    resolve();
                })
                .catch(reject);
        });
    };
    
    function updateChat(count) {
        $http.post("get-chat-stage", { stageid: self.currentStageId })
            .then(function (response) {
                var data = response.data;
                self.chatMsgs = {};
                data.forEach(function (msg) {
                    if (msg.parent_id) {
                        msg.parent = data.find(function (e) {
                            return e.id == msg.parent_id;
                        });
                    }
                    self.chatMsgs[msg.stageid] = self.chatMsgs[msg.stageid] || [];
                    self.chatMsgs[msg.stageid].push(msg);
                });
                console.log(self.chatMsgs);
            })
            .catch(function (error) {
                console.error("Error updating chat:", error);
            });
    }    

    self.getMe = function () {
        $http.post("get-my-name")
            .then(function (response) {
                var data = response.data;
                self.lang = data.lang === "spanish" ? "ES_CL/spanish" : "EN_US/english";
                self.updateLang(self.lang);
            })
            .catch(function (error) {
                console.error("Error fetching user language:", error);
            });
    };
    
    self.selectActor = function (i) {
        if (self.selectedActor === i) {
            self.selectedActor = null;
        } else {
            self.selectedActor = i;
        }
    };
    
    self.selectActorView = function (i) {
        self.selectedActorPrev = i;
    };
    
    self.getPlaceholder = function () {
        var a = self.actors[self.selectedActor];
        if (self.selectedActor == null || a == null) {
            return "Seleccione un rol";
        } else if (a.jorder) {
            return "Escribe tu justificación para el ORDEN EN QUE HAS UBICADO a " + a.name;
        } else {
            return "Escribe tu justificación SOBRE EL ROL de " + a.name;
        }
    };
    
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
    
    self.getJigsawRoles = function () {
        $http.post("get-my-jigsaw-roles")
            .then(function (response) {
                self.jroles = response.data;
                self.jigsawMap = {};
                response.data.forEach(function (j) {
                    self.jigsawMap[j.id] = j;
                });
                self.getAssignedJigsawRole();
            })
            .catch(function (error) {
                console.error("Error loading jigsaw roles:", error);
            });
    };
    
    self.getAssignedJigsawRole = function () {
        $http.post("get-assigned-jigsaw-role")
            .then(function (response) {
                var data = response.data;
                if (data.length > 0) {
                    self.myJigsaw = data[0].roleid;
                } else if (self.jroles.length > 0) {
                    $http.post("assign-cyclic-jigsaw-role", {
                        cycle: self.jroles.length,
                        stageid: self.currentStageId
                    })
                    .then(function () {
                        self.getAssignedJigsawRole();
                    })
                    .catch(function (error) {
                        console.error("Error assigning jigsaw role:", error);
                    });
                }
                // self.inputAssignedRoles();
            })
            .catch(function (error) {
                console.error("Error fetching assigned jigsaw role:", error);
            });
    };
    
    self.loadStageData = function () {
        $http.post("get-stages", {})
            .then(function (response) {
                var data = response.data;
                self.stages = data;
                self.selectStage2(self.stages.length - 1);
                self.currentStage = self.stages.find(function (e) {
                    return e.id == self.currentStageId;
                });
                self.stagesMap = {};
                data.forEach(function (s) {
                    self.stagesMap[s.id] = s;
                });
    
                if (self.currentStage && self.currentStage.type === "team") {
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
                            if (self.isJigsaw) {
                                self.inputAssignedRoles();
                            }
                        })
                        .catch(function (error) {
                            console.error("Error loading team stage:", error);
                        });
    
                    if (self.currentStage.prev_ans !== "" && self.currentStage.prev_ans != null) {
                        var p = {
                            stageid: self.currentStageId,
                            prevstages: self.currentStage.prev_ans
                        };
                        $http.post("get-team-actor-selection", p)
                            .then(function (response) {
                                self.teamSel = response.data;
                                self.structureSelData();
                            })
                            .catch(function (error) {
                                console.error("Error loading team actor selection:", error);
                            });
                    }
    
                    if (self.currentStage.chat) {
                        updateChat();
                    }
                }
    
                if (self.stages.length > 1) {
                    self.selectStage(self.stages.length - 1);
                }
            })
            .catch(function (error) {
                console.error("Error loading stages:", error);
            });
    
        if (self.currentStageId != null) {
            $http.post("get-actors", { stageid: self.currentStageId })
                .then(function (response) {
                    self.actors = response.data;
                    self.posToJustify = {};
                    self.justifyPosition = false;
                    self.actors.forEach(function (a, i) {
                        if (a.jorder) {
                            self.posToJustify[i] = true;
                            self.justifyPosition = true;
                        }
                    });
                    self.shuffleActors();
                    if (self.sel.length === self.actors.length && self.sel.length > 0) {
                        self.populateActors();
                    }
                })
                .catch(function (error) {
                    console.error("Error loading actors:", error);
                });
    
            $http.post("get-my-actor-sel", { stageid: self.currentStageId })
                .then(function (response) {
                    self.sel = response.data;
                    if (self.sel.length === self.actors.length && self.sel.length > 0) {
                        self.populateActors();
                    }
                })
                .catch(function (error) {
                    console.error("Error loading actor selections:", error);
                });
        }
    };
    
    self.populateActors = function () {
        var acts = [];
        self.sel.forEach(function (s) {
            var a = self.actors.find(function (e) {
                return e.id == s.actorid;
            });
            a.comment = s.description;
            a.sent = s.description != "" && s.description != null;
            if(self.wordCount(a.comment) < a.word_count){
                a.sent = false;
            }
            acts.push(a);
        });
        self.actors = acts;
    };

    self.shuffleActors = function () {
        self.actors = self.actors.map(function (a) {
            return [Math.random(), a];
        }).sort(function (a, b) {
            return a[0] - b[0];
        }).map(function (a) {
            return a[1];
        });
    };

    self.populateActorsPrev = function () {
        var acts = [];
        self.selPrev.forEach(function (s) {
            var a = self.actorsPrev.find(function (e) {
                return e.id == s.actorid;
            });
            if (a) {
                a.comment = s.description;
                a.sent = s.description != "" && s.description != null;
                if(self.wordCount(a.comment) < a.word_count){
                    a.sent = false;
                }
                acts.push(a);
            }
        });
        self.actorsPrev = acts;
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
        self.showRole = false;
    };

    self.selectRoleDescr = function () {
        self.showRole = true;
        self.showDoc = false;
        self.selectedStage = null;
    };

    self.selectStage = function (i) {
        if (self.stages[self.selectedStage] && self.stages[self.selectedStage].dirty) {
            notify("Error", "Debe completar el diferencial antes de cambiar");
            return;
        }
        self.selectedStage = i;
        self.stages[self.selectedStage].cr = self.stages[self.selectedStage].c;
        self.showDoc = false;
        self.showRole = false;
        self.chatmsg = "";
        self.selPrev = [];
        self.actorsPrev = [];
        self.chatMsgsPrev = {};
    
        $http.post("get-actors", { stageid: self.stages[self.selectedStage].id })
            .then(function (response) {
                self.actorsPrev = response.data;
                if (self.selPrev.length === self.actorsPrev.length && self.selPrev.length > 0) {
                    self.populateActorsPrev();
                }
            })
            .catch(function (error) {
                console.error("Error loading actors:", error);
            });
    
        $http.post("get-my-actor-sel", { stageid: self.stages[self.selectedStage].id })
            .then(function (response) {
                self.selPrev = response.data;
                if (self.selPrev.length === self.actorsPrev.length && self.actorsPrev.length > 0) {
                    self.populateActorsPrev();
                }
            })
            .catch(function (error) {
                console.error("Error loading actor selections:", error);
            });
    
        var st = self.stages[self.selectedStage];
        if (st.type === "team") {
            self.teamPrev = [];
            self.teamMapPrev = {};
            self.teamSelPrev = [];
            self.prevResPrev = {};
            self.prevStagesPrev = {};
    
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
                    if (self.isJigsaw) {
                        self.inputAssignedRoles();
                    }
                })
                .catch(function (error) {
                    console.error("Error loading team stage:", error);
                });
    
            if (st.prev_ans !== "" && st.prev_ans != null) {
                var p = {
                    stageid: st.id,
                    prevstages: st.prev_ans
                };
                $http.post("get-team-actor-selection", p)
                    .then(function (response) {
                        self.teamSelPrev = response.data;
                        self.structureSelDataPrev();
                    })
                    .catch(function (error) {
                        console.error("Error loading team actor selection:", error);
                    });
            }
        }
    
        if (st.chat) {
            $http.post("get-chat-stage", { stageid: st.id })
                .then(function (response) {
                    var data = response.data;
                    self.chatMsgsPrev = {};
                    data.forEach(function (msg) {
                        if (msg.parent_id) {
                            msg.parent = data.find(function (e) {
                                return e.id == msg.parent_id;
                            });
                        }
                        self.chatMsgsPrev[msg.stageid] = self.chatMsgsPrev[msg.stageid] || [];
                        self.chatMsgsPrev[msg.stageid].push(msg);
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
        self.showRole = false;
        self.chatmsg = "";
        self.selPrev = [];
        self.actorsPrev = [];
        self.chatMsgsPrev = {};
    
        $http.post("get-actors", { stageid: self.stages[self.selectedStage].id })
            .then(function (response) {
                self.actorsPrev = response.data;
                if (self.selPrev.length === self.actorsPrev.length && self.selPrev.length > 0) {
                    self.populateActorsPrev();
                }
            })
            .catch(function (error) {
                console.error("Error loading actors:", error);
            });
    
        $http.post("get-my-actor-sel", { stageid: self.stages[self.selectedStage].id })
            .then(function (response) {
                self.selPrev = response.data;
                if (self.selPrev.length === self.actorsPrev.length && self.actorsPrev.length > 0) {
                    self.populateActorsPrev();
                }
            })
            .catch(function (error) {
                console.error("Error loading actor selections:", error);
            });
    
        var st = self.stages[self.selectedStage];
        if (st.type === "team") {
            self.teamPrev = [];
            self.teamMapPrev = {};
            self.teamSelPrev = [];
            self.prevResPrev = {};
            self.prevStagesPrev = {};
    
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
                    if (self.isJigsaw) {
                        self.inputAssignedRoles();
                    }
                })
                .catch(function (error) {
                    console.error("Error loading team stage:", error);
                });
    
            if (st.prev_ans !== "" && st.prev_ans != null) {
                var p = {
                    stageid: st.id,
                    prevstages: st.prev_ans
                };
                $http.post("get-team-actor-selection", p)
                    .then(function (response) {
                        self.teamSelPrev = response.data;
                        self.structureSelDataPrev();
                    })
                    .catch(function (error) {
                        console.error("Error loading team actor selection:", error);
                    });
            }
        }
    
        if (st.chat) {
            $http.post("get-chat-stage", { stageid: st.id })
                .then(function (response) {
                    var data = response.data;
                    self.chatMsgsPrev = {};
                    data.forEach(function (msg) {
                        if (msg.parent_id) {
                            msg.parent = data.find(function (e) {
                                return e.id == msg.parent_id;
                            });
                        }
                        self.chatMsgsPrev[msg.stageid] = self.chatMsgsPrev[msg.stageid] || [];
                        self.chatMsgsPrev[msg.stageid].push(msg);
                    });
                })
                .catch(function (error) {
                    console.error("Error loading chat messages:", error);
                });
        }
    };
    
    self.sendActorSel = function (verify) {
        if (verify) {
            if (self.actors.some(function (a, i) {
                return (!self.justifyPosition 
                    && a.justified 
                    || self.justifyPosition 
                    && self.posToJustify[i]) 
                    && (a.comment == null 
                    || a.comment == "" 
                    || self.wordCount(a.comment) < a.word_count);
            })) {
                notify("Datos Faltantes", "Falta completar la justificación de algunos actores");
                return;
            }
        }
        self.actors.forEach(function (a, i) {
            var postdata = {
                orden:       i + 1,
                description: a.comment || "",
                actorid:     a.id,
                stageid:     self.currentStageId
            };
            console.log(postdata);
            $http.post("send-actor-selection", postdata)
                .then(function (response) {
                    var data = response.data;
                    a.dirty = false;
                    a.sent = a.comment != null && a.comment != "";
                    if (self.wordCount(a.comment) < a.word_count) {
                        a.sent = false;
                    }
                })
                .catch(function (error) {
                    console.error("Error al enviar la selección del actor:", error);
                });
        });
        self.selectedActor = null;
        if (verify) {
            self.verified = true;
        }
    };
    
    self.sendChatMsg = function () {
        var postdata = {
            stageid:   self.currentStageId,
            content:   self.chatmsg,
            tmid:      self.tmId,
            parent_id: self.chatmsgreply
        };
        // console.log(postdata);
        $http.post("add-chat-msg-stage", postdata)
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

    var notify = function notify(title, message, closable) {
        $uibModal.open({
            template: '<div><div class="modal-header"><h4>' + title + '</h4></div><div class="modal-body"><p>' + message + "</p></div></div>"
        });
    };

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
        self.lang = self.lang == "spanish" ? "ES_CL/spanish" : "EN_US/english";
        self.updateLang(self.lang);
    };

    self.openDetails = function (_data) {
        $uibModal.open({
            templateUrl:  "templ/direct-content.html",
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

    self.inputAssignedRoles = function () {
        $http.post("get-assigned-jigsaw-roles", { sesid: self.sesId })
            .then(function (response) {
                var data = response.data;
                data.forEach(function (d) {
                    if (self.teamMap[d.userid]) {
                        var j = self.jroles.find(function (e) {
                            return e.id == d.roleid;
                        });
                        if (j && j.name && self.teamMap[d.userid].indexOf(" - ") === -1) {
                            self.teamMap[d.userid] += " - " + j.name;
                        }
                    }
                    if (self.teamMapPrev[d.userid]) {
                        var _j = self.jroles.find(function (e) {
                            return e.id == d.roleid;
                        });
                        if (_j && _j.name && self.teamMapPrev[d.userid].indexOf(" - ") === -1) {
                            self.teamMapPrev[d.userid] += " - " + _j.name;
                        }
                    }
                });
            })
            .catch(function (error) {
                console.error("Error loading assigned jigsaw roles:", error);
            });
    };
    
    self.openPDFInNewTab = function (pdfPath) {
        window.open(pdfPath, "_blank");
    };
    self.init();
};
