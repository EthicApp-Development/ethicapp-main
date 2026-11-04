// The Activities page (#1050, epic #1046), `#!/activities`: finding an
// activity again before, during and after it runs. Its tabs are "En curso",
// "Terminadas" and "Archivadas", with the tab in the URL (`?tab=finished`,
// `?tab=archived`); the route does not reload on a search change, so the
// browser's Back and Forward switch tabs as a route update, and coming back
// from the dashboard restores the tab.
//
// Each tab is a table built by `helpers/activities-table.js`: one row per
// activity with its status, participants, code and dates, one visible action
// and a "⋯" menu. The dates come from `helpers/activity-dates.js`, in the
// browser's time zone and the UI language.
//
// Each part of the page has its own fragment, so later changes stay apart:
// - the filter bar (`activities-filters.template.html`), filled by #1051,
//   which filters the rows in `vm.getRows`;
// - the notice region (`activities-action-notice.template.html`), filled by
//   #1052, which adds the notices of `setArchived` and `vm.copyCode`;
// - the page of a teacher with no activities
//   (`activities-empty-page.template.html`), filled by #1053.
//
// The home and the dashboard keep the `activity-description` card.

import {
    ACTIVITIES_PAGE_SIZE,
    ACTIVITY_TABS,
    ROW_ACTION_ARCHIVE,
    ROW_ACTION_COPY_CODE,
    ROW_ACTION_LAUNCH_AGAIN,
    ROW_ACTION_OPEN_DASHBOARD,
    ROW_ACTION_REPORTS,
    ROW_ACTION_RESTORE,
    ROW_ACTION_VIEW_CASE,
    ROW_ACTION_VIEW_DESIGN,
    buildActivityTables,
    tabFromSearch,
    tabSearchValue,
    tableColumns,
} from "../../helpers/activities-table.js";
import { createActivityDateFormatter } from "../../helpers/activity-dates.js";

// The page's own URL search keys, which are not carried to the next page.
const PAGE_SEARCH_KEYS = ["tab"];

function initialVisibleCounts() {
    return Object.fromEntries(ACTIVITY_TABS.map(tab => [tab, ACTIVITIES_PAGE_SIZE]));
}

export function ActivitiesPageController($scope, $rootScope, $location, $translate, $window,
    ActivityCatalogService) {

    const vm = this;

    vm.tab = tabFromSearch($location.search());
    vm.loaded = false;
    vm.tables = { ongoing: [], finished: [], archived: [] };
    vm.visibleCounts = initialVisibleCounts();
    // Each tab's columns, built once so the headers' repeat stays stable.
    vm.columns = Object.fromEntries(ACTIVITY_TABS.map(tab => [tab, tableColumns(tab)]));
    // Session id → true while an action on it is pending, so a second click
    // does not repeat it.
    vm.busy = {};

    function uiLanguage() {
        return (typeof $translate?.use === "function" && $translate.use())
            || (typeof $translate?.proposedLanguage === "function"
                && $translate.proposedLanguage())
            || "en_US";
    }

    // Lists

    // The rows again from the catalog, with "today" taken now and the dates
    // in the current language.
    vm.refresh = function() {
        const dates = createActivityDateFormatter({ uiLanguage: uiLanguage() });
        vm.tables = buildActivityTables(ActivityCatalogService.getActivities(), dates);
    };

    vm.load = async function() {
        // The catalog answers an empty list when the request fails.
        await ActivityCatalogService.loadActivities();
        vm.refresh();
        vm.loaded = true;
        $scope.$applyAsync();
    };

    // Tabs

    vm.count = function(tab) {
        return vm.tables[tab]?.length || 0;
    };

    // The teacher has launched no activity yet (#1053 shows its own page).
    vm.hasNoActivities = function() {
        return vm.loaded && ACTIVITY_TABS.every(tab => vm.count(tab) === 0);
    };

    // A tab adds a history entry, as the tabs' links do.
    vm.selectTab = function(tab) {
        if (tab === vm.tab || !ACTIVITY_TABS.includes(tab)) {
            return;
        }
        vm.tab = tab;
        $location.search("tab", tabSearchValue(tab));
    };

    vm.$onRouteUpdate = function() {
        vm.tab = tabFromSearch($location.search());
    };

    // "Show more"

    // A tab's rows, newest first. The filters (#1051) apply here.
    vm.getRows = function(tab) {
        return vm.tables[tab] || [];
    };

    vm.getVisibleRows = function(tab) {
        return vm.getRows(tab).slice(0, vm.visibleCounts[tab]);
    };

    vm.hasMoreRows = function(tab) {
        return vm.getRows(tab).length > vm.visibleCounts[tab];
    };

    vm.showMore = function(tab) {
        vm.visibleCounts[tab] += ACTIVITIES_PAGE_SIZE;
    };

    // Row actions. Each one leaves the page or stays on its tab.

    async function withBusy(id, run) {
        if (vm.busy[id]) {
            return;
        }
        vm.busy[id] = true;
        try {
            await run();
        } finally {
            delete vm.busy[id];
            $scope.$applyAsync();
        }
    }

    // Copies the row's access code. Resolves true once copied. The notice
    // "Código copiado" is #1052's.
    vm.copyCode = async function(row) {
        if (!row?.code) {
            return false;
        }
        try {
            await $window.navigator.clipboard.writeText(row.code);
            return true;
        } catch (error) {
            console.error("[ActivitiesPageController] Could not copy the code.", error);
            return false;
        }
    };

    // Archives a finished activity or restores an archived one. The catalog
    // updates the activity and notifies the page, which builds its rows
    // again. The server refuses to archive an activity that is not finished
    // (409 ACTIVITY_NOT_FINISHED): the list was stale, so it is loaded again.
    // The notices, with "Deshacer", are #1052's.
    async function setArchived(row, archived) {
        try {
            await ActivityCatalogService.setArchived(row.id, archived);
        } catch (error) {
            if (error?.status === 409) {
                console.warn("[ActivitiesPageController] The server refused the archive change; "
                    + "reloading the activities.", error?.data?.code);
                await ActivityCatalogService.loadActivities();
                return;
            }
            console.error("[ActivitiesPageController] Error updating archived status.", error);
        }
    }

    const ACTIONS = {
        [ROW_ACTION_OPEN_DASHBOARD]: row => $scope.navigateTo(`/activities/${row.id}`),
        [ROW_ACTION_REPORTS]:        row => $scope.navigateTo(`/activities/${row.id}/reports`),
        [ROW_ACTION_COPY_CODE]:      row => vm.copyCode(row),
        [ROW_ACTION_VIEW_DESIGN]:    row => $scope.navigateTo(`/designs/${row.designId}`),
        [ROW_ACTION_VIEW_CASE]:      row => $scope.navigateTo(`/cases/${row.caseId}`),
        [ROW_ACTION_LAUNCH_AGAIN]:   row => $scope.navigateTo(`/activities/new/${row.designId}`),
        [ROW_ACTION_ARCHIVE]:        row => setArchived(row, true),
        [ROW_ACTION_RESTORE]:        row => setArchived(row, false),
    };

    vm.runAction = async function(row, action) {
        if (!row || !action || action.disabled || !ACTIONS[action.id]) {
            return;
        }
        await withBusy(row.id, () => ACTIONS[action.id](row));
    };

    vm.init = function() {
        const onCatalogUpdated = () => {
            vm.refresh();
            $scope.$applyAsync();
        };
        ActivityCatalogService.registerListener("onActivityCatalogUpdated", onCatalogUpdated);
        // The run block switches to the profile's language after the
        // profile loads, often after the activities: the rows are built again
        // so every date and time follows the UI language. angular-translate
        // emits the event on $rootScope, so a scope listener would not hear it.
        const stopFollowingLanguage = $rootScope.$on("$translateChangeSuccess", () => {
            vm.refresh();
            $scope.$applyAsync();
        });
        $scope.$on("$destroy", () => {
            ActivityCatalogService.unregisterListener("onActivityCatalogUpdated",
                onCatalogUpdated);
            stopFollowingLanguage();
        });

        // The route does not reload on a search change (`?tab=`), so Back and
        // Forward reach the page as a route update.
        $scope.$on("$routeUpdate", vm.$onRouteUpdate);
        // Leaving the page with `navigateTo`, which keeps the search, does not
        // carry the tab to the next page; the page's own history entry keeps
        // it, so Back returns to the same tab.
        $scope.$on("$routeChangeStart", () => {
            const search = $location.search();
            for (const key of PAGE_SEARCH_KEYS) {
                if (search[key] !== undefined) {
                    $location.search(key, null).replace();
                }
            }
        });

        return vm.load();
    };

    vm.ready = vm.init();
}
