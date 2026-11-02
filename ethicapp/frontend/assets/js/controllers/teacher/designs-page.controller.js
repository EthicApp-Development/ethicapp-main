// The Designs page (#975, epic #966), `#!/designs`: managing the teacher's
// designs, apart from launching activities. Its tabs are "My designs",
// "Shared by others" and "Archived", with the tab in the URL (`?tab=shared`,
// `?tab=archived`); the route does not reload on a search change, so the
// browser's Back and Forward switch tabs as a route update.
//
// "My designs" and "Archived" are tables built by `helpers/designs-table.js`:
// one row per design with its status, its sharing switch, one visible action
// and a "⋯" menu. "Shared by others" is a table built by
// `helpers/designs-shared-table.js` (#977): one row per design another
// teacher shares, with its one import action.
//
// "My designs" has a search and status filters (#976), also in the URL
// (`?status=errors&q=...`, `helpers/designs-filters.js`).

import {
    DESIGNS_PAGE_SIZE,
    DESIGNS_TAB_ARCHIVED,
    DESIGNS_TAB_MINE,
    DESIGNS_TAB_SHARED,
    ROW_ACTION_ARCHIVE,
    ROW_ACTION_DELETE,
    ROW_ACTION_DUPLICATE,
    ROW_ACTION_DUPLICATE_TO_EDIT,
    ROW_ACTION_EDIT,
    ROW_ACTION_FIX,
    ROW_ACTION_RESTORE,
    ROW_ACTION_VIEW,
    buildDesignTables,
    isDesignShared,
    tabFromSearch,
    tabSearchValue,
} from "../../helpers/designs-table.js";
import {
    IMPORT_NOTICE_TIMEOUT_MS,
    IMPORT_STATE_IMPORTABLE,
    buildSharedRows,
    importNotice,
    sharedRowMatchesSearch,
} from "../../helpers/designs-shared-table.js";
import { designMatchesLaunchSearch } from "../../helpers/launch-design-list.js";
import {
    filterDesignRows,
    queryFromSearch,
    querySearchValue,
    statusFilterChips,
    statusFilterFromSearch,
    statusFilterSearchValue,
} from "../../helpers/designs-filters.js";

// The page's own URL search keys, which are not carried to the next page.
const PAGE_SEARCH_KEYS = ["tab", "status", "q"];

function initialVisibleCounts() {
    return {
        [DESIGNS_TAB_MINE]:     DESIGNS_PAGE_SIZE,
        [DESIGNS_TAB_SHARED]:   DESIGNS_PAGE_SIZE,
        [DESIGNS_TAB_ARCHIVED]: DESIGNS_PAGE_SIZE,
    };
}

export function DesignsPageController($scope, $location, $translate, toast,
    DesignCatalogService, DesignPublicationService, ActivityCatalogService) {

    const vm = this;

    vm.tab = tabFromSearch($location.search());
    vm.loaded = false;
    vm.loadFailed = false;
    vm.tables = { mine: [], archived: [], shared: [] };
    vm.visibleCounts = initialVisibleCounts();
    vm.sharedSearch = "";
    // The rows of "Shared by others", with each design's import state.
    vm.sharedRows = [];
    // The notice after an import: `{ copyId, title }`, or null.
    vm.importNotice = null;
    vm.statusFilter = statusFilterFromSearch($location.search());
    vm.search = queryFromSearch($location.search());
    // Design id → true while an action on it is pending, so a second click
    // does not repeat it.
    vm.busy = {};

    let designs = [];
    let activities = [];

    vm.showDesignToast = function(messageKey, className = undefined) {
        $scope.$applyAsync(() => {
            $translate(messageKey).then((result) => {
                toast.create({
                    timeout:           6 * 1000,
                    message:           result,
                    className,
                    containerClass:    "designs-toast-container",
                    dismissible:       false,
                    defaultToastClass: "toast",
                    insertFromTop:     true,
                });
            });
        });
    };

    vm.refresh = function() {
        vm.tables = buildDesignTables(designs, activities);
        vm.sharedRows = buildSharedRows(vm.tables.shared, designs);
    };

    // The lists after a change in the catalog: the service keeps its designs
    // up to date (it reloads them after a duplicate, an archive or a delete,
    // and updates a design's visibility in place).
    vm.reloadFromCatalog = async function() {
        designs = await DesignCatalogService.getDesigns();
        vm.refresh();
        $scope.$applyAsync();
    };

    vm.load = async function() {
        try {
            designs = await DesignCatalogService.getDesigns(true);
        } catch (error) {
            console.error("[DesignsPageController] Could not load designs.", error);
            vm.loadFailed = true;
        }
        // Without the activities a design in use is still told by its lock;
        // only the number of activities is missing.
        try {
            activities = await ActivityCatalogService.loadActivities();
        } catch (error) {
            console.warn("[DesignsPageController] Could not load activities.", error);
            activities = [];
        }
        vm.refresh();
        vm.loaded = true;
        $scope.$applyAsync();
    };

    // Tabs

    vm.count = function(tab) {
        return vm.tables[tab]?.length || 0;
    };

    vm.selectTab = function(tab) {
        if (tab === vm.tab) {
            return;
        }
        vm.tab = tab;
        $location.search("tab", tabSearchValue(tab));
    };

    vm.$onRouteUpdate = function() {
        vm.tab = tabFromSearch($location.search());
        vm.syncFiltersFromUrl();
    };

    vm.openSharedTab = function() {
        vm.selectTab(DESIGNS_TAB_SHARED);
    };

    // "Show more"

    vm.getRows = function(tab) {
        if (tab === DESIGNS_TAB_MINE) {
            return filteredMine().rows;
        }
        if (tab === DESIGNS_TAB_SHARED) {
            return vm.sharedRows.filter(row => sharedRowMatchesSearch(row, vm.sharedSearch));
        }
        return vm.tables[tab] || [];
    };

    vm.getVisibleRows = function(tab) {
        return vm.getRows(tab).slice(0, vm.visibleCounts[tab]);
    };

    vm.hasMoreRows = function(tab) {
        return vm.getRows(tab).length > vm.visibleCounts[tab];
    };

    vm.showMore = function(tab) {
        vm.visibleCounts[tab] += DESIGNS_PAGE_SIZE;
    };

    vm.handleSharedSearchChange = function() {
        vm.visibleCounts[DESIGNS_TAB_SHARED] = DESIGNS_PAGE_SIZE;
    };

    // Search and status filters of "My designs"

    // The filtered rows and the chips, computed again only when the table,
    // the filter or the search change, not on every digest.
    let filterCache = null;
    function filteredMine() {
        const mine = vm.tables.mine || [];
        if (!filterCache || filterCache.mine !== mine ||
            filterCache.status !== vm.statusFilter || filterCache.query !== vm.search) {
            filterCache = {
                mine,
                status: vm.statusFilter,
                query:  vm.search,
                rows:   filterDesignRows(mine, { status: vm.statusFilter, query: vm.search }),
                chips:  statusFilterChips(mine, vm.statusFilter),
            };
        }
        return filterCache;
    }

    vm.getFilterChips = function() {
        return filteredMine().chips;
    };

    // A chip adds a history entry, as a tab does, so Back returns to the
    // previous filter.
    vm.selectStatusFilter = function(filter) {
        if (filter === vm.statusFilter) {
            return;
        }
        vm.statusFilter = filter;
        vm.visibleCounts[DESIGNS_TAB_MINE] = DESIGNS_PAGE_SIZE;
        $location.search("status", statusFilterSearchValue(filter));
    };

    // Typing replaces the history entry instead of adding one per word.
    vm.handleSearchChange = function() {
        vm.visibleCounts[DESIGNS_TAB_MINE] = DESIGNS_PAGE_SIZE;
        $location.search("q", querySearchValue(vm.search)).replace();
    };

    vm.clearFilters = function() {
        vm.statusFilter = statusFilterFromSearch({});
        vm.search = "";
        vm.visibleCounts[DESIGNS_TAB_MINE] = DESIGNS_PAGE_SIZE;
        $location.search("status", null);
        $location.search("q", null);
    };

    vm.syncFiltersFromUrl = function() {
        const search = $location.search();
        const status = statusFilterFromSearch(search);
        const query = queryFromSearch(search);
        if (status !== vm.statusFilter) {
            vm.statusFilter = status;
            vm.visibleCounts[DESIGNS_TAB_MINE] = DESIGNS_PAGE_SIZE;
        }
        // The field keeps what is being typed (a trailing space) while it
        // matches the URL's search.
        if (query !== (querySearchValue(vm.search) ?? "")) {
            vm.search = query;
            vm.visibleCounts[DESIGNS_TAB_MINE] = DESIGNS_PAGE_SIZE;
        }
    };

    // Sharing

    vm.isShared = function(row) {
        return isDesignShared(row.design);
    };

    // The switch keeps the previous page's behavior: the publication service
    // asks to publish the design's case first when it is not public (#942).
    vm.toggleSharing = async function(row) {
        if (row.sharing.disabled || vm.busy[row.id]) {
            return;
        }
        vm.busy[row.id] = true;
        try {
            const result = await DesignPublicationService.togglePublicVisibility(row.design);
            if (result?.status === "case_not_ready") {
                vm.showDesignToast("case_publication_settings_not_public", "alert-warning");
            }
        } catch (error) {
            console.error("[DesignsPageController] Error changing design visibility.", error);
            vm.showDesignToast("design_visibility_update_error", "alert-danger");
        } finally {
            delete vm.busy[row.id];
            $scope.$applyAsync();
        }
    };

    // Row actions

    async function duplicate(id) {
        try {
            return await DesignCatalogService.duplicateDesign(id);
        } catch (error) {
            console.error("[DesignsPageController] Error duplicating design.", error);
            vm.showDesignToast("designs_duplicate_failed", "alert-danger");
            return null;
        }
    }

    async function duplicateToEdit(id) {
        const copyId = await duplicate(id);
        if (copyId !== null && copyId !== undefined) {
            $scope.navigateTo(`/designs/${copyId}/edit`);
        }
    }

    async function setArchived(id, archived) {
        try {
            await DesignCatalogService.updateDesignArchived(id, archived);
            vm.showDesignToast(archived ? "design_archive_success" : "design_unarchive_success");
        } catch (error) {
            console.error("[DesignsPageController] Error updating archived status.", error);
            vm.showDesignToast("design_archive_error", "alert-danger");
        }
    }

    // Deleting keeps the previous page's behavior until it asks first (#978).
    async function deleteDesign(id) {
        try {
            await DesignCatalogService.deleteDesign(id);
        } catch (error) {
            const messageKey = error?.data?.code === "DESIGN_IN_USE"
                ? "design_delete_in_use"
                : "design_delete_failed";
            vm.showDesignToast(messageKey, "alert-danger");
        }
    }

    const ACTIONS = {
        [ROW_ACTION_EDIT]:              id => $scope.navigateTo(`/designs/${id}/edit`),
        [ROW_ACTION_FIX]:               id => $scope.navigateTo(`/designs/${id}/edit`),
        [ROW_ACTION_VIEW]:              id => $scope.navigateTo(`/designs/${id}`),
        [ROW_ACTION_DUPLICATE_TO_EDIT]: duplicateToEdit,
        [ROW_ACTION_DUPLICATE]:         duplicate,
        [ROW_ACTION_ARCHIVE]:           id => setArchived(id, true),
        [ROW_ACTION_RESTORE]:           id => setArchived(id, false),
        [ROW_ACTION_DELETE]:            deleteDesign,
    };

    vm.runAction = async function(row, action) {
        if (!action || action.disabled || vm.busy[row.id] || !ACTIONS[action.id]) {
            return;
        }
        vm.busy[row.id] = true;
        try {
            await ACTIONS[action.id](row.id);
        } finally {
            delete vm.busy[row.id];
            $scope.$applyAsync();
        }
    };

    // Importing (#977): a row whose design can be imported creates a private,
    // editable copy in "My designs", and a notice names the copy. The notices
    // of the other actions are #978's.

    let importNoticeTimer = null;

    function clearImportNoticeTimer() {
        if (importNoticeTimer !== null) {
            clearTimeout(importNoticeTimer);
            importNoticeTimer = null;
        }
    }

    vm.dismissImportNotice = function() {
        clearImportNoticeTimer();
        vm.importNotice = null;
    };

    function showImportNotice(notice) {
        clearImportNoticeTimer();
        vm.importNotice = notice;
        importNoticeTimer = setTimeout(() => {
            importNoticeTimer = null;
            $scope.$applyAsync(() => {
                vm.importNotice = null;
            });
        }, IMPORT_NOTICE_TIMEOUT_MS);
    }

    vm.editImportedCopy = function() {
        const copyId = vm.importNotice?.copyId;
        vm.dismissImportNotice();
        if (copyId !== null && copyId !== undefined) {
            $scope.navigateTo(`/designs/${copyId}/edit`);
        }
    };

    vm.showImportedCopyInMyDesigns = function() {
        vm.dismissImportNotice();
        vm.selectTab(DESIGNS_TAB_MINE);
    };

    vm.importDesign = async function(row) {
        if (!row || row.importState !== IMPORT_STATE_IMPORTABLE || vm.busy[row.id]) {
            return;
        }
        vm.busy[row.id] = true;
        try {
            const copyId = await DesignCatalogService.importDesign(row.id);
            // The catalog reloaded its designs, so the row turns "Imported".
            designs = await DesignCatalogService.getDesigns();
            vm.refresh();
            showImportNotice(importNotice(copyId, designs, row.title));
        } catch (error) {
            if (error?.data?.code === "DESIGN_CASE_NOT_IMPORTABLE") {
                vm.showDesignToast("design_import_blocked_by_case", "alert-danger");
                // The list was stale: reload it, so the row says why it
                // cannot be imported.
                try {
                    designs = await DesignCatalogService.getDesigns(true);
                    vm.refresh();
                } catch (reloadError) {
                    console.warn("[DesignsPageController] Could not reload designs.", reloadError);
                }
            } else {
                console.error("[DesignsPageController] Error importing design.", error);
                vm.showDesignToast("design_import_error", "alert-danger");
            }
        } finally {
            delete vm.busy[row.id];
            $scope.$applyAsync();
        }
    };

    vm.init = function() {
        const onCatalogUpdated = () => {
            vm.reloadFromCatalog();
        };
        DesignCatalogService.registerListener("onDesignCatalogUpdated", onCatalogUpdated);
        $scope.$on("$destroy", () => {
            DesignCatalogService.unregisterListener("onDesignCatalogUpdated", onCatalogUpdated);
        });
        $scope.$on("$destroy", clearImportNoticeTimer);
        $scope.$on("caseVisibilityUpdatedDesigns", (_event, data) => {
            DesignCatalogService.applyPrivateVisibilityToDesigns(data?.affectedDesignIds || []);
        });

        // The route does not reload on a search change (`?tab=`), so Back and
        // Forward reach the page as a route update.
        $scope.$on("$routeUpdate", vm.$onRouteUpdate);
        // Leaving the page with `navigateTo`, which keeps the search, does not
        // carry `?tab=`, `?status=` or `?q=` to the next page; the page's own
        // history entry keeps them, so Back returns to the same tab, filter and
        // search.
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
