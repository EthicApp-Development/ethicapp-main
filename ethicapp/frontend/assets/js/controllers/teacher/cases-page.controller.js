// The Cases page (#1013, epic #1008), `#!/cases`: managing the teacher's
// cases. Its tabs are "My cases", "Shared by others" and "Archived", with the
// tab in the URL (`?tab=shared`, `?tab=archived`); the route does not reload
// on a search change, so the browser's Back and Forward switch tabs as a
// route update.
//
// "My cases" and "Archived" are tables built by `helpers/cases-table.js`: one
// row per case with its status, the designs that use it, its sharing switch,
// one visible action and a "⋯" menu. "Shared by others" is a table built by
// `helpers/cases-shared-table.js` (#1016): one row per case another teacher
// shares, with its one import action.
//
// "My cases" has a search and status filters (#1015), also in the URL
// (`?status=in-use&q=...`, `helpers/cases-filters.js`). Switching tabs clears
// them, as the tabs' links do.
//
// Deleting asks first (`CaseDeleteConfirmService`), and every row action
// ends with a notice that names its result (#1017).
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
    ROW_ACTION_NEW_DESIGN,
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
    CASE_IMPORT_STATE_IMPORTABLE,
    buildSharedCaseRows,
    sharedCaseMatchesSearch,
} from "../../helpers/cases-shared-table.js";
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
import {
    DELETE_CHOICE_ARCHIVE,
    DELETE_CHOICE_DELETE,
    NOTICE_ACTION_EDIT_COPY,
    NOTICE_ACTION_SHOW_IN_MINE,
    NOTICE_ACTION_UNDO_ARCHIVE,
    NOTICE_TIMEOUT_MS,
    archiveFailureNotice,
    archiveNotice,
    caseTitle,
    deleteFailureNotice,
    deleteNotice,
    duplicateFailureNotice,
    duplicateNotice,
    findCaseTitle,
    importFailureNotice,
    importNotice,
    isCodedDeleteRefusal,
    restoreFailureNotice,
    restoreNotice,
} from "../../helpers/case-action-feedback.js";
import { newDesignFromCasePath } from "../../helpers/new-design-from-case.js";

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

function initialVisibleCounts() {
    return {
        [CASES_TAB_MINE]:     CASES_PAGE_SIZE,
        [CASES_TAB_SHARED]:   CASES_PAGE_SIZE,
        [CASES_TAB_ARCHIVED]: CASES_PAGE_SIZE,
    };
}

export function CasesPageController($scope, $location, $translate, $interval, toast,
    CasesCatalogService, LanguageCatalogService, CasePublicationNoticeService,
    $timeout, CaseDeleteConfirmService) {

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
        vm.tables.shared = buildSharedCaseRows(vm.tables.shared,
            [...cases.own, ...cases.archived], languageNames);
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

    // Notices after row actions and imports (#1017): one at a time, for a few
    // seconds, and dismissible. Built by `helpers/case-action-feedback.js`.

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

    // A notice's links: "Edit copy" opens the copy in the editor, "View in My
    // cases" opens that tab, and "Undo" restores the case just archived.
    vm.runNoticeAction = async function(action) {
        vm.dismissNotice();
        if (action?.id === NOTICE_ACTION_EDIT_COPY) {
            $scope.navigateTo(`/cases/${action.caseId}/edit`);
        } else if (action?.id === NOTICE_ACTION_SHOW_IN_MINE) {
            vm.selectTab(CASES_TAB_MINE);
        } else if (action?.id === NOTICE_ACTION_UNDO_ARCHIVE) {
            await withBusy(action.caseId, () => setArchived(action.caseId, false));
        }
    };

    // Row actions. Each one stays on the page and its tab.

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

    function findCase(id) {
        return [...cases.own, ...cases.archived].find(item => item?.id === id) || null;
    }

    async function copyCase(id) {
        try {
            const copy = await CasesCatalogService.duplicateCase(id);
            await vm.reloadFromCatalog();
            return copy;
        } catch (error) {
            console.error("[CasesPageController] Error duplicating case.", error);
            vm.showNotice(duplicateFailureNotice());
            return null;
        }
    }

    // "Duplicate" names the copy, with "Edit copy".
    async function duplicate(id) {
        const copy = await copyCase(id);
        if (copy) {
            vm.showNotice(duplicateNotice(copy.id,
                caseTitle(copy) || findCaseTitle(cases.own, copy.id)));
        }
    }

    // "Duplicate to edit", for a case in use: the copy opens in the editor.
    async function duplicateToEdit(id) {
        const copy = await copyCase(id);
        if (copy?.id) {
            $scope.navigateTo(`/cases/${copy.id}/edit`);
        }
    }

    // "Archive" names the case, with "Undo"; "Restore" names it too.
    async function setArchived(id, archived) {
        const title = caseTitle(findCase(id));
        try {
            await CasesCatalogService.updateCaseArchived(id, archived);
            await vm.reloadFromCatalog();
            vm.showNotice(archived ? archiveNotice(id, title) : restoreNotice(title));
        } catch (error) {
            console.error("[CasesPageController] Error updating archived status.", error);
            vm.showNotice(archived ? archiveFailureNotice() : restoreFailureNotice());
        }
    }

    // After a coded refusal the lists were stale, and the catalog did not
    // reload them: they are fetched again, so the row says why the case
    // cannot be deleted, or the case leaves the list.
    async function reloadStaleLists() {
        try {
            const [own, shared, archived] = await Promise.all([
                CasesCatalogService.getCases(true),
                CasesCatalogService.getPublicCases(true),
                CasesCatalogService.getArchivedCases(true),
            ]);
            cases = { own, shared, archived };
            vm.refresh();
        } catch (error) {
            console.warn("[CasesPageController] Could not reload cases.", error);
        }
    }

    // Deleting asks first, and offers to archive instead unless the case is
    // archived already. Its copies are kept; the teacher's designs that use
    // it lose their case.
    async function deleteCase(id) {
        const caseItem = findCase(id);
        const title = caseTitle(caseItem);
        const choice = await CaseDeleteConfirmService.confirm({
            caseId:   id,
            title,
            archived: cases.archived.some(item => item?.id === id),
        });
        if (choice === DELETE_CHOICE_ARCHIVE) {
            await setArchived(id, true);
            return;
        }
        if (choice !== DELETE_CHOICE_DELETE) {
            return;
        }
        try {
            await CasesCatalogService.deleteCase(id);
            await vm.reloadFromCatalog();
            vm.showNotice(deleteNotice(title));
        } catch (error) {
            console.error("[CasesPageController] Error deleting case.", error);
            vm.showNotice(deleteFailureNotice(error));
            if (isCodedDeleteRefusal(error)) {
                await reloadStaleLists();
            }
        }
    }

    const ACTIONS = {
        [ROW_ACTION_EDIT]:              id => $scope.navigateTo(`/cases/${id}/edit`),
        [ROW_ACTION_REPLACE_PDF]:       id => $scope.navigateTo(`/cases/${id}/edit`),
        [ROW_ACTION_VIEW]:              id => $scope.navigateTo(`/cases/${id}`),
        [ROW_ACTION_NEW_DESIGN]:        newDesignWithCase,
        [ROW_ACTION_DUPLICATE_TO_EDIT]: duplicateToEdit,
        [ROW_ACTION_DUPLICATE]:         duplicate,
        [ROW_ACTION_ARCHIVE]:           id => setArchived(id, true),
        [ROW_ACTION_RESTORE]:           id => setArchived(id, false),
        [ROW_ACTION_DELETE]:            deleteCase,
    };

    // "New design with this case" (#1019): the design form, with the case
    // preselected. `navigateTo` sets only the path, so the form's URL is set
    // whole; the page's history entry keeps its tab and filters for Back.
    function newDesignWithCase(id) {
        const path = newDesignFromCasePath(id);
        if (path) {
            $scope.$applyAsync(() => {
                $location.url(path);
            });
        }
    }

    vm.runAction = async function(row, action) {
        if (!action || action.disabled || !ACTIONS[action.id]) {
            return;
        }
        await withBusy(row.id, () => ACTIONS[action.id](row.id));
    };

    // "Shared by others" (#1016): the search, and importing. A row whose case
    // the teacher has not imported creates a private, editable copy in "My
    // cases"; the page stays on the tab, the row turns "Imported · View copy"
    // and a notice names the copy, with "Edit copy" and "View in My cases".

    vm.sharedSearch = "";

    vm.getSharedRows = function() {
        return vm.tables.shared.filter(row => sharedCaseMatchesSearch(row, vm.sharedSearch));
    };

    vm.getVisibleSharedRows = function() {
        return vm.getSharedRows().slice(0, vm.visibleCounts[CASES_TAB_SHARED]);
    };

    vm.hasMoreSharedRows = function() {
        return vm.getSharedRows().length > vm.visibleCounts[CASES_TAB_SHARED];
    };

    vm.handleSharedSearchChange = function() {
        vm.visibleCounts[CASES_TAB_SHARED] = CASES_PAGE_SIZE;
    };

    vm.importCase = async function(row) {
        if (row?.importState !== CASE_IMPORT_STATE_IMPORTABLE) {
            return;
        }
        await withBusy(row.id, async () => {
            try {
                const copy = await CasesCatalogService.importCase(row.id);
                // The catalog reloaded its lists: the copy is in "My cases"
                // and the row turns "Imported".
                await vm.reloadFromCatalog();
                vm.showNotice(importNotice(copy?.id,
                    caseTitle(copy) || findCaseTitle(cases.own, copy?.id)));
            } catch (error) {
                vm.showNotice(importFailureNotice(error));
                if (error?.data?.code === "CASE_NOT_IMPORTABLE") {
                    // The case stopped being shared: reload the list, so its
                    // row goes away.
                    await reloadAfterRefusedImport();
                } else {
                    console.error("[CasesPageController] Error importing case.", error);
                }
            }
        });
    };

    async function reloadAfterRefusedImport() {
        try {
            await CasesCatalogService.getPublicCases(true);
            await vm.reloadFromCatalog();
        } catch (error) {
            console.warn("[CasesPageController] Could not reload the shared cases.", error);
        }
    }

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
