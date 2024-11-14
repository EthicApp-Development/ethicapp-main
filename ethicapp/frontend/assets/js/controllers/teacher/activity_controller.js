import { DesignCatalogService } from "../../services/design-catalog-service";

/*eslint func-style: ["error", "expression"]*/
export function ActivityController($scope, $filter, $http, Notification, $timeout,
    ActivityStateService, ActivityCatalogService, DesignCatalogService) {
    
    const vm = this;

    vm.error = false;
    vm.showSpinner = false;
    vm.activityDescription = "";

    vm.init = async function() {
        console.log("[ActivityController::init] initializing");
        await ActivityCatalogService.loadActivities();
        vm.checkContentAnalysisAvailability();
    };

    // Create Activity from launch activity
    vm.createSession = async function (designId) {
        vm.showSpinner = true;
    
        try {
            const designObj = await DesignCatalogService.getDesignById(designId);

            // Ensure the design is valid
            const result = await DesignCatalogService.validateDesign(designId);
            vm.error = !result;
    
            // TODO: properly resolve the activity type
            const postdata = { 
                name: designObj.metainfo.title, 
                descr: vm.activityDescription, 
                type: designObj.type == "semantic_differential" ? "T" : "R", 
                additionalConfig: {} }; 

            console.debug(`[ActivityController::createSession] postdata: '${JSON.stringify(postdata)}'`);
            
            // TODO: move to service & refactor
            // Add session activity
            const sessionResponse = await $http({
                url:    "add-session-activity",
                method: "post",
                data:   postdata
            });

            const sessionId = sessionResponse.data.id;

            if (isNaN(sessionId) || sessionId == null || sessionId === undefined) {
                throw new Error("Failed to create a session for the activity.");
            }

            // Call additional functions for activity creation and code generation
            console.debug("[ActivityController::createSession] pre createActivity");
            await vm.createActivity(sessionId, designId);

            console.debug("[ActivityController::createSession] pre generateAccessCode");
            await vm.generateAccessCode(sessionId);

            // Bootstrap the activity design in the activity session.
            await vm.startActivityDesign(designObj, sessionId);            

            // Switch to the page of the activity
            $scope.navigateTo(`/activities/${sessionId}`);
        } catch (error) {
            console.error("Error creating session:", error);
        } finally {
            vm.showSpinner = false;
        }
    };
    
    vm.createActivity = async function (sessionId, designId) {
        try {            
            console.debug(`[ActivityController::createActivity] pre add activity sesId: '${sessionId}' dsgnID: '${designId}'`);

            // Create the activity with the design that is required.
            await ActivityCatalogService.createActivity(sessionId, designId);
            
            // The design is now locked. It must be refreshed.
            // TODO: reload just the design that has been modified
            await DesignCatalogService.loadDesigns();

            // Refresh activities
            console.debug("[ActivityController::createSession] pre loadActivities");
            await ActivityCatalogService.loadActivities();   
        } catch (error) {
            console.error("Error creating activity:", error);
        }
    };
        
    vm.startActivityDesign = async function (design, sesid) {
        try {
            let stageCounter = 0;
            for (const phase of design.phases) {

                const postdata = {
                    number:   stageCounter + 1,
                    question: phase.q_text !== undefined ? phase.q_text : "",
                    grouping: phase.mode === "team" ? `${phase.stdntAmount}:${phase.grouping_algorithm}` : null,
                    type:     phase.mode,
                    anon:     phase.anonymous,
                    chat:     phase.chat,
                    sesid:    sesid,
                    prev_ans: ""
                };
    
                const stageResponse = await $http(
                    {
                        url: "add-stage",
                        method: "post",
                        data: postdata 
                    });
                const stageid = stageResponse.data.id;
    
                if (stageid) {
                    if (design.type === "semantic_differential") {
                        let counter = 1;
                        for (const question of phase.questions) {
                            const content = question.ans_format;
                            const p = {
                                name:       question.q_text,
                                tleft:      content.l_pole,
                                tright:     content.r_pole,
                                num:        content.values,
                                orden:      counter,
                                justify:    content.just_required,
                                stageid:    stageid,
                                sesid:      sesid,
                                word_count: content.min_just_length
                            };    
                            await $http({ url: "add-differential-stage", method: "post", data: p });
                            counter++;
                        }
    
                        const pp = { sesid: sesid, stageid: stageid };
                        await $http({ url: "session-start-stage", method: "post", data: pp });
                    } else if (design.type === "ranking") {
                        for (const role of phase.roles) {
                            const p = {
                                name:       role.name,
                                jorder:     role.type === "order",
                                justified:  role.type != null,
                                word_count: role.wc,
                                stageid:    stageid,
                            };
                            await $http({ url: "add-actor", method: "post", data: p });
                        }
    
                        const pp = { sesid: sesid, stageid: stageid };
                        await $http({ url: "session-start-stage", method: "post", data: pp });
                    }
                } else {
                    console.error("Error creating activity phase");
                }
                stageCounter++;
            }
        } catch (error) {
            console.error("Error in startActivityDesign:", error);
        }
    };
    
    vm.generateAccessCode = async function (id) {
        const postdata = { id: id };
        try {
            const response = await $http.post("generate-session-code", postdata);
            if (response.data.code != null) {
                ActivityStateService.sessionDescriptor.code = response.data.code;
            }
        } catch (error) {
            console.error("Error generating session code:", error);
        }
    };
    
    vm.currentActivities = function(type){
        try {
            let activities = ActivityCatalogService.getActivities();
            if (!Array.isArray(activities) || activities.length === 0) {
                return;
            }
            if (type == 0) return activities.filter(function(activity) {
                return activity.status != 3 && activity.archived == false;
            });
            if (type == 1) return activities.filter(function(activity) {
                return activity.status == 3 && activity.archived == false;
            });
            if (type == 2) return activities.filter(function(activity) {
                return activity.archived;
            });    
        } catch (error) {
            console.error("[ActivityController::currentActivities] An error ocurred.");
        }
    };

    vm.createCopy = function(ses){
        vm.createSession(ses.name, ses.descr, ses.type, ses.dsgnid);
        ActivityCatalogService.loadActivities();
        vm.shared.updateSesData();
    };

    vm.checkContentAnalysisAvailability = function() {
        $http.post("/content-analysis-availability")
            .then(function(response) {
                if (response.status === 200) {
                    vm.isContentAnalysisEnabled = true;
                } else {
                    vm.isContentAnalysisEnabled = false;
                }
            })
            .catch(function(error) {
                vm.isContentAnalysisEnabled = false;
            });
    };

    vm.init();
};