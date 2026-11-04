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
// - the filter bar (`activities-filters.template.html`, #1051): a search in
//   every tab and, in "En curso", the status chips, both in the URL
//   (`?q=`, `?status=not-started|in-progress`, `helpers/activities-filters.js`)
//   and applied in `vm.getRows`. Switching tabs clears them, as the tabs'
//   links do and as on the Cases page;
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
import {
    NOTICE_ACTION_SHOW_ARCHIVED,
    NOTICE_ACTION_SHOW_FINISHED,
    NOTICE_ACTION_UNDO_ARCHIVE,
    NOTICE_TIMEOUT_MS,
    archiveChangeFailureNotice,
    archiveNotice,
    codeCopiedNotice,
    copyFailureNotice,
    restoreNotice,
} from "../../helpers/activity-action-feedback.js";
import { translatePlainText } from "../../helpers/plain-text-translation.js";

// The page's own URL search keys, which are not carried to the next page.
const PAGE_SEARCH_KEYS = ["tab", "status", "q"];

// The filters' URL search keys.
const FILTER_SEARCH_KEYS = ["status", "q"];

function initialVisibleCounts() {
    return Object.fromEntries(ACTIVITY_TABS.map(tab => [tab, ACTIVITIES_PAGE_SIZE]));
}

export function ActivitiesPageController($scope, $rootScope, $location, $translate, $window,
    ActivityCatalogService, $timeout) {

    const vm = this;

    vm.tab = tabFromSearch($location.search());
    vm.loaded = false;
    vm.tables = { ongoing: [], finished: [], archived: [] };
    vm.visibleCounts = initialVisibleCounts();
    // The search of the current tab and the status filter of "En curso".
    vm.statusFilter = statusFilterFromSearch($location.search());
    vm.search = queryFromSearch($location.search());
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

    // Notices after "Copiar código", an archive or a restore (#1052): one at
    // a time, for a few seconds, and dismissible. Built by
    // `helpers/activity-action-feedback.js`.

    vm.notice = null;
    let noticeTimer = null;

    function cancelNoticeTimer() {
        if (noticeTimer) {
            $timeout.cancel(noticeTimer);
            noticeTimer = null;
        }
    }

    $scope.$on("$destroy", cancelNoticeTimer);

    vm.showNotice = function(notice) {
        cancelNoticeTimer();
        vm.notice = notice;
        noticeTimer = $timeout(() => {
            noticeTimer = null;
            if (vm.notice === notice) {
                vm.notice = null;
            }
        }, NOTICE_TIMEOUT_MS);
        $scope.$applyAsync();
    };

    vm.dismissNotice = function() {
        cancelNoticeTimer();
        vm.notice = null;
    };

    // The notice's message, in the current language. The template binds it
    // as text, so the activity's title is translated as plain text and any
    // markup in it stays text.
    vm.noticeMessage = function() {
        return vm.notice
            ? translatePlainText($translate, vm.notice.messageKey, vm.notice.params)
            : "";
    };

    // A notice's links: "Deshacer" restores the activity just archived (it
    // sends `archived: false`, so a second "Deshacer" leaves it restored);
    // "Ver Archivadas" and "Ver en Terminadas" open that tab.
    vm.runNoticeAction = async function(action) {
        vm.dismissNotice();
        if (action?.id === NOTICE_ACTION_UNDO_ARCHIVE) {
            await withBusy(action.sessionId,
                () => setArchived(action.sessionId, action.title, false));
        } else if (action?.id === NOTICE_ACTION_SHOW_ARCHIVED) {
            vm.selectTab("archived");
        } else if (action?.id === NOTICE_ACTION_SHOW_FINISHED) {
            vm.selectTab("finished");
        }
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

    // Copies the row's access code, from its button or the row menu, and
    // says "Código copiado", or that the browser did not let it. Resolves
    // true once copied.
    vm.copyCode = async function(row) {
        if (!row?.code) {
            return false;
        }
        try {
            await $window.navigator.clipboard.writeText(row.code);
            vm.showNotice(codeCopiedNotice());
            return true;
        } catch (error) {
            console.error("[ActivitiesPageController] Could not copy the code.", error);
            vm.showNotice(copyFailureNotice());
            return false;
        }
    };

    // Archives a finished activity or restores an archived one, and names it
    // in a notice: "Se archivó" with "Deshacer" and "Ver Archivadas", or "Se
    // restauró" with "Ver en Terminadas". The catalog updates the activity
    // and notifies the page, which builds its rows again; the page stays on
    // its tab. The server refuses to archive an activity that is not
    // finished (409 ACTIVITY_NOT_FINISHED): the list was stale, so it is
    // loaded again and the notice says why.
    async function setArchived(id, title, archived) {
        try {
            await ActivityCatalogService.setArchived(id, archived);
            vm.showNotice(archived
                ? archiveNotice(id, title, { showArchived: vm.tab !== "archived" })
                : restoreNotice(id, title, { showFinished: vm.tab !== "finished" }));
        } catch (error) {
            if (error?.status === 409) {
                console.warn("[ActivitiesPageController] The server refused the archive change; "
                    + "reloading the activities.", error?.data?.code);
                await ActivityCatalogService.loadActivities();
            } else {
                console.error("[ActivitiesPageController] Error updating archived status.", error);
            }
            vm.showNotice(archiveChangeFailureNotice(error, archived));
        }
    }

    const ACTIONS = {
        [ROW_ACTION_OPEN_DASHBOARD]: row => $scope.navigateTo(`/activities/${row.id}`),
        [ROW_ACTION_REPORTS]:        row => $scope.navigateTo(`/activities/${row.id}/reports`),
        [ROW_ACTION_COPY_CODE]:      row => vm.copyCode(row),
        [ROW_ACTION_VIEW_DESIGN]:    row => $scope.navigateTo(`/designs/${row.designId}`),
        [ROW_ACTION_VIEW_CASE]:      row => $scope.navigateTo(`/cases/${row.caseId}`),
        [ROW_ACTION_LAUNCH_AGAIN]:   row => $scope.navigateTo(`/activities/new/${row.designId}`),
        [ROW_ACTION_ARCHIVE]:        row => setArchived(row.id, row.titleText, true),
        [ROW_ACTION_RESTORE]:        row => setArchived(row.id, row.titleText, false),
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
