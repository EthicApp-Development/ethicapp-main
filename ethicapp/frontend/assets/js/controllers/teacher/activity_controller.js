import { DesignCatalogService } from "../../services/design-catalog-service";

/*eslint func-style: ["error", "expression"]*/
export function ActivityController($scope, $filter, $http, Notification, $timeout,
    ActivityStateService, ActivityCatalogService, DesignCatalogService) {
    var self = $scope;
    self.error = false;
    self.showSpinner = false;
    self.launchId = ActivityStateService.activityDescriptor;

    const vm = this;
    vm.activityDescription = "";

    vm.init = function() {
        console.log("[ActivityController::init] initializing");
        self.launchDesignId = self.launchId.id;
        ActivityCatalogService.loadActivities();
        self.checkContentAnalysisAvailability();
    };

    // Create Activity from launch activity
    vm.createSession = async function (designId) {
        self.showSpinner = true;
    
        try {
            const designObj = await DesignCatalogService.getDesignById(designId);

            // Check the design
            const checkResponse = await $http({
                url:    "check-design",
                method: "post",
                data:   { dsgnid: designId }
            });

            const checkData = checkResponse.data;
            self.error = !checkData.result;
    
            if (checkData.result) {
                const postdata = { 
                    name: designObj.metadata.title, 
                    descr: vm.activityDescription, 
                    type: designObj.type, 
                    additionalConfig: {} }; 
                
                // Add session activity
                const sessionResponse = await $http({
                    url:    "add-session-activity",
                    method: "post",
                    data:   postdata
                });
    
                const id = sessionResponse.data.id;
    
                // Call additional functions for activity creation and code generation
                console.log("[ActivityController::createSession] pre createActivity");
                await self.createActivity(id, dsgnid);
                console.log("[ActivityController::createSession] pre generateCodeActivity");
                await self.generateCodeActivity(id);
                
                // Refresh activities and session data
                console.log("[ActivityController::createSession] pre loadActivities");
                await ActivityCatalogService.loadActivities();

                console.log("[ActivityController::createSession] pre updateSesData");
                await self.shared.updateSesData();
                console.log("[ActivityController::createSession] post updateSesData");
            }
        } catch (error) {
            console.error("Error creating session:", error);
        } finally {
            // Hide spinner after delay
            $timeout(() => {
                self.showSpinner = false; 
            }, 5000);
        }
    };
    
    self.createActivity = async function (sesID, dsgnID) {
        try {
            const postdata = { sesid: sesID, dsgnid: dsgnID };            
            
            console.debug(`[ActivityController::createActivity] pre add activity sesId: '${sesID}' dsgnID: '${dsgnID}'`);
            const response = await $http({ url: "add-activity", 
                method: "post", data: postdata });
            
            const dsng = response.data.result;
            self.startActivityDesign(dsng, sesID);

            console.debug(`[ActivityController::createActivity] post start activity design response: ${JSON.stringify(response)
            } design: ${dsng}`);
            
            const activities = await ActivityCatalogService.loadActivities();
            const filteredObj = activities.find(item => item.session === sesID);
    
            if (filteredObj) {
                console.log(`[ActivityController::createActivity] found activity ${JSON.stringify(filteredObj)}`);
                // Note that the following method is implemented by 
                // ManagementController!
                self.selectActivity(filteredObj.id, sesID, dsng);
                console.log(`[ActivityController::createActivity] post selectActivity call.`);
            } else {
                console.warn("No activity found for session:", sesID);
            }
    
        } catch (error) {
            console.error("Error creating activity:", error);
        }
    };
        
    self.startActivityDesign = async function (design, sesid) {
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
    
    self.generateCodeActivity = function (id) {
        var postdata = {
            id: id
        };
        $http.post("generate-session-code", postdata)
            .then(function (response) {
                if (response.data.code != null) {
                    ActivityStateService.sessionDescriptor.code = response.data.code;
                }
            })
            .catch(function (error) {
                console.error("Error generating session code:", error);
            });
    };
    
    self.currentActivities = function(type){
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

    self.designSelected = function(){
        return self.launchId.id;
    };

    self.createCopy = function(ses){
        self.createSession(ses.name, ses.descr, ses.type, ses.dsgnid);
        ActivityCatalogService.loadActivities();
        self.shared.updateSesData();
        Notification.success("Actividad copiada!");
    };

    self.checkContentAnalysisAvailability = function() {
        $http.post("/content-analysis-availability")
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

    vm.init();
};