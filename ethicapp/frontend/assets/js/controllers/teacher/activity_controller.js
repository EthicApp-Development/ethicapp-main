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
    self.launchActivity = function(designId, description){
        self.showSpinner = true;
        let promises = [];

        // Step 1: load the design
        promises.push(() => { 
            return DesignsService.loadUserDesignById(designId); 
        });

        // Step 2: validate the design is appropriate to be launched
        promises.push(() => {
            let design = DesignsService.workingDesign;
            if (!design || design == null || 
                Object.keys(design).length === 0) {
                throw new Error("[ActivityController] A valid design is not set.");
            }            
            // Create a session wherein to run the activity
            return SessionsService.createSession(
                DesignsService.workingDesign.metainfo.title,
                description,
                DesignsService.resolveDesignTypeCharacter(DesignsService.workingDesign)
            );
        });

        // Step 3: Set the current session for the activity
        promises.push(result => {
            // After creating the session, enact the activity
            let sessionId = result.id;
        
            // Will set the current session and reload available sessions
            return SessionsService.setCurrentSession(sessionId);
        });

        // Step 4: Give the session an access code
        promises.push(sessionId => {
            return SessionsService.createSessionCode(sessionId);
        });

        // Step 5: Create the activity instance in the session
        promises.push(() => {
            const sessionId = SessionsService.currentSession.id;
            return ActivitiesService.createActivity(sessionId, designId, true);
        });

        // Step 6: Initialize the activity by giving it its first stage
        promises.push(() => {
            return self.initializeActitity();
        });

        // Step 7: Chain promises and handle any errors
        return promises.reduce((chain, currentPromise) => {
            return chain.then(currentPromise);
        }, Promise.resolve())
            .catch((error) => {
                console.error("[ActivityController.openActivity] Error opening activity:", error);
                Notification.error("Sorry, I could not open the activity!");
            });
    };

    self.initializeActivity = () => {
        let design = DesignsService.workingDesign;
        const sessionId = SessionsService.currentSession.id;

        // Add phase 1 to the current activity, then start it
        ActivitiesService.addPhaseToCurrentActivity(1)
            .then(() => {
                ActivitiesService.startPhaseInCurrentActivity(1)
                    .catch(error => {
                        console.error("[ActivityController.initializeActivity] Failed to " +
                            `initialize, error: ${error}`);
                        Notification.error("No se pudo iniciar la actividad");
                    });
            });
 
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
        let promises = [];
        
        // Step 1: look up the activity
        promises.push(() => {
            return ActivitiesService.lookUpActivity(activityId);
        });

        // Step 2: set the current activity
        promises.push((act) => {
            return ActivitiesService.setCurrentActivity(act);
        });

        // Step 3: set the current design
        promises.push(() => {
            const designId = ActivitiesService.currentActivity.designId;
            return DesignsService.loadUserDesignById(designId);
        });

        // Step 4: set the current session 
        promises.push(() => {
            const sessionId = ActivitiesService.currentActivity.session;
            return SessionsService.setCurrentSession(sessionId);
        });

        // Chain promises and handle any errors
        return promises.reduce((chain, currentPromise) => {
            return chain.then(currentPromise);
        }, Promise.resolve())
            .then(() => {
                // Switch to the activity view after all promises are resolved.
                self.selectView("activity");
            })
            .catch((error) => {
                console.error("[ActivityController.openActivity] Error opening activity:", error);
                Notification.error("Sorry, I could not open the activity!");
            });
    };

    self.archiveActivity = function(act, $event){
        $event.stopPropagation();
        SessionsService.archiveSession(act.session)
            .then(() => {
                Notification.info("Actividad archivada");
                act.archived = true;
            });
    };

    self.restoreActivity = function(act, $event){
        $event.stopPropagation();
        SessionsService.restoreSession(act.session)
            .then(() => {
                Notification.info("Actividad restaurada");
                act.archived = false;
            });
    };      

    self.init();
};