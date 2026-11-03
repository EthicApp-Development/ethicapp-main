// The case view (#1018, epic #1008), `#!/cases/:id`: a head with "← Cases",
// the case's title, author and creation date, and its actions; its facts as
// one line of chips; the designs that use it; then the tabs: the case text,
// its material, one per AI analysis, and its rights.
//
// What it shows comes from `helpers/case-view.js`, over GET /cases/:id and
// GET /cases/:id/uses. "← Cases" returns to the list as the teacher left it,
// from `CasesListLocationService`. The actions' notices are the list's
// previous toasts. Deleting asks first, with the list's dialog
// (`CaseDeleteConfirmService`, #1017), then returns to the list, whose toast
// container shows the notice.

import {
    ROW_ACTION_ARCHIVE,
    ROW_ACTION_DELETE,
    ROW_ACTION_DUPLICATE,
    ROW_ACTION_DUPLICATE_TO_EDIT,
    ROW_ACTION_EDIT,
    ROW_ACTION_REPLACE_PDF,
    ROW_ACTION_RESTORE,
    languageNamesByCode,
} from "../../helpers/cases-table.js";
import { findImportedCopy, importedCopiesBySource } from "../../helpers/case-status.js";
import {
    CASE_VIEW_ACTION_IMPORT,
    buildCaseView,
    isCaseAuthor,
} from "../../helpers/case-view.js";
import {
    DELETE_CHOICE_ARCHIVE,
    DELETE_CHOICE_DELETE,
    caseTitle,
    deleteFailureNotice,
    deleteNotice,
    isCodedDeleteRefusal,
} from "../../helpers/case-action-feedback.js";

const TOAST_INFO_TIMEOUT_MS = 4 * 1000;
const TOAST_ERROR_TIMEOUT_MS = 6 * 1000;

// How often the case's document processing is checked while it is pending.
const DOCUMENT_PROCESSING_POLL_MS = 5000;
const ACTIVE_RENDER_STATUSES = new Set(["pending", "processing"]);

function caseIdOf(value) {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}

export function CaseViewController($scope, $routeParams, $interval, $translate, toast,
    CasesCatalogService, LanguageCatalogService, UserProfileService, CasesListLocationService,
    $location, CaseDeleteConfirmService) {

    const vm = this;

    vm.caseId = caseIdOf($routeParams.id);
    vm.backHref = CasesListLocationService.lastHref();
    vm.loaded = false;
    // A translation key when the case could not be shown.
    vm.loadErrorKey = null;
    vm.caseItem = null;
    vm.view = null;
    // True when GET /cases/:id/uses failed: the uses panel says so.
    vm.usesFailed = false;
    vm.busy = false;

    let uses = null;
    let isAuthor = false;
    let importedCopy = null;
    let languageNames = new Map();
    let licenses = [];
    let documentProcessingPoll = null;

    // Toasts

    function showToast(key, { className, timeout = TOAST_INFO_TIMEOUT_MS, params } = {}) {
        toast.create({
            timeout,
            message:           $translate.instant(key, params),
            className,
            containerClass:    "cases-toast-container",
            dismissible:       false,
            defaultToastClass: "toast",
            insertFromTop:     true,
        });
    }

    vm.showInfoToast = function(key) {
        showToast(key);
    };

    vm.showErrorToast = function(key) {
        showToast(key, { className: "alert-danger", timeout: TOAST_ERROR_TIMEOUT_MS });
    };

    // Loading

    vm.refresh = function() {
        if (!vm.caseItem) {
            vm.view = null;
            stopDocumentProcessingPolling();
            return;
        }
        vm.view = buildCaseView({
            caseItem:   vm.caseItem,
            uses,
            isAuthor,
            importedCopy,
            languageNames,
            licenses,
            uiLanguage: LanguageCatalogService.getCurrentUiLanguageCode(),
        });
        syncDocumentProcessingPolling();
    };

    async function optional(label, load, fallback) {
        try {
            return await load();
        } catch (error) {
            console.warn(`[CaseViewController] Could not load ${label}.`, error);
            return fallback;
        }
    }

    // The teacher's copy of another teacher's case, among their own and
    // archived cases: the catalog keeps both lists, so this costs at most two
    // requests, and none when the list page loaded them.
    async function findCopy(caseItem) {
        const [own, archived] = await Promise.all([
            CasesCatalogService.getCases(),
            CasesCatalogService.getArchivedCases(),
        ]);
        return findImportedCopy(caseItem, importedCopiesBySource([...own, ...archived]));
    }

    vm.load = async function() {
        if (vm.caseId === null) {
            vm.loadErrorKey = "case_view_not_found";
            vm.loaded = true;
            return;
        }

        vm.loadErrorKey = null;
        try {
            vm.caseItem = await CasesCatalogService.getCaseById(vm.caseId);
        } catch (error) {
            console.error("[CaseViewController] Could not load the case.", error);
            vm.caseItem = null;
            vm.refresh();
            vm.loadErrorKey = error?.status === 404
                ? "case_view_not_found"
                : "case_view_load_failed";
            vm.loaded = true;
            $scope.$applyAsync();
            return;
        }

        // Without these the view still shows the case: without its uses
        // (and with the lock of a case in use from the case itself), the
        // language's code and the license's code.
        const [caseUses, profile, languages, licenseList] = await Promise.all([
            optional("the case's uses", () => CasesCatalogService.getCaseUses(vm.caseId), null),
            optional("the profile", () => UserProfileService.getProfile(), null),
            optional("languages", () => LanguageCatalogService.getLanguages(), []),
            optional("licenses", () => CasesCatalogService.getLicenses(), []),
        ]);
        uses = caseUses;
        vm.usesFailed = caseUses === null;
        isAuthor = isCaseAuthor(vm.caseItem, profile, caseUses);
        languageNames = languageNamesByCode(languages);
        licenses = licenseList;
        if (!isAuthor) {
            importedCopy = await optional("the teacher's cases", () => findCopy(vm.caseItem), null);
        }

        vm.refresh();
        vm.loaded = true;
        $scope.$applyAsync();
    };

    // Document processing: checked while the PDF is being rendered. Once its
    // pages are ready the case is loaded again, so the viewer shows them
    // instead of the PDF.

    function isProcessing() {
        return ACTIVE_RENDER_STATUSES.has(vm.caseItem?.documentProcessing?.status);
    }

    function stopDocumentProcessingPolling() {
        if (documentProcessingPoll) {
            $interval.cancel(documentProcessingPoll);
            documentProcessingPoll = null;
        }
    }

    function syncDocumentProcessingPolling() {
        if (!isProcessing()) {
            stopDocumentProcessingPolling();
        } else if (!documentProcessingPoll) {
            documentProcessingPoll = $interval(() => {
                vm.refreshDocumentProcessing();
            }, DOCUMENT_PROCESSING_POLL_MS);
        }
    }

    vm.refreshDocumentProcessing = async function() {
        if (!isProcessing()) {
            stopDocumentProcessingPolling();
            return;
        }
        try {
            const { documentProcessing } = await CasesCatalogService
                .getCaseDocumentProcessing(vm.caseId);
            if (documentProcessing?.status === "completed") {
                vm.caseItem = await CasesCatalogService.getCaseById(vm.caseId);
            } else {
                vm.caseItem = { ...vm.caseItem, documentProcessing };
            }
            vm.refresh();
        } catch (error) {
            console.error("[CaseViewController] Could not refresh the document processing.", error);
        }
        $scope.$applyAsync();
    };

    // Actions

    async function duplicate({ thenEdit }) {
        try {
            const copy = await CasesCatalogService.duplicateCase(vm.caseId);
            if (thenEdit && copy?.id) {
                $scope.navigateTo(`/cases/${copy.id}/edit`);
            } else {
                vm.showInfoToast("ethical_cases_duplicate_success");
            }
        } catch (error) {
            console.error("[CaseViewController] Error duplicating the case.", error);
            vm.showErrorToast("ethical_cases_duplicate_error");
        }
    }

    async function setArchived(archived) {
        try {
            const result = await CasesCatalogService.updateCaseArchived(vm.caseId, archived);
            vm.caseItem = { ...vm.caseItem, archived: result?.archived ?? archived };
            vm.refresh();
            vm.showInfoToast(archived
                ? "ethical_cases_archive_success"
                : "ethical_cases_unarchive_success");
        } catch (error) {
            console.error("[CaseViewController] Error updating the archived status.", error);
            vm.showErrorToast("ethical_cases_archive_error");
        }
    }

    // Importing stays on the view, which then offers the copy.
    async function importCase() {
        try {
            const copy = await CasesCatalogService.importCase(vm.caseId);
            importedCopy = copy?.id ? copy : await findCopy(vm.caseItem);
            vm.refresh();
            vm.showInfoToast("ethical_cases_import_success");
        } catch (error) {
            console.error("[CaseViewController] Error importing the case.", error);
            vm.showErrorToast("ethical_cases_import_error");
        }
    }

    // Deleting asks first; the dialog can offer to archive instead. A deleted
    // case returns to the list as the teacher left it. A refused delete (the
    // case is gone, or in use since it was loaded) says why and loads the
    // case again, so its menu shows the reason.
    async function deleteCase() {
        const title = caseTitle(vm.caseItem);
        const choice = await CaseDeleteConfirmService.confirm({
            caseId:   vm.caseId,
            title,
            archived: vm.caseItem?.archived === true,
        });
        if (choice === DELETE_CHOICE_ARCHIVE) {
            await setArchived(true);
            return;
        }
        if (choice !== DELETE_CHOICE_DELETE) {
            return;
        }
        try {
            await CasesCatalogService.deleteCase(vm.caseId);
        } catch (error) {
            console.error("[CaseViewController] Error deleting the case.", error);
            const notice = deleteFailureNotice(error);
            showToast(notice.messageKey, {
                params: notice.params, className: "alert-danger", timeout: TOAST_ERROR_TIMEOUT_MS,
            });
            if (isCodedDeleteRefusal(error)) {
                await vm.load();
            }
            return;
        }
        const notice = deleteNotice(title);
        showToast(notice.messageKey, { params: notice.params });
        stopDocumentProcessingPolling();
        $scope.$applyAsync(() => {
            $location.url(CasesListLocationService.lastUrl());
        });
    }

    const ACTIONS = {
        [ROW_ACTION_EDIT]:              () => $scope.navigateTo(`/cases/${vm.caseId}/edit`),
        [ROW_ACTION_REPLACE_PDF]:       () => $scope.navigateTo(`/cases/${vm.caseId}/edit`),
        [ROW_ACTION_DUPLICATE_TO_EDIT]: () => duplicate({ thenEdit: true }),
        [ROW_ACTION_DUPLICATE]:         () => duplicate({ thenEdit: false }),
        [ROW_ACTION_ARCHIVE]:           () => setArchived(true),
        [ROW_ACTION_RESTORE]:           () => setArchived(false),
        [CASE_VIEW_ACTION_IMPORT]:      importCase,
        [ROW_ACTION_DELETE]:            deleteCase,
    };

    // Runs one action at a time, so a second click does not repeat it.
    // "Imported · View copy" is a link to the copy, not an action.
    vm.runAction = async function(action) {
        if (!action || action.disabled || !ACTIONS[action.id] || vm.busy) {
            return;
        }
        vm.busy = true;
        try {
            await ACTIONS[action.id]();
        } finally {
            vm.busy = false;
            $scope.$applyAsync();
        }
    };

    vm.init = function() {
        $scope.$on("$destroy", stopDocumentProcessingPolling);
        return vm.load();
    };

    vm.ready = vm.init();
}
