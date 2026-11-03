// Tabs of the teacher case view (#651, epic #647): the case text first and by
// default (the transcluded content), then the case's material when it has
// any (the `case-view-material` slot, #1018), one tab per analysis chosen for
// the case, and its rights (the `case-view-rights` slot, #1018). A case
// without analyses, material or rights tab shows no tab bar, as before.
// Analysis tabs render their panel only while open, so opening a case loads
// the case text and the analysis list (statuses, without documents) only. The
// list is polled while a generation is in flight.
//
// For the case's creator (`canAddAnalyses`), "Add analysis" at the end of the
// tab bar (#1039) offers the usable case-scoped services the case has not
// chosen, in a dialog, and shows only when there is one. The services it adds
// appear as tabs in their processing state, polled as after creation.
//
// Each analysis tab also offers the creator "Remove analysis" (#1040), from
// its panel (`on-remove`). Once the dialog removed it, the tab goes away, the
// case text opens, `onAnalysisRemoved` lets the view confirm it, and "Add
// analysis" offers the service again.

import {
    CASE_ANALYSES_POLL_INTERVAL_MS,
    caseAnalysisIndicator,
    caseAnalysisTabTitle,
    hasCaseAnalysisGenerationRunning,
    isCaseAnalysisInFlight,
    mergeCaseAnalysis,
} from "../helpers/case-analyses.js";
import {
    CASE_ANALYSIS_SCOPE,
    caseAnalysisServicesToAdd,
} from "../helpers/case-analysis-options.js";

// The keys of the fixed tabs. Analysis tabs are keyed by their service id,
// which is kebab-case (`ai-services-catalog.service.js`), so these cannot
// collide with one.
export const CASE_VIEW_TAB_MATERIAL = "@material";
export const CASE_VIEW_TAB_RIGHTS = "@rights";
const FIXED_TAB_DOM_IDS = {
    [CASE_VIEW_TAB_MATERIAL]: "material",
    [CASE_VIEW_TAB_RIGHTS]:   "rights",
};

let instanceCount = 0;

function CaseViewTabsController($scope, $element, $timeout, CaseAnalysesService,
    LanguageCatalogService, ExternalServicesCatalogService, CaseAnalysisAddDialogService,
    CaseAnalysisRemoveDialogService) {
    const vm = this;
    instanceCount += 1;
    const idPrefix = `case-view-tabs-${instanceCount}`;

    let destroyed = false;
    let loadedCaseId = null;
    // The next poll, scheduled only after the previous list request settles.
    let poll = null;
    // The list request in flight; at most one runs at a time.
    let refreshing = null;
    let refreshAgain = false;
    // Bumped by every local change to the list (an accepted generation), so a
    // list response requested before it cannot undo it.
    let localRevision = 0;

    vm.analyses = [];
    vm.activeServiceId = null;
    vm.listFailed = false;
    // Whether the list of the current case has loaded once.
    vm.listLoaded = false;
    // The usable case-scoped services, for "Add analysis".
    vm.caseServices = [];
    // True while the "Add analysis" dialog is open.
    vm.adding = false;
    // True while the "Remove analysis" dialog is open.
    vm.removing = false;
    vm.materialTab = CASE_VIEW_TAB_MATERIAL;
    vm.rightsTab = CASE_VIEW_TAB_RIGHTS;

    vm.$onChanges = function(changes) {
        // A fixed tab that goes away while open gives way to the case text.
        if (!tabKeys().includes(vm.activeServiceId)) {
            vm.activeServiceId = null;
        }
        if (changes.canAddAnalyses && vm.canAddAnalyses === true) {
            loadCaseServices();
        }
        if (!changes.caseItem) {
            return;
        }

        const caseId = vm.caseItem?.id ?? null;
        if (caseId === loadedCaseId) {
            return;
        }

        loadedCaseId = caseId;
        vm.analyses = [];
        vm.activeServiceId = null;
        vm.listFailed = false;
        vm.listLoaded = false;
        vm.refresh();
    };

    // The services "Add analysis" may offer. Without them the action is not
    // shown; the dialog asks for them again when it opens.
    async function loadCaseServices() {
        try {
            const services = await ExternalServicesCatalogService.getServices({
                scopes: [CASE_ANALYSIS_SCOPE],
            });
            vm.caseServices = Array.isArray(services) ? services : [];
        } catch (error) {
            console.warn("[caseViewTabs] Could not load the case analysis services.", error);
            vm.caseServices = [];
        }
        $scope.$applyAsync();
    }

    vm.$onDestroy = function() {
        destroyed = true;
        cancelPoll();
    };

    function cancelPoll() {
        if (poll) {
            $timeout.cancel(poll);
            poll = null;
        }
    }

    // Polls again after CASE_ANALYSES_POLL_INTERVAL_MS while a generation is
    // in flight. Called when a request settles, so polls never overlap.
    function schedulePoll() {
        cancelPoll();
        if (destroyed || refreshing || !vm.analyses.some(isCaseAnalysisInFlight)) {
            return;
        }
        poll = $timeout(() => {
            poll = null;
            vm.refresh();
        }, CASE_ANALYSES_POLL_INTERVAL_MS);
    }

    // One list request. Its response is dropped when the view is gone, the
    // case changed, or the list changed locally meanwhile (then it runs again).
    async function loadOnce() {
        const caseId = loadedCaseId;
        if (!caseId) {
            return;
        }

        const revision = localRevision;
        try {
            const analyses = await CaseAnalysesService.listAnalyses(caseId);
            if (destroyed || caseId !== loadedCaseId) {
                return;
            }
            if (revision !== localRevision) {
                refreshAgain = true;
                return;
            }
            vm.analyses = analyses;
            vm.listFailed = false;
            vm.listLoaded = true;
            if (!tabKeys().includes(vm.activeServiceId)) {
                vm.activeServiceId = null;
            }
        } catch (error) {
            if (destroyed || caseId !== loadedCaseId) {
                return;
            }
            console.error("[caseViewTabs] Could not load the case analyses.", error);
            vm.listFailed = true;
        }
    }

    // Reloads the list. A call while a request is in flight runs one more
    // request after it, instead of a concurrent one.
    vm.refresh = function() {
        if (refreshing) {
            refreshAgain = true;
            return refreshing;
        }

        cancelPoll();
        refreshing = (async () => {
            try {
                do {
                    refreshAgain = false;
                    await loadOnce();
                } while (refreshAgain && !destroyed);
            } finally {
                refreshing = null;
            }
            schedulePoll();
            $scope.$applyAsync();
        })();
        return refreshing;
    };

    vm.hasAnalysisTabs = function() {
        return vm.analyses.length > 0;
    };

    vm.hasMaterialTab = function() {
        return Number(vm.materialCount) > 0;
    };

    vm.hasRightsTab = function() {
        return vm.showRights === true;
    };

    vm.hasTabBar = function() {
        return vm.hasAnalysisTabs() || vm.hasMaterialTab() || vm.hasRightsTab()
            || vm.canAddAnalysis();
    };

    function chosenServiceIds() {
        return vm.analyses.map(analysis => analysis.serviceId);
    }

    // "Add analysis": for the creator, once the list is known, when a usable
    // case-scoped service is not chosen yet.
    vm.canAddAnalysis = function() {
        return vm.canAddAnalyses === true
            && vm.listLoaded
            && !vm.listFailed
            && caseAnalysisServicesToAdd(vm.caseServices, chosenServiceIds()).length > 0;
    };

    // Tabs in display order: null stands for the case text.
    function tabKeys() {
        return [
            null,
            ...(vm.hasMaterialTab() ? [CASE_VIEW_TAB_MATERIAL] : []),
            ...vm.analyses.map(analysis => analysis.serviceId),
            ...(vm.hasRightsTab() ? [CASE_VIEW_TAB_RIGHTS] : []),
        ];
    }

    vm.isActive = function(serviceId) {
        return vm.activeServiceId === (serviceId ?? null);
    };

    vm.selectTab = function(serviceId) {
        vm.activeServiceId = serviceId ?? null;
    };

    function domIdPart(serviceId) {
        if (!serviceId) {
            return "case-text";
        }
        if (FIXED_TAB_DOM_IDS[serviceId]) {
            return FIXED_TAB_DOM_IDS[serviceId];
        }
        return `analysis-${String(serviceId).replace(/[^A-Za-z0-9_-]/g, "_")}`;
    }

    vm.tabId = function(serviceId) {
        return `${idPrefix}-tab-${domIdPart(serviceId)}`;
    };

    vm.panelId = function(serviceId) {
        return `${idPrefix}-panel-${domIdPart(serviceId)}`;
    };

    vm.tabTitle = function(analysis) {
        return caseAnalysisTabTitle(analysis, LanguageCatalogService.getCurrentUiLanguageCode());
    };

    vm.indicator = function(analysis) {
        return caseAnalysisIndicator(analysis);
    };

    // Arrow keys, Home and End move between tabs and open them (WAI-ARIA tabs
    // with automatic activation); only the active tab is in the tab order.
    vm.onTabKeydown = function(event, serviceId) {
        const keys = tabKeys();
        const index = keys.indexOf(serviceId ?? null);
        const lastIndex = keys.length - 1;
        const targets = {
            ArrowRight: index >= lastIndex ? 0 : index + 1,
            ArrowLeft:  index <= 0 ? lastIndex : index - 1,
            Home:       0,
            End:        lastIndex,
        };

        if (!Object.hasOwn(targets, event.key)) {
            return;
        }

        event.preventDefault();
        const nextKey = keys[targets[event.key]];
        vm.selectTab(nextKey);
        $timeout(() => {
            const tab = $element[0].querySelector(`#${vm.tabId(nextKey)}`);
            tab?.focus();
        });
    };

    /**
     * Opens the "Add analysis" dialog, once at a time. The list it answers
     * replaces this one, with the new analyses in their processing state,
     * and the first of them is opened.
     */
    vm.addAnalyses = async function() {
        if (vm.adding || !vm.canAddAnalysis()) {
            return;
        }
        const caseId = loadedCaseId;
        const previousIds = new Set(chosenServiceIds());
        vm.adding = true;
        try {
            const analyses = await CaseAnalysisAddDialogService.open({
                caseId,
                chosenServiceIds: [...previousIds],
            });
            if (destroyed || caseId !== loadedCaseId || !Array.isArray(analyses)) {
                return;
            }
            localRevision += 1;
            vm.analyses = analyses;
            const added = analyses.find(analysis => !previousIds.has(analysis.serviceId));
            if (added) {
                vm.selectTab(added.serviceId);
            }
            schedulePoll();
        } catch (error) {
            console.error("[caseViewTabs] Could not add the case analyses.", error);
        } finally {
            vm.adding = false;
            $scope.$applyAsync();
        }
    };

    // "Remove analysis": for the creator, as "Add analysis" is.
    vm.canRemoveAnalyses = function() {
        return vm.canAddAnalyses === true;
    };

    /**
     * Asks to remove an analysis (#1040), once at a time; the dialog sends
     * the request. Once it is removed, its tab goes away, the case text
     * opens and `onAnalysisRemoved({ serviceId, title })` is called. Resolves
     * with whether it was removed.
     */
    vm.removeAnalysis = async function(serviceId) {
        const analysis = vm.analyses.find(entry => entry.serviceId === serviceId);
        if (vm.removing || !vm.canRemoveAnalyses() || !analysis) {
            return false;
        }
        const caseId = loadedCaseId;
        const title = vm.tabTitle(analysis);
        vm.removing = true;
        try {
            const removed = await CaseAnalysisRemoveDialogService.open({
                caseId,
                serviceId,
                title,
                inFlight: hasCaseAnalysisGenerationRunning(analysis),
            });
            if (!removed || destroyed || caseId !== loadedCaseId) {
                return removed === true;
            }
            // A list requested before the removal must not bring the tab back.
            localRevision += 1;
            vm.analyses = vm.analyses.filter(entry => entry.serviceId !== serviceId);
            vm.selectTab(null);
            schedulePoll();
            vm.onAnalysisRemoved?.({ serviceId, title });
            return true;
        } catch (error) {
            console.error("[caseViewTabs] Could not remove the case analysis.", error);
            return false;
        } finally {
            vm.removing = false;
            $scope.$applyAsync();
        }
    };

    vm.handleAnalysisChanged = function(analysis) {
        localRevision += 1;
        vm.analyses = mergeCaseAnalysis(vm.analyses, analysis);
        schedulePoll();
    };

    /**
     * Requests a new generation for an analysis and applies its result here,
     * so it is kept and followed even when the panel that asked for it was
     * closed meanwhile. Resolves with the outcome ("accepted", "busy" or
     * "disabled") for the panel's notice; rejects when the request fails.
     */
    vm.generateAnalysis = async function(serviceId) {
        const caseId = loadedCaseId;
        const { outcome, analysis } = await CaseAnalysesService
            .generateAnalysis(caseId, serviceId);
        if (destroyed || caseId !== loadedCaseId) {
            return outcome;
        }

        if (outcome === "accepted") {
            vm.handleAnalysisChanged(analysis);
        } else {
            // A generation in flight or a disabled service: show the current state.
            vm.refresh();
        }
        $scope.$applyAsync();
        return outcome;
    };
}

export default {
    bindings: {
        caseItem:          "<",
        // The number of videos and documents; the "Material" tab shows when
        // there is any.
        materialCount:     "<?",
        showRights:        "<?",
        // Whether the teacher is the case's creator, who can add and remove
        // analyses.
        canAddAnalyses:    "<?",
        // Called with `serviceId` and `title` once an analysis was removed.
        onAnalysisRemoved: "&?",
    },
    transclude: {
        material: "?caseViewMaterial",
        rights:   "?caseViewRights",
    },
    controller: [
        "$scope", "$element", "$timeout", "CaseAnalysesService", "LanguageCatalogService",
        "ExternalServicesCatalogService", "CaseAnalysisAddDialogService",
        "CaseAnalysisRemoveDialogService", CaseViewTabsController,
    ],
    templateUrl: "/assets/static/views/teacher/fragments/case-view-tabs.template.html",
};
