// The row actions of an activity and the notices that follow them (#1094,
// epic #1093), shared by the Activities page and the teacher's home.
//
// `create(scope, options)` returns one instance per controller, so two pages
// never share their busy rows or their notice. An instance offers:
// - `busy`, session id → true while an action on it is pending, so a second
//   click does not repeat it. The object is never replaced, so a controller
//   or a template can keep a reference to it;
// - `run(row, action)`: an entry of the row's actions (`row.primary` or one
//   of `row.menu`, `helpers/activities-table.js`). Opening the dashboard,
//   Reportes, Ver diseño, Ver caso and Lanzar de nuevo leave the page;
//   Copiar código copies; Archivar and Restaurar change the activity through
//   the catalog, which notifies its listeners. Missing, disabled and unknown
//   entries are ignored;
// - `copyCode(row)`, the code's own button, outside the busy rows. It
//   resolves true once copied;
// - `notice`, the notice shown after an action, one at a time, for
//   `NOTICE_TIMEOUT_MS`, built by `helpers/activity-action-feedback.js`;
//   `noticeMessage()`, its message in the current language;
//   `dismissNotice()`; and `runNoticeAction(action)`, its links: "Deshacer"
//   restores the activity just archived, "Ver Archivadas" and "Ver en
//   Terminadas" open that tab.
//
// The options say where the instance is shown:
// - `currentTab()`, the Activities tab on screen, which decides which notice
//   links appear: no "Ver Archivadas" on Archivadas and no "Ver en
//   Terminadas" on Terminadas. By default there is none, so both appear;
// - `showTab(tab)`, how a notice link opens a tab. By default it opens the
//   Activities page on that tab (`#!/activities?tab=archived`). `navigateTo`
//   keeps the current search, so the default sets the search itself.
//
// The notice's timer stops when `scope` is destroyed.

import {
    ROW_ACTION_ARCHIVE,
    ROW_ACTION_COPY_CODE,
    ROW_ACTION_LAUNCH_AGAIN,
    ROW_ACTION_OPEN_DASHBOARD,
    ROW_ACTION_REPORTS,
    ROW_ACTION_RESTORE,
    ROW_ACTION_VIEW_CASE,
    ROW_ACTION_VIEW_DESIGN,
    tabSearchValue,
} from "../helpers/activities-table.js";
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
} from "../helpers/activity-action-feedback.js";
import { translatePlainText } from "../helpers/plain-text-translation.js";

const LOG_PREFIX = "[ActivityRowActionsService]";

export function ActivityRowActionsService($rootScope, $location, $translate, $window, $timeout,
    ActivityCatalogService) {

    // Opens the Activities page on a tab, with no other search.
    function openActivitiesTab(tab) {
        const value = tabSearchValue(tab);
        $rootScope.$applyAsync(() => {
            $location.path("/activities").search(value ? { tab: value } : {});
        });
    }

    function create(scope, { showTab = openActivitiesTab, currentTab = () => null } = {}) {
        const instance = {
            busy:   {},
            notice: null,
        };
        let noticeTimer = null;

        // Notices

        function cancelNoticeTimer() {
            if (noticeTimer) {
                $timeout.cancel(noticeTimer);
                noticeTimer = null;
            }
        }

        scope.$on("$destroy", cancelNoticeTimer);

        function showNotice(notice) {
            cancelNoticeTimer();
            instance.notice = notice;
            noticeTimer = $timeout(() => {
                noticeTimer = null;
                if (instance.notice === notice) {
                    instance.notice = null;
                }
            }, NOTICE_TIMEOUT_MS);
            scope.$applyAsync();
        }

        instance.dismissNotice = function() {
            cancelNoticeTimer();
            instance.notice = null;
        };

        // The notice's message, in the current language. The template binds
        // it as text, so the activity's title is translated as plain text and
        // any markup in it stays text.
        instance.noticeMessage = function() {
            const { notice } = instance;
            return notice ? translatePlainText($translate, notice.messageKey, notice.params) : "";
        };

        // "Deshacer" sends `archived: false`, so a second "Deshacer" leaves
        // the activity restored; while the row is still busy it is dropped.
        instance.runNoticeAction = async function(action) {
            instance.dismissNotice();
            if (action?.id === NOTICE_ACTION_UNDO_ARCHIVE) {
                await withBusy(action.sessionId,
                    () => setArchived(action.sessionId, action.title, false));
            } else if (action?.id === NOTICE_ACTION_SHOW_ARCHIVED) {
                showTab("archived");
            } else if (action?.id === NOTICE_ACTION_SHOW_FINISHED) {
                showTab("finished");
            }
        };

        // Row actions

        async function withBusy(id, run) {
            if (instance.busy[id]) {
                return;
            }
            instance.busy[id] = true;
            try {
                await run();
            } finally {
                delete instance.busy[id];
                scope.$applyAsync();
            }
        }

        // Copies the row's access code, from its button or the row menu, and
        // says "Código copiado", or that the browser did not let it.
        instance.copyCode = async function(row) {
            if (!row?.code) {
                return false;
            }
            try {
                await $window.navigator.clipboard.writeText(row.code);
                showNotice(codeCopiedNotice());
                return true;
            } catch (error) {
                console.error(`${LOG_PREFIX} Could not copy the code.`, error);
                showNotice(copyFailureNotice());
                return false;
            }
        };

        // Archives a finished activity or restores an archived one, and names
        // it in a notice: "Se archivó" with "Deshacer" and "Ver Archivadas",
        // or "Se restauró" with "Ver en Terminadas". The notice is shown
        // before the row stops being busy. The server refuses to archive an
        // activity that is not finished (409 ACTIVITY_NOT_FINISHED): the list
        // was stale, so it is loaded again and the notice says why.
        async function setArchived(id, title, archived) {
            try {
                await ActivityCatalogService.setArchived(id, archived);
                const tab = currentTab();
                showNotice(archived
                    ? archiveNotice(id, title, { showArchived: tab !== "archived" })
                    : restoreNotice(id, title, { showFinished: tab !== "finished" }));
            } catch (error) {
                if (error?.status === 409) {
                    console.warn(`${LOG_PREFIX} The server refused the archive change; `
                        + "reloading the activities.", error?.data?.code);
                    await ActivityCatalogService.loadActivities();
                } else {
                    console.error(`${LOG_PREFIX} Error updating archived status.`, error);
                }
                showNotice(archiveChangeFailureNotice(error, archived));
            }
        }

        const navigateTo = path => $rootScope.navigateTo(path);
        const ACTIONS = {
            [ROW_ACTION_OPEN_DASHBOARD]: row => navigateTo(`/activities/${row.id}`),
            [ROW_ACTION_REPORTS]:        row => navigateTo(`/activities/${row.id}/reports`),
            [ROW_ACTION_COPY_CODE]:      row => instance.copyCode(row),
            [ROW_ACTION_VIEW_DESIGN]:    row => navigateTo(`/designs/${row.designId}`),
            [ROW_ACTION_VIEW_CASE]:      row => navigateTo(`/cases/${row.caseId}`),
            [ROW_ACTION_LAUNCH_AGAIN]:   row => navigateTo(`/activities/new/${row.designId}`),
            [ROW_ACTION_ARCHIVE]:        row => setArchived(row.id, row.titleText, true),
            [ROW_ACTION_RESTORE]:        row => setArchived(row.id, row.titleText, false),
        };

        instance.run = async function(row, action) {
            if (!row || !action || action.disabled || !Object.hasOwn(ACTIONS, action.id)) {
                return;
            }
            await withBusy(row.id, () => ACTIONS[action.id](row));
        };

        return instance;
    }

    return { create };
}
