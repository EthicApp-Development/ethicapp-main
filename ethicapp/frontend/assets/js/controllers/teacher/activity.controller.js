import * as PhaseCreationHelpers from "../../helpers/phase-creation-helpers.js";
import { statusCodes } from  "../../../../../common/modules/session-status.js";

/*eslint func-style: ["error", "expression"]*/
export function ActivityController($scope, $http,
    ActivityCatalogService, DesignCatalogService) {
    
    const vm = this;

    vm.error = false;
    vm.showSpinner = false;
    vm.activityDescription = "";

    vm.activities = {
        ongoing: [],
        finished: [],
        archived: []
    };

    vm.init = async function() {
        console.debug("[ActivityController::init] initializing");

        const updateHandler = function() {
            $scope.$applyAsync(() => {
                vm.updateActivities();
            });
        };  

        ActivityCatalogService.registerListener("onActivityCatalogUpdated", 
            updateHandler);

        $scope.$on('$destroy', function () {
            ActivityCatalogService.unregisterListener("onActivityCatalogUpdated", 
                updateHandler);    
        }); 

        await ActivityCatalogService.loadActivities();

        console.log(`[ActivityController::init] ${vm.activities.ongoing.length} ongoing, ${vm.activities.finished.length} finished and ${vm.activities.archived.length} archived activities loaded.`);
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

    vm.updateActivities = function() {
        const activities = ActivityCatalogService.getActivities();

        if (!activities) {
            console.warn("[ActivityController::updateActivities] No activities found.");
            return;
        }

        const normalizeStatus = (status) => {
            const parsedStatus = Number(status);
            return Number.isNaN(parsedStatus) ? status : parsedStatus;
        };

        try {
            vm.activities.archived = activities.filter((activity) => {
                return activity.archived;
            });

            vm.activities.ongoing = activities.filter((activity) => {
                const activityStatus = normalizeStatus(activity.status);
                return !activity.archived &&
                    (activityStatus === statusCodes.initiated ||
                     activityStatus === statusCodes.in_progress);
            });

            vm.activities.finished = activities.filter((activity) => {
                const activityStatus = normalizeStatus(activity.status);
                return !activity.archived &&
                    activityStatus === statusCodes.finished;
            });
        } catch (error) {
            console.error("[ActivityController::updateActivities] An error ocurred.");
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

    vm.handleSelect = function(activity) {
        // Switch to the page of the activity
        console.debug("[ActivityController::handleSelect] Navigating to activity", activity);
        $scope.navigateTo(`/activities/${activity.sessionId}`);
    };

    vm.handleView = function(activity) {
        // Switch to the page of the activity
        console.debug("[ActivityController::handleView] Navigating to activity", activity);
        $scope.navigateTo(`/activities/${activity.sessionId}`);
    };

    vm.handleArchive = async function(activity) {
        await ActivityCatalogService.toggleArchived(activity.sessionId);
    };

    vm.init();
};
