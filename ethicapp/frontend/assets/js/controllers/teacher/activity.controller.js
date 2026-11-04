import { newestActivitiesFirst } from "../../helpers/activity-order.js";
import { statusCodes } from  "../../../../../common/modules/session-status.js";

/*eslint func-style: ["error", "expression"]*/
export function ActivityController($scope, ActivityCatalogService, $window) {
    
    const vm = this;

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

    vm.updateActivities = function() {
        const catalog = ActivityCatalogService.getActivities();

        if (!catalog) {
            console.warn("[ActivityController::updateActivities] No activities found.");
            return;
        }

        // The newest first, in the lists and in the home's recent activities (#918).
        const activities = newestActivitiesFirst(catalog);

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
        // The lists are already the newest first (updateActivities).
        return vm.getFilteredActivities().slice(startIndex, startIndex + vm.pageSize);
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

    vm.handleView = function(activity) {
        // Switch to the page of the activity
        $scope.navigateTo(`/activities/${activity.sessionId}`);
    };

    const setArchived = async function(activity, archived) {
        try {
            await ActivityCatalogService.setArchived(activity.sessionId, archived);
        } catch (error) {
            console.error("[ActivityController::setArchived] The archive request failed.", error);
        }
    };

    vm.handleArchive = function(activity) {
        return setArchived(activity, true);
    };

    vm.handleUnarchive = function(activity) {
        return setArchived(activity, false);
    };

    vm.init();
};
