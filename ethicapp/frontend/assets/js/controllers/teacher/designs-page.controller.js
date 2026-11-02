// The Designs page (#975, epic #966), `#!/designs`: managing the teacher's
// designs, apart from launching activities. Its tabs are "My designs",
// "Shared by others" and "Archived", with the tab in the URL (`?tab=shared`,
// `?tab=archived`); the route does not reload on a search change, so the
// browser's Back and Forward switch tabs as a route update.
//
// "My designs" and "Archived" are tables built by `helpers/designs-table.js`:
// one row per design with its status, its sharing switch, one visible action
// and a "⋯" menu. "Shared by others" keeps the cards of the previous page
// until it is rebuilt (#977).

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
import { designMatchesLaunchSearch } from "../../helpers/launch-design-list.js";
import {
    DELETE_CHOICE_ARCHIVE,
    DELETE_CHOICE_DELETE,
    NOTICE_ACTION_EDIT_COPY,
    NOTICE_ACTION_UNDO_ARCHIVE,
    NOTICE_TIMEOUT_MS,
    archiveFailureNotice,
    archiveNotice,
    deleteFailureNotice,
    deleteNotice,
    duplicateFailureNotice,
    duplicateNotice,
    findDesignTitle,
    restoreNotice,
} from "../../helpers/design-action-feedback.js";

function initialVisibleCounts() {
    return {
        [DESIGNS_TAB_MINE]:     DESIGNS_PAGE_SIZE,
        [DESIGNS_TAB_SHARED]:   DESIGNS_PAGE_SIZE,
        [DESIGNS_TAB_ARCHIVED]: DESIGNS_PAGE_SIZE,
    };
}

export function DesignsPageController($scope, $location, $translate, toast,
    DesignCatalogService, DesignPublicationService, ActivityCatalogService,
    DesignDeleteConfirmService, $timeout) {

    const vm = this;

    vm.tab = tabFromSearch($location.search());
    vm.loaded = false;
    vm.loadFailed = false;
    vm.tables = { mine: [], archived: [], shared: [] };
    vm.visibleCounts = initialVisibleCounts();
    vm.sharedSearch = "";
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
    };

    vm.openSharedTab = function() {
        vm.selectTab(DESIGNS_TAB_SHARED);
    };

    // "Show more"

    vm.getRows = function(tab) {
        if (tab === DESIGNS_TAB_SHARED) {
            return vm.tables.shared
                .filter(design => designMatchesLaunchSearch(design, vm.sharedSearch));
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

    // Notices after row actions (#978): one at a time, for a few seconds,
    // and dismissible. Built by `helpers/design-action-feedback.js`.

    vm.notice = null;
    let noticeTimer = null;

    function cancelNoticeTimer() {
        if (noticeTimer) {
            $timeout.cancel(noticeTimer);
            noticeTimer = null;
        }
    }

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

    vm.runNoticeAction = async function(action) {
        vm.dismissNotice();
        if (action?.id === NOTICE_ACTION_EDIT_COPY) {
            $scope.navigateTo(`/designs/${action.designId}/edit`);
        } else if (action?.id === NOTICE_ACTION_UNDO_ARCHIVE) {
            await withBusy(action.designId, () => setArchived(action.designId, false));
        }
    };

    // Row actions

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

    async function titleOf(id) {
        return findDesignTitle(await DesignCatalogService.getDesigns(), id);
    }

    async function copyDesign(id) {
        try {
            return await DesignCatalogService.duplicateDesign(id);
        } catch (error) {
            console.error("[DesignsPageController] Error duplicating design.", error);
            vm.showNotice(duplicateFailureNotice());
            return null;
        }
    }

    // "Duplicate" stays on the page and names the copy, with "Edit copy".
    async function duplicate(id) {
        const copyId = await copyDesign(id);
        if (copyId !== null) {
            vm.showNotice(duplicateNotice(copyId, await titleOf(copyId)));
        }
    }

    async function duplicateToEdit(id) {
        const copyId = await copyDesign(id);
        if (copyId !== null && copyId !== undefined) {
            $scope.navigateTo(`/designs/${copyId}/edit`);
        }
    }

    async function setArchived(id, archived) {
        const title = await titleOf(id);
        try {
            await DesignCatalogService.updateDesignArchived(id, archived);
            vm.showNotice(archived ? archiveNotice(id, title) : restoreNotice(title));
        } catch (error) {
            console.error("[DesignsPageController] Error updating archived status.", error);
            vm.showNotice(archiveFailureNotice());
        }
    }

    // Deleting asks first, and offers to archive instead unless the design is
    // archived already. A design with copies can be deleted; the copies keep
    // their source's title, author and license (#963).
    async function deleteDesign(id) {
        const designs = await DesignCatalogService.getDesigns();
        const design = designs.find(item => item?.id === id);
        const title = findDesignTitle(designs, id);
        const choice = await DesignDeleteConfirmService.confirm({
            title,
            canArchive: design?.archived !== true,
        });
        if (choice === DELETE_CHOICE_ARCHIVE) {
            await setArchived(id, true);
            return;
        }
        if (choice !== DELETE_CHOICE_DELETE) {
            return;
        }
        try {
            await DesignCatalogService.deleteDesign(id);
            vm.showNotice(deleteNotice(title));
        } catch (error) {
            vm.showNotice(deleteFailureNotice(error));
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
        if (!action || action.disabled || !ACTIONS[action.id]) {
            return;
        }
        await withBusy(row.id, () => ACTIONS[action.id](row.id));
    };

    // Importing keeps the previous page's behavior until #977.
    vm.importDesign = async function(id) {
        try {
            await DesignCatalogService.importDesign(id);
            $scope.$applyAsync(() => {
                $translate("design_imported_text").then((result) => {
                    toast.create({
                        timeout:           100 * 1000,
                        message:           result,
                        containerClass:    "designs-toast-container",
                        dismissible:       false,
                        defaultToastClass: "toast",
                        insertFromTop:     true,
                    });
                });
            });
        } catch (error) {
            const messageKey = error?.data?.code === "DESIGN_CASE_NOT_IMPORTABLE"
                ? "design_import_blocked_by_case"
                : "design_import_error";
            vm.showDesignToast(messageKey, "alert-danger");
        }
    };

    vm.init = function() {
        const onCatalogUpdated = () => {
            vm.reloadFromCatalog();
        };
        DesignCatalogService.registerListener("onDesignCatalogUpdated", onCatalogUpdated);
        $scope.$on("$destroy", () => {
            DesignCatalogService.unregisterListener("onDesignCatalogUpdated", onCatalogUpdated);
            cancelNoticeTimer();
        });
        $scope.$on("caseVisibilityUpdatedDesigns", (_event, data) => {
            DesignCatalogService.applyPrivateVisibilityToDesigns(data?.affectedDesignIds || []);
        });

        // The route does not reload on a search change (`?tab=`), so Back and
        // Forward reach the page as a route update.
        $scope.$on("$routeUpdate", vm.$onRouteUpdate);
        // Leaving the page with `navigateTo`, which keeps the search, does not
        // carry `?tab=` to the next page; the page's own history entry keeps
        // it, so Back returns to the same tab.
        $scope.$on("$routeChangeStart", () => {
            if ($location.search().tab !== undefined) {
                $location.search("tab", null).replace();
            }
        });

        return vm.load();
    };

    vm.ready = vm.init();
}
