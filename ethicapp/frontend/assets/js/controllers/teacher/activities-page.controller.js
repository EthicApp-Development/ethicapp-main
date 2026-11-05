// The Activities page (#1050, epic #1046), `#!/activities`: finding an
// activity again before, during and after it runs. Its tabs are "En curso",
// "Terminadas" and "Archivadas", with the tab in the URL (`?tab=finished`,
// `?tab=archived`); the route does not reload on a search change, so the
// browser's Back and Forward switch tabs as a route update, and coming back
// from the dashboard restores the tab.
//
// Each tab is a table built by `helpers/activities-table.js`: one row per
// activity with its status, participants, code and dates, one visible action
// and a "⋯" menu, shown by the `activities-table` component (#1095). The
// dates come from `helpers/activity-dates.js`, in the browser's time zone
// and the UI language.
//
// Each part of the page has its own fragment, so later changes stay apart:
// - the filter bar (`activities-filters.template.html`, #1051): a search in
//   every tab and, in "En curso", the status chips, both in the URL
//   (`?q=`, `?status=not-started|in-progress`, `helpers/activities-filters.js`)
//   and applied in `vm.getRows`. Switching tabs clears them, as the tabs'
//   links do and as on the Cases page;
// - the notice region, the `activity-action-notice` component (#1052,
//   #1094), bound to the page's ActivityRowActionsService instance;
// - the page of a teacher with no activities, the `activities-empty-page`
//   component (#1053, #1098), shared with the home.

import {
    ACTIVITIES_PAGE_SIZE,
    ACTIVITY_TABS,
    buildActivityTables,
    tabFromSearch,
    tabSearchValue,
} from "../../helpers/activities-table.js";
import { createActivityDateFormatter, uiLanguageOf } from "../../helpers/activity-dates.js";
import {
    filterActivityRows,
    noMatchesKeys,
    ongoingFooterKeys,
    queryFromSearch,
    querySearchValue,
    statusFilterChips,
    statusFilterFromSearch,
    statusFilterSearchValue,
    tabHasStatusFilter,
} from "../../helpers/activities-filters.js";
import { designStepNeeded } from "../../helpers/activities-empty-page.js";

// The page's own URL search keys, which are not carried to the next page.
const PAGE_SEARCH_KEYS = ["tab", "status", "q"];

// The filters' URL search keys.
const FILTER_SEARCH_KEYS = ["status", "q"];

function initialVisibleCounts() {
    return Object.fromEntries(ACTIVITY_TABS.map(tab => [tab, ACTIVITIES_PAGE_SIZE]));
}

export function ActivitiesPageController($scope, $rootScope, $location, $translate,
    ActivityCatalogService, DesignCatalogService, ActivityRowActionsService) {

    const vm = this;

    vm.tab = tabFromSearch($location.search());
    vm.loaded = false;
    vm.tables = { ongoing: [], finished: [], archived: [] };
    vm.visibleCounts = initialVisibleCounts();
    // The search of the current tab and the status filter of "En curso".
    vm.statusFilter = statusFilterFromSearch($location.search());
    vm.search = queryFromSearch($location.search());

    // Lists

    // The rows again from the catalog, with "today" taken now and the dates
    // in the current language.
    vm.refresh = function() {
        const dates = createActivityDateFormatter({ uiLanguage: uiLanguageOf($translate) });
        vm.tables = buildActivityTables(ActivityCatalogService.getActivities(), dates);
    };

    vm.load = async function() {
        // The catalog answers an empty list when the request fails.
        await ActivityCatalogService.loadActivities();
        vm.refresh();
        await loadEmptyPage();
        vm.loaded = true;
        $scope.$applyAsync();
    };

    // Tabs

    vm.count = function(tab) {
        return vm.tables[tab]?.length || 0;
    };

    function noActivityInAnyTab() {
        return ACTIVITY_TABS.every(tab => vm.count(tab) === 0);
    }

    // The teacher has launched no activity yet: the empty page replaces
    // "En curso" (#1053).
    vm.hasNoActivities = function() {
        return vm.loaded && noActivityInAnyTab();
    };

    // Empty page

    // Whether the empty page shows step 1, "Prepara un diseño", before
    // "Lanza la actividad" (`designStepNeeded`, shared with the home).
    vm.showDesignStep = true;

    // Loads the teacher's designs only for the empty page, so a teacher with
    // activities makes no request for them.
    async function loadEmptyPage() {
        if (noActivityInAnyTab()) {
            vm.showDesignStep = await designStepNeeded(DesignCatalogService);
        }
    }

    // A tab adds a history entry and clears the filters, as the tabs' links
    // do.
    vm.selectTab = function(tab) {
        if (tab === vm.tab || !ACTIVITY_TABS.includes(tab)) {
            return;
        }
        vm.tab = tab;
        $location.search("tab", tabSearchValue(tab));
        vm.clearFilters();
    };

    vm.$onRouteUpdate = function() {
        vm.tab = tabFromSearch($location.search());
        vm.syncFiltersFromUrl();
    };

    // "Show more"

    // A tab's rows, newest first, that pass the search and, in "En curso",
    // the status filter.
    vm.getRows = function(tab) {
        return filtered(tab).rows;
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

    // Filters

    // Each tab's filtered rows, computed again only when its table, the
    // filter or the search change, not on every digest.
    const filterCache = {};
    function filtered(tab) {
        const rows = vm.tables[tab] || [];
        const cached = filterCache[tab];
        if (cached && cached.source === rows && cached.status === vm.statusFilter
            && cached.query === vm.search) {
            return cached;
        }
        filterCache[tab] = {
            source: rows,
            status: vm.statusFilter,
            query:  vm.search,
            rows:   filterActivityRows(rows, tab, { status: vm.statusFilter, query: vm.search }),
            chips:  tabHasStatusFilter(tab) ? statusFilterChips(rows, vm.statusFilter) : [],
        };
        return filterCache[tab];
    }

    function resetVisibleRows() {
        vm.visibleCounts = initialVisibleCounts();
    }

    // The status chips of a tab: "En curso" only.
    vm.getFilterChips = function(tab) {
        return filtered(tab).chips;
    };

    vm.hasStatusFilter = tabHasStatusFilter;

    // The footer's keys of "En curso", by status filter (frame C).
    vm.getOngoingFooter = function() {
        return ongoingFooterKeys(vm.statusFilter);
    };

    vm.getNoMatches = noMatchesKeys;

    // The search or the filter leaves a tab with activities empty.
    vm.hasNoMatches = function(tab) {
        return vm.count(tab) > 0 && vm.getRows(tab).length === 0;
    };

    // A chip adds a history entry, as a tab does, so Back returns to the
    // previous filter.
    vm.selectStatusFilter = function(filter) {
        if (filter === vm.statusFilter) {
            return;
        }
        vm.statusFilter = filter;
        resetVisibleRows();
        $location.search("status", statusFilterSearchValue(filter));
    };

    // Typing replaces the history entry instead of adding one per word.
    vm.handleSearchChange = function() {
        resetVisibleRows();
        $location.search("q", querySearchValue(vm.search)).replace();
    };

    // The filter back to "Todas" and no search, and out of the URL.
    vm.clearFilters = function() {
        vm.statusFilter = statusFilterFromSearch({});
        vm.search = "";
        resetVisibleRows();
        const search = $location.search();
        for (const key of FILTER_SEARCH_KEYS) {
            if (search[key] !== undefined) {
                $location.search(key, null);
            }
        }
    };

    vm.syncFiltersFromUrl = function() {
        const search = $location.search();
        const status = statusFilterFromSearch(search);
        const query = queryFromSearch(search);
        if (status !== vm.statusFilter) {
            vm.statusFilter = status;
            resetVisibleRows();
        }
        // The field keeps what is being typed (a trailing space) while it
        // matches the URL's search.
        if (query !== (querySearchValue(vm.search) ?? "")) {
            vm.search = query;
            resetVisibleRows();
        }
    };

    // Row actions and their notices (#1052), shared with the home through
    // ActivityRowActionsService (#1094). On this page a notice link opens a
    // tab in place, and the tab on screen decides which links appear. The
    // delegates keep the table fragments bound to `ap`.

    vm.actions = ActivityRowActionsService.create($scope, {
        showTab:    tab => vm.selectTab(tab),
        currentTab: () => vm.tab,
    });
    vm.busy = vm.actions.busy;
    Object.defineProperty(vm, "notice", { get: () => vm.actions.notice });
    vm.runAction = (row, action) => vm.actions.run(row, action);
    vm.copyCode = row => vm.actions.copyCode(row);
    vm.runNoticeAction = action => vm.actions.runNoticeAction(action);
    vm.dismissNotice = () => vm.actions.dismissNotice();

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
