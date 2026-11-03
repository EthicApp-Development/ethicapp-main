// The Cases page (#1013, epic #1008), `#!/cases`: managing the teacher's
// cases. Its tabs are "My cases", "Shared by others" and "Archived", with the
// tab in the URL (`?tab=shared`, `?tab=archived`); the route does not reload
// on a search change, so the browser's Back and Forward switch tabs as a
// route update.
//
// "My cases" and "Archived" are tables built by `helpers/cases-table.js`: one
// row per case with its status, the designs that use it, its sharing switch,
// one visible action and a "⋯" menu. "Shared by others" keeps the previous
// page's case cards until its own table (#1016).
//
// "My cases" has a search and status filters (#1015), also in the URL
// (`?status=in-use&q=...`, `helpers/cases-filters.js`). Switching tabs clears
// them, as the tabs' links do.
//
// The view and the case forms keep `CasesController`.

import {
    CASES_PAGE_SIZE,
    CASES_TAB_ARCHIVED,
    CASES_TAB_MINE,
    CASES_TAB_SHARED,
    ROW_ACTION_ARCHIVE,
    ROW_ACTION_DELETE,
    ROW_ACTION_DUPLICATE,
    ROW_ACTION_DUPLICATE_TO_EDIT,
    ROW_ACTION_EDIT,
    ROW_ACTION_REPLACE_PDF,
    ROW_ACTION_RESTORE,
    ROW_ACTION_VIEW,
    buildCaseTables,
    isCaseShared,
    languageNamesByCode,
    tabFromSearch,
    tabSearchValue,
} from "../../helpers/cases-table.js";
import { CASE_STATUS_PROCESSING } from "../../helpers/case-status.js";
import {
    SHARE_SWITCH_FAILED,
    SHARE_SWITCH_SAVED,
    toggleCaseShareSwitch,
} from "../../helpers/case-share-switch.js";
import { caseVisibilityResultMessages } from "../../helpers/case-visibility-result.js";
import {
    filterCaseRows,
    queryFromSearch,
    querySearchValue,
    statusFilterChips,
    statusFilterFromSearch,
    statusFilterSearchValue,
} from "../../helpers/cases-filters.js";

// The page's own URL search keys, which are not carried to the next page.
const PAGE_SEARCH_KEYS = ["tab", "status", "q"];

// The filters' URL search keys.
const FILTER_SEARCH_KEYS = ["status", "q"];

const TOAST_INFO_TIMEOUT_MS = 4 * 1000;
const TOAST_ERROR_TIMEOUT_MS = 6 * 1000;
// Long enough to read what changed for the designs that use the case.
const TOAST_VISIBILITY_TIMEOUT_MS = 12 * 1000;

// How often the rows of cases whose PDF is being processed are refreshed.
const DOCUMENT_PROCESSING_POLL_MS = 5000;

// The refusals of DELETE /cases/:id, until the delete dialog (#1017).
const DELETE_ERROR_KEYS = {
    CASE_USED_BY_LAUNCHED_ACTIVITY: "case_cannot_delete_used_by_activity",
    CASE_USED_BY_OTHER_TEACHERS:    "cases_delete_refused_other_teachers",
};

function initialVisibleCounts() {
    return {
        [CASES_TAB_MINE]:     CASES_PAGE_SIZE,
        [CASES_TAB_SHARED]:   CASES_PAGE_SIZE,
        [CASES_TAB_ARCHIVED]: CASES_PAGE_SIZE,
    };
}

export function CasesPageController($scope, $location, $translate, $interval, toast,
    CasesCatalogService, LanguageCatalogService, CasePublicationNoticeService) {

    const vm = this;

    vm.tab = tabFromSearch($location.search());
    vm.loaded = false;
    vm.loadFailed = false;
    vm.tables = { mine: [], archived: [], shared: [] };
    vm.visibleCounts = initialVisibleCounts();
    // The search and status filter of "My cases".
    vm.statusFilter = statusFilterFromSearch($location.search());
    vm.search = queryFromSearch($location.search());
    // Case id → true while an action on it is pending, so a second click
    // does not repeat it.
    vm.busy = {};

    let cases = { own: [], archived: [], shared: [] };
    let languageNames = new Map();
    let documentProcessingPoll = null;

    // Toasts

    function showToast(message, { className, timeout = TOAST_INFO_TIMEOUT_MS } = {}) {
        toast.create({
            timeout,
            message,
            className,
            containerClass:    "cases-toast-container",
            dismissible:       false,
            defaultToastClass: "toast",
            insertFromTop:     true,
        });
    }

    vm.showInfoToast = function(key) {
        showToast($translate.instant(key));
    };

    vm.showErrorToast = function(key) {
        showToast($translate.instant(key),
            { className: "alert-danger", timeout: TOAST_ERROR_TIMEOUT_MS });
    };

    // Lists

    vm.refresh = function() {
        vm.tables = buildCaseTables(cases, languageNames);
        syncDocumentProcessingPolling();
    };

    // The lists after a change: the catalog reloads its three lists after
    // every save, duplicate, archive, import and delete.
    vm.reloadFromCatalog = async function() {
        const [own, shared, archived] = await Promise.all([
            CasesCatalogService.getCases(),
            CasesCatalogService.getPublicCases(),
            CasesCatalogService.getArchivedCases(),
        ]);
        cases = { own, shared, archived };
        vm.refresh();
        $scope.$applyAsync();
    };

    vm.load = async function() {
        try {
            const [own, shared, archived] = await Promise.all([
                CasesCatalogService.getCases(true),
                CasesCatalogService.getPublicCases(true),
                CasesCatalogService.getArchivedCases(true),
            ]);
            cases = { own, shared, archived };
        } catch (error) {
            console.error("[CasesPageController] Could not load cases.", error);
            vm.loadFailed = true;
        }
        // Without the languages a row shows its language's code.
        try {
            languageNames = languageNamesByCode(await LanguageCatalogService.getLanguages());
        } catch (error) {
            console.warn("[CasesPageController] Could not load languages.", error);
        }
        vm.refresh();
        vm.loaded = true;
        $scope.$applyAsync();
    };

    // Document processing: the rows of cases whose PDF is being rendered are
    // refreshed until it is done, as on the previous page.

    function processingCases() {
        return [...vm.tables.mine, ...vm.tables.archived]
            .filter(row => row.statusInfo.status === CASE_STATUS_PROCESSING)
            .map(row => row.caseItem);
    }

    vm.refreshDocumentProcessing = async function() {
        const pending = processingCases();
        await Promise.all(pending.map(async (caseItem) => {
            try {
                const response = await CasesCatalogService.getCaseDocumentProcessing(caseItem.id);
                caseItem.documentProcessing = response.documentProcessing;
            } catch (error) {
                console.error("[CasesPageController] Could not refresh a document's processing.",
                    error);
            }
        }));
        if (pending.length > 0) {
            vm.refresh();
            $scope.$applyAsync();
        }
    };

    function stopDocumentProcessingPolling() {
        if (documentProcessingPoll) {
            $interval.cancel(documentProcessingPoll);
            documentProcessingPoll = null;
        }
    }

    function syncDocumentProcessingPolling() {
        if (processingCases().length === 0) {
            stopDocumentProcessingPolling();
        } else if (!documentProcessingPoll) {
            documentProcessingPoll = $interval(() => {
                vm.refreshDocumentProcessing();
            }, DOCUMENT_PROCESSING_POLL_MS);
        }
    }

    // Tabs

    vm.count = function(tab) {
        return vm.tables[tab]?.length || 0;
    };

    // A tab clears the filters of "My cases", as the tabs' links do.
    vm.selectTab = function(tab) {
        if (tab === vm.tab) {
            return;
        }
        vm.tab = tab;
        $location.search("tab", tabSearchValue(tab));
        resetFilters();
    };

    vm.$onRouteUpdate = function() {
        vm.tab = tabFromSearch($location.search());
        vm.syncFiltersFromUrl();
    };

    vm.openSharedTab = function() {
        vm.selectTab(CASES_TAB_SHARED);
    };

    // "Show more"

    vm.getRows = function(tab) {
        if (tab === CASES_TAB_MINE) {
            return filteredMine().rows;
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
        vm.visibleCounts[tab] += CASES_PAGE_SIZE;
    };

    // Search and status filters of "My cases"

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
                rows:   filterCaseRows(mine, { status: vm.statusFilter, query: vm.search }),
                chips:  statusFilterChips(mine, vm.statusFilter),
            };
        }
        return filterCache;
    }

    function resetMineRows() {
        vm.visibleCounts[CASES_TAB_MINE] = CASES_PAGE_SIZE;
    }

    // The filters back to "All" and no search, and out of the URL.
    function resetFilters() {
        vm.statusFilter = statusFilterFromSearch({});
        vm.search = "";
        resetMineRows();
        const search = $location.search();
        for (const key of FILTER_SEARCH_KEYS) {
            if (search[key] !== undefined) {
                $location.search(key, null);
            }
        }
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
        resetMineRows();
        $location.search("status", statusFilterSearchValue(filter));
    };

    // Typing replaces the history entry instead of adding one per word.
    vm.handleSearchChange = function() {
        resetMineRows();
        $location.search("q", querySearchValue(vm.search)).replace();
    };

    vm.clearFilters = resetFilters;

    vm.syncFiltersFromUrl = function() {
        const search = $location.search();
        const status = statusFilterFromSearch(search);
        const query = queryFromSearch(search);
        if (status !== vm.statusFilter) {
            vm.statusFilter = status;
            resetMineRows();
        }
        // The field keeps what is being typed (a trailing space) while it
        // matches the URL's search.
        if (query !== (querySearchValue(vm.search) ?? "")) {
            vm.search = query;
            resetMineRows();
        }
    };

    // Sharing: the switch keeps the previous page's behavior, with the
    // publication dialog (#939) and the notice about the designs made private
    // (#934). A case in use keeps its sharing editable (#1014).

    vm.isShared = function(row) {
        return isCaseShared(row.caseItem);
    };

    function showVisibilityResult(result, previousVisibility) {
        const messages = caseVisibilityResultMessages(result, previousVisibility);
        if (messages.length > 0) {
            showToast(
                messages.map(message => $translate.instant(message.key, message.values)).join(" "),
                { timeout: TOAST_VISIBILITY_TIMEOUT_MS }
            );
        }
    }

    vm.toggleSharing = async function(row) {
        if (row.sharing.disabled || vm.busy[row.id]) {
            return;
        }
        vm.busy[row.id] = true;
        try {
            const { outcome, previousVisibility, result, error } = await toggleCaseShareSwitch(
                row.caseItem, {
                    confirm:          () => CasePublicationNoticeService.confirm(),
                    updateVisibility: (caseId, visibility) =>
                        CasesCatalogService.updateCaseVisibility(caseId, visibility),
                });
            if (outcome === SHARE_SWITCH_SAVED) {
                showVisibilityResult(result, previousVisibility);
                await vm.reloadFromCatalog();
            } else if (outcome === SHARE_SWITCH_FAILED) {
                console.error("[CasesPageController] Error changing case visibility.", error);
                vm.showErrorToast("ethical_cases_save_error");
            }
        } finally {
            delete vm.busy[row.id];
            $scope.$applyAsync();
        }
    };

    // Row actions. Their notices stay the previous page's until #1017.

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

    async function copyCase(id) {
        try {
            const copy = await CasesCatalogService.duplicateCase(id);
            await vm.reloadFromCatalog();
            return copy;
        } catch (error) {
            console.error("[CasesPageController] Error duplicating case.", error);
            vm.showErrorToast("ethical_cases_duplicate_error");
            return null;
        }
    }

    // "Duplicate" stays on the page and tab.
    async function duplicate(id) {
        if (await copyCase(id)) {
            vm.showInfoToast("ethical_cases_duplicate_success");
        }
    }

    // "Duplicate to edit", for a case in use: the copy opens in the editor.
    async function duplicateToEdit(id) {
        const copy = await copyCase(id);
        if (copy?.id) {
            $scope.navigateTo(`/cases/${copy.id}/edit`);
        }
    }

    async function setArchived(id, archived) {
        try {
            await CasesCatalogService.updateCaseArchived(id, archived);
            await vm.reloadFromCatalog();
            vm.showInfoToast(archived
                ? "ethical_cases_archive_success"
                : "ethical_cases_unarchive_success");
        } catch (error) {
            console.error("[CasesPageController] Error updating archived status.", error);
            vm.showErrorToast("ethical_cases_archive_error");
        }
    }

    // Deleting keeps the previous page's behavior until its dialog (#1017).
    async function deleteCase(id) {
        try {
            await CasesCatalogService.deleteCase(id);
            await vm.reloadFromCatalog();
            vm.showInfoToast("ethical_cases_delete_success");
        } catch (error) {
            console.error("[CasesPageController] Error deleting case.", error);
            vm.showErrorToast(DELETE_ERROR_KEYS[error?.data?.code] || "ethical_cases_delete_error");
        }
    }

    const ACTIONS = {
        [ROW_ACTION_EDIT]:              id => $scope.navigateTo(`/cases/${id}/edit`),
        [ROW_ACTION_REPLACE_PDF]:       id => $scope.navigateTo(`/cases/${id}/edit`),
        [ROW_ACTION_VIEW]:              id => $scope.navigateTo(`/cases/${id}`),
        [ROW_ACTION_DUPLICATE_TO_EDIT]: duplicateToEdit,
        [ROW_ACTION_DUPLICATE]:         duplicate,
        [ROW_ACTION_ARCHIVE]:           id => setArchived(id, true),
        [ROW_ACTION_RESTORE]:           id => setArchived(id, false),
        [ROW_ACTION_DELETE]:            deleteCase,
    };

    vm.runAction = async function(row, action) {
        if (!action || action.disabled || !ACTIONS[action.id]) {
            return;
        }
        await withBusy(row.id, () => ACTIONS[action.id](row.id));
    };

    // "Shared by others": the previous page's case cards, until #1016.

    vm.viewCase = function(caseItem) {
        $scope.navigateTo(`/cases/${caseItem.id}`);
    };

    vm.importCase = async function(caseItem) {
        await withBusy(caseItem.id, async () => {
            try {
                await CasesCatalogService.importCase(caseItem.id);
                await vm.reloadFromCatalog();
                vm.showInfoToast("ethical_cases_import_success");
                vm.selectTab(CASES_TAB_MINE);
            } catch (error) {
                console.error("[CasesPageController] Error importing case.", error);
                vm.showErrorToast("ethical_cases_import_error");
            }
        });
    };

    vm.init = function() {
        // The route does not reload on a search change (`?tab=`, `?status=`,
        // `?q=`), so Back and Forward reach the page as a route update.
        $scope.$on("$routeUpdate", vm.$onRouteUpdate);
        // Leaving the page with `navigateTo`, which keeps the search, does not
        // carry the tab and the filters to the next page; the page's own
        // history entry keeps them, so Back returns to the same tab and
        // filters.
        $scope.$on("$routeChangeStart", () => {
            const search = $location.search();
            for (const key of PAGE_SEARCH_KEYS) {
                if (search[key] !== undefined) {
                    $location.search(key, null).replace();
                }
            }
        });
        $scope.$on("$destroy", stopDocumentProcessingPolling);

        return vm.load();
    };

    vm.ready = vm.init();
}
