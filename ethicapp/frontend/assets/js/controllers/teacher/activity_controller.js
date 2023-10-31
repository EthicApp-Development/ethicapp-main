/*eslint func-style: ["error", "expression"]*/
export let ActivityController = ($scope, ActivitiesService, 
    DesignsService, SessionsService, DocumentsService,
    $filter, $http, Notification, $timeout) => {
    var self = $scope;
    self.selectedSes = {};
    self.error = false;
    self.showSpinner = false;

    self.init = function(){
        self.selectedSes = {};
    };

    // Create Activity from launch activity
    self.launchActivity = function(designId, instanceDescription){
        self.showSpinner = true;

        DesignsService.loadUserDesignById(designId).then(() => {
            return $http({
                url: "check-design", method: "post", data: { dsgnid: designId }
            }).then((data) => {
                if (!("result" in data) || data.result == null || 
                    Object.keys(data.result).length === 0) {
                    throw new Error("[ActivityController] Could not validate the design");
                }
                let postdata = { 
                    name:  DesignsService.workingDesign.metainfo.title, 
                    descr: instanceDescription,
                    type:  DesignsService.resolveDesignTypeCharacter(DesignsService.workingDesign) };
                
                // Create a session wherein to run the design
                return $http({
                    url:    "add-session-activity", 
                    method: "post", 
                    data:   postdata
                }).then(result => {
                    // After creating the session, enact the activity
                    let sessionId = result.id;
                
                    // Will set the current session and reload available sessions
                    return SessionsService.setCurrentSession(sessionId)
                        .then(() => {
                            // Will generate an access code for the current session
                            return SessionsService.createSessionCode(sessionId)
                                .then(() => {
                                    // Create the activity
                                    return ActivitiesService.createActivity(sessionId, designId)
                                        .then((result) => {
                                            let activityId = result.id;
                                            return DesignsService.loadUserDesignById(designId)
                                                .then(() => {
                                                    DocumentsService.loadDocumentsForSession(sessionId);
                                            
                                                    let act = ActivitiesService.lookUpActivity(activityId);
                                                    ActivitiesService.setCurrentActivity(act);
                                                    
                                                    return addActivityStages(designId, sessionId).then(() => {
                                                        self.showSpinner = false;
                                                        self.selectView("activity");
                                                    });
                                                });
                                        });
                                });
                        });
                });
            });
        }).catch(error => {
            console.log(`[Activity Controller] Error launching activity with design id:'${designId}' error:'${error}'`);
            Notification.error("Error al iniciar actividad");
        });
    };

    self.addActivityStages = (design, sessionId) => {
        let promises = design.phases.map((phase, index) => {
            var postdata = {
                number:   index + 1,
                question: phase.q_text !== undefined ? phase.q_text : "",

                // Group phases require number of members plus grouping algorithm, separated
                // with a colon. Otherwise, just assign null.
                grouping: phase.mode == "team" ?
                    phase.stdntAmount + ":" + phase.grouping_algorithm :
                    null,
                type:     phase.mode,
                anon:     phase.anonymous,
                chat:     phase.chat,
                sesid:    sessionId,
                prev_ans: ""
            };

            return $http({url: "add-stage", method: "post", data: postdata})
                .then(function (data) {
                    let stageid = data.id;
                    if (stageid != null) 
                    {
                        if (design.type == "semantic_differential") {
                            let _promises = phase.questions.map((question, index) => {
                                return () => {
                                    var content = question.ans_format;
                                    let p = {
                                        name:       question.q_text,
                                        tleft:      content.l_pole,
                                        tright:     content.r_pole,
                                        num:        content.values,
                                        orden:      index + 1,
                                        justify:    content.just_required,
                                        stageid:    stageid,
                                        sesid:      sessionId,
                                        word_count: content.min_just_length
                                    };
                                                        
                                    return $http({url: "add-differential-stage", method: "post", data: p})
                                        .then(() => {
                                            if (index === phase.questions.length - 1) {
                                                let pp = {sesid: sessionId, stageid: stageid};
                                                return $http({ url: "session-start-stage", method: "post", data: pp })
                                                    .then(() => {
                                                        Notification.success("Etapa creada correctamente");
                                                    });
                                            }
                                        });
                                };
                            });
                            _promises.reduce((chain, currentPromise) => {
                                return chain.then(currentPromise);
                            }, Promise.resolve());                            
                        }
                        else if (design.type == "ranking") {
                            let _promises = phase.roles.map((role, index) => {
                                return () => {
                                    let p = {
                                        name:       role.name,
                                        jorder:     role.type == "order",
                                        justified:  role.type != null,
                                        word_count: role.wc,
                                        stageid:    stageid,
                                    };
                            
                                    return $http({url: "add-actor", method: "post", data: p})
                                        .then((response) => {
                                            console.log("Actor added");
                                            if (index === phase.roles.length - 1) {  // Si es la última iteración
                                                let pp = {sesid: sessionId, stageid: stageid};
                                                return $http({ url: "session-start-stage", method: "post", data: pp })
                                                    .then(() => {
                                                        Notification.success("Etapa creada correctamente");
                                                    });
                                            }
                                        });
                                };
                            });
                            
                            _promises.reduce((chain, currentPromise) => {
                                return chain.then(currentPromise);
                            }, Promise.resolve());
                        }
                    }
                    else {
                        Notification.error("Error al crear la etapa");
                    }
                });
        });
        promises.reduce((chain, currentPromise) => {
            return chain.then(currentPromise);
        }, Promise.resolve());
    };

    self.getOngoingActivities = () => {
        return ActivitiesService.getOngoingActivities();
    };

    self.getFinishedActivities = () => {
        return ActivitiesService.getFinishedActivities();
    };

    self.getArchivedActivities = () => {
        return ActivitiesService.getArchivedActivities();
    };

    self.getSelectedDesignId = function(){
        return ActivitiesService.activityState.designId;
    };

    self.openActivity = (activityId) => {
        let act = ActivitiesService.lookUpActivity(activityId);
        ActivitiesService.setCurrentActivity(act);
        let sessionId = act.session;
        SessionsService.setCurrentSession(sessionId);
        let designId = act.design;
        DesignsService.loadUserDesignById(designId);
        DocumentsService.loadDocumentsForSession(sessionId);
        // Get Stages??
        self.selectView("activity");
    };

    self.archiveActivity = function(act, $event){
        $event.stopPropagation();
        SessionsService.archiveSession(act.session)
            .then(() => {
                Notification.info("Sesión archivada");
                act.archived = true;
            });
    };

    self.restoreActivity = function(act, $event){
        $event.stopPropagation();
        SessionsService.restoreSession(act.session)
            .then(() => {
                Notification.info("Sesión restaurada");
                act.archived = false;
            });
    };      

    // Select activity from Activities
    /*self.selectActivity = (activityId, sesId, design) => {
        self.selectView("activity");
        self.currentActivity.id = activityId;
        self.selectedId = sesId;
        self.selectedSes = getSession(sesId)[0];
        self.design = design;
        
        self.requestDocuments();
        self.requestSemDocuments();
        self.requestQuestions();
        self.getNewUsers();
        self.getMembers();
        self.shared.verifyTabs(); // TabsController
        self.shared.resetTab(); // TabsController

        if(self.shared.getStages) {
            self.shared.getStages();
        }
    };*/
    
    self.init();
};