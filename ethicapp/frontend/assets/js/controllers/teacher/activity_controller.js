/*eslint func-style: ["error", "expression"]*/
export let ActivityController = ($scope, ActivityStateService, $filter, $http, Notification, $timeout) => {
    var self = $scope;
    self.selectedSes = {};
    self.error = false;
    self.showSpinner = false;
    self.launchId = ActivityStateService.activityState;
    
    self.init =function(){
        self.selectedSes = {};
        self.launchDesignId = self.launchId.id;
        self.shared.getActivities();
        self.checkContentAnalysisAvailability();
    };

    //Create Activity from launch activity
    self.createSession = function (dsgnName, dsgndescr, dsgntype, dsgnid, additionalConfig) {
        console.log("config", additionalConfig);
        if (!additionalConfig) {
            additionalConfig = {};
        }
        self.showSpinner = true;
    
        $http({
            url: "check-design",
            method: "post",
            data: { dsgnid: dsgnid }
        })
        .then(function (response) {
            var data = response.data;
            self.error = !data.result;
            console.log(self.error);
            if (data.result) {
                var postdata = { name: dsgnName, descr: dsgndescr, type: dsgntype, additionalConfig: additionalConfig };
                $http({
                    url: "add-session-activity",
                    method: "post",
                    data: postdata
                })
                .then(function (response) {
                    console.log("SESSION CREATED");
                    var id = response.data.id;
                    self.createActivity(id, dsgnid);
                    self.generateCodeActivity(id);
                    self.shared.getActivities();
                    self.shared.updateSesData();
                    $timeout(function () {
                        self.showSpinner = false; 
                    }, 5000);
                })
                .catch(function (error) {
                    console.error("Error creating session activity:", error);
                });
            }
        })
        .catch(function (error) {
            console.error("Error checking design:", error);
        });
    };
    
    self.createActivity = function (sesID, dsgnID) {
        var postdata = { sesid: sesID, dsgnid: dsgnID };
        $http({ url: "add-activity", method: "post", data: postdata })
            .then(function (response) {
                console.log("ACTIVITY CREATED");
                var dsng = response.data.result;
                self.startActivityDesign(dsng, sesID);
                let result = self.shared.getActivities();
                result.then(
                    function (result) {
                        const filteredObj = result.filter(item => item.session === sesID)[0];
                        console.log(filteredObj);
                        self.selectActivity(filteredObj.id, sesID, dsng);
                    },
                    function (error) {
                        // Este código se ejecuta cuando la Promesa es rechazada
                        console.log(error);
                    }
                );
            })
            .catch(function (error) {
                console.error("Error creating activity:", error);
            });
    };
    
    self.startActivityDesign = function (design, sesid) {
        var stageCounter = 0;
        console.log(design);
        for (var phase of design.phases) {
            console.log(phase);
            var postdata = {
                number: stageCounter + 1,
                question: phase.q_text !== undefined ? phase.q_text : "",
                grouping: phase.mode == "team" ? phase.stdntAmount + ":" + phase.grouping_algorithm : null,
                type: phase.mode,
                anon: phase.anonymous,
                chat: phase.chat,
                sesid: sesid,
                prev_ans: ""
            };
            console.log(postdata);
    
            $http({ url: "add-stage", method: "post", data: postdata })
                .then(function (response) {
                    let stageid = response.data.id;
                    if (stageid != null) {
                        if (design.type == "semantic_differential") {
                            var counter = 1;
                            for (var question of phase.questions) {
                                var content = question.ans_format;
                                let p = {
                                    name: question.q_text,
                                    tleft: content.l_pole,
                                    tright: content.r_pole,
                                    num: content.values,
                                    orden: counter,
                                    justify: content.just_required,
                                    stageid: stageid,
                                    sesid: sesid,
                                    word_count: content.min_just_length
                                };
                                console.log(p);
                                $http({ url: "add-differential-stage", method: "post", data: p })
                                    .then(function () {
                                        let pp = { sesid: sesid, stageid: stageid };
                                        $http({ url: "session-start-stage", method: "post", data: pp })
                                            .then(function () {
                                                Notification.success("Etapa creada correctamente");
                                            })
                                            .catch(function (error) {
                                                console.error("Error starting session stage:", error);
                                            });
                                    })
                                    .catch(function (error) {
                                        console.error("Error adding differential stage:", error);
                                    });
                                counter++;
                            }
                        } else if (design.type == "ranking") {
                            let c = phase.roles.length;
                            for (let i = 0; i < phase.roles.length; i++) {
                                const role = phase.roles[i];
                                let p = {
                                    name: role.name,
                                    jorder: role.type == "order",
                                    justified: role.type != null,
                                    word_count: role.wc,
                                    stageid: stageid,
                                };
                                $http({ url: "add-actor", method: "post", data: p })
                                    .then(function () {
                                        console.log("Actor added");
                                        c -= 1;
                                        if (c == 0) {
                                            let pp = { sesid: sesid, stageid: stageid };
                                            $http({ url: "session-start-stage", method: "post", data: pp })
                                                .then(function () {
                                                    Notification.success("Etapa creada correctamente");
                                                })
                                                .catch(function (error) {
                                                    console.error("Error starting session stage:", error);
                                                });
                                        }
                                    })
                                    .catch(function (error) {
                                        console.error("Error adding actor:", error);
                                    });
                            }
                        }
                    } else {
                        Notification.error("Error al crear la etapa");
                    }
                })
                .catch(function (error) {
                    console.error("Error adding stage:", error);
                });
    
            stageCounter++;
            break;
        }
    };

    self.generateCodeActivity = function (ID) { // use it to generate the code
        var postdata = {
            id: ID
        };
        $http.post("generate-session-code", postdata)
            .then(function (response) {
                if (response.data.code != null) {
                    self.selectedSes.code = response.data.code;
                }
            })
            .catch(function (error) {
                console.error("Error generating session code:", error);
            });
    };
    
    self.currentActivities = function(type){
        try {
            if (!self.activities) {
                return;
            }
            if (type == 0) return self.activities.filter(function(activity) {
                return activity.status != 3 && activity.archived == false;
            });
            if (type == 1) return self.activities.filter(function(activity) {
                return activity.status == 3 && activity.archived == false;
            });
            if (type == 2) return self.activities.filter(function(activity) {
                return activity.archived;
            });    
        } catch (error) {
            
        }
    };

    self.designSelected = function(){
        return self.launchId.id;
    };

    self.createCopy = function(ses){
        self.createSession(ses.name, ses.descr, ses.type, ses.dsgnid);
        self.shared.getActivities();
        self.shared.updateSesData();
        Notification.success("Actividad copiada!");
    };

    self.checkContentAnalysisAvailability = function() {
        $http.post('/content-analysis-availability')
            .then(function(response) {
                if (response.status === 200) {
                    self.isContentAnalysisEnable = true;
                } else {
                    self.isContentAnalysisEnable = false;
                }
            })
            .catch(function(error) {
                self.isContentAnalysisEnable = false;
            });
    };

    self.init();
};