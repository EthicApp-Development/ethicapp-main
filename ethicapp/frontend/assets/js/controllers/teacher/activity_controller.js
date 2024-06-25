/*eslint func-style: ["error", "expression"]*/
export let ActivityController = ($scope, ActivitiesService, 
    DesignsService, SessionsService, DocumentsService,
    $filter, $http, Notification, $timeout) => {
    var self = $scope;
    // [DEPRECATED] self.selectedSes = {};
    self.error = false;
    self.showSpinner = false;

    self.init = function(){
        
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
        
        if (design == undefined || design.phases == undefined || 
            !Array.isArray(design.phases) || design.phases.length == 0) {
            Notification.error("No fue posible iniciar la actividad. El diseño tiene errores.");
        }

        // Take the first phase in the design
        let phase = design.phases[0];

        let params = {
            sessionId:   sessionId,
            phase:       phase,
            phaseNumber: 1
        };

        // Add phase 1 to the current activity, then start it
        ActivitiesService.addPhaseToCurrentActivity(params)
            .then((stageId) => {
                params.stageId = stageId;
                ActivitiesService.startPhaseInCurrentActivity(params)
                    .catch(error => {
                        console.error("[ActivityController.initializeActivity] Failed to " +
                            `initialize, error: ${error}`);
                        Notification.error("No se pudo iniciar la actividad");
                    });
            });
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
            const designId = ActivitiesService.currentActivity.dsgnid;
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