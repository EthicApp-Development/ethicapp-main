import * as PhaseCreationHelpers from "../../helpers/phase-creation-helpers.js";
import { statusCodes } from  "../../../../../common/modules/session-status.js";

/*eslint func-style: ["error", "expression"]*/
export function ActivityController($scope, $http,
    ActivityCatalogService, DesignCatalogService, $window) {
    
    const vm = this;

    vm.error = false;
    vm.showSpinner = false;
    vm.activityDescription = "";
    vm.dsgnMode = 0;
    vm.userSearch = "";
    vm.currentPage = 1;
    vm.pageSize = 5;

    vm.activities = {
        ongoing: [],
        finished: [],
        archived: []
    };

    vm.init = async function() {
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
    };

    vm.goBack = function() {
        if ($window.history.length > 1) {
            $window.history.back();
            return;
        }

        $scope.navigateTo("/");
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
            vm.setPage(vm.currentPage);
        } catch (error) {
            console.error("[ActivityController::updateActivities] An error ocurred.");
        }
    };

    vm.setActivityMode = function(mode) {
        const nextMode = Number(mode);
        if (!Number.isInteger(nextMode)) {
            return;
        }

        vm.dsgnMode = [0, 1, 2].includes(nextMode) ? nextMode : 0;
        vm.currentPage = 1;
    };

    vm.getActiveActivities = function() {
        if (vm.dsgnMode === 1) {
            return vm.activities.finished;
        }
        if (vm.dsgnMode === 2) {
            return vm.activities.archived;
        }
        return vm.activities.ongoing;
    };

    vm.activityMatchesSearch = function(activity) {
        const query = String(vm.userSearch || "").trim().toLowerCase();
        if (query.length === 0) {
            return true;
        }

        return String(activity?.title || "").toLowerCase().includes(query);
    };

    vm.getFilteredActivities = function() {
        return vm.getActiveActivities().filter(vm.activityMatchesSearch);
    };

    vm.getTotalPages = function() {
        return Math.max(1, Math.ceil(vm.getFilteredActivities().length / vm.pageSize));
    };

    vm.getPaginatedActivities = function() {
        const startIndex = (vm.currentPage - 1) * vm.pageSize;
        return vm.getFilteredActivities()
            .sort((firstActivity, secondActivity) => {
                const firstTime = Number(new Date(firstActivity.time)) || 0;
                const secondTime = Number(new Date(secondActivity.time)) || 0;
                return secondTime - firstTime;
            })
            .slice(startIndex, startIndex + vm.pageSize);
    };

    vm.setPage = function(pageNumber) {
        const nextPage = Number(pageNumber);
        if (!Number.isInteger(nextPage)) {
            return;
        }

        vm.currentPage = Math.min(Math.max(nextPage, 1), vm.getTotalPages());
    };

    vm.previousPage = function() {
        vm.setPage(vm.currentPage - 1);
    };

    vm.nextPage = function() {
        vm.setPage(vm.currentPage + 1);
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
        $scope.navigateTo(`/activities/${activity.sessionId}`);
    };

    vm.handleView = function(activity) {
        // Switch to the page of the activity
        $scope.navigateTo(`/activities/${activity.sessionId}`);
    };

    vm.handleArchive = async function(activity) {
        await ActivityCatalogService.toggleArchived(activity.sessionId);
    };

    vm.init();
};
