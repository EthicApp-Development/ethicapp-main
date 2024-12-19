import * as PhaseCreationHelpers from "../../helpers/phase-creation-helpers.js";

/*eslint func-style: ["error", "expression"]*/
export function ActivityController($scope, $http,
    ActivityCatalogService, DesignCatalogService) {
    
    const vm = this;

    vm.error = false;
    vm.showSpinner = false;
    vm.activityDescription = "";

    vm.init = async function() {
        console.debug("[ActivityController::init] initializing");
        await ActivityCatalogService.loadActivities();
        // vm.checkContentAnalysisAvailability();
    };

    vm.createSession = async function (designId) {
        vm.showSpinner = true;
    
        try {
            // Ensure the design is valid
            const result = await DesignCatalogService.isDesignValid(designId);
            vm.error = !result;

            if (!result) {
                console.error(
                    `Cannot create session based on design ${designId} because it is invalid`);
                return;
            }    
            
            const design = await DesignCatalogService.getDesignById(designId);
            
            // Create the activity with the design that is required.
            const sessionId = await ActivityCatalogService.createActivity(design, 
                vm.activityDescription);

            // The design is locked remotely. We need to lock it locally too.
            await DesignCatalogService.lockDesign(designId, true);

            // Switch to the page of the activity
            $scope.navigateTo(`/activities/${sessionId}`);
        } catch (error) {
            console.error("Error creating session:", error);
        } finally {
            vm.showSpinner = false;
        }
    };

    vm.startActivityDesign = async function (design, sessionId) {
        try {
            // Bootstrap the first phase of the design
            const phase = design.phases[0];
            const requestObj = PhaseCreationHelpers.phaseCreationRequestObject(phase, 1, sessionId);

            const stageResponse = await $http({
                url: `/activities/${sessionId}/phases`,
                method: "post",
                data: requestObj,
            });
            
            const stageid = stageResponse.data.id;
            
            if (stageid) {
                // Build the phase items
                const builder = PhaseCreationHelpers.itemBuilders[design.type];

                if (builder) {
                    await builder(phase, stageid, sessionId);
                } else {
                    console.warn(`No handler found for design type: ${design.type}`);
                }
            } else {
                console.error("Error creating activity phase");
            }

            await $http({ 
                url: `/activities/${sessionId}/phase_transition`, 
                method: "post", 
                data: { phase_id: stageid }
            });
                
        } catch (error) {
            console.error("Error in startActivityDesign:", error);
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