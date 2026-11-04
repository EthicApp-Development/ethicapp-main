// The home's recent activities (#918), one `activity-description` card each.
// It replaces the old list's ActivityController, which the Activities page no
// longer uses (#1055).

import { recentActivities } from "../../helpers/recent-activities.js";

export function RecentActivitiesController($scope, ActivityCatalogService) {
    const vm = this;

    vm.activities = { ongoing: [], finished: [] };

    vm.update = function() {
        vm.activities = recentActivities(ActivityCatalogService.getActivities());
    };

    vm.isEmpty = function() {
        return vm.activities.ongoing.length === 0 && vm.activities.finished.length === 0;
    };

    vm.handleView = function(activity) {
        $scope.navigateTo(`/activities/${activity.sessionId}`);
    };

    const onCatalogUpdated = function() {
        $scope.$applyAsync(vm.update);
    };
    ActivityCatalogService.registerListener("onActivityCatalogUpdated", onCatalogUpdated);
    $scope.$on("$destroy", () => {
        ActivityCatalogService.unregisterListener("onActivityCatalogUpdated", onCatalogUpdated);
    });

    // The catalog answers an empty list when the request fails, and notifies
    // the listener either way.
    vm.ready = ActivityCatalogService.loadActivities();
}
