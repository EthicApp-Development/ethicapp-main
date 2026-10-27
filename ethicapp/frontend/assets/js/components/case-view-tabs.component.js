// Tabs of the teacher case view (#651, epic #647): the case text first and by
// default (the transcluded content), then one tab per analysis chosen for the
// case. A case without analyses shows no tab bar, as before. Analysis tabs
// render their panel only while open, so opening a case loads the case text
// and the analysis list (statuses, without documents) only. The list is polled
// while a generation is in flight.

import {
    CASE_ANALYSES_POLL_INTERVAL_MS,
    caseAnalysisIndicator,
    caseAnalysisTabTitle,
    isCaseAnalysisInFlight,
    mergeCaseAnalysis,
} from "../helpers/case-analyses.js";

let instanceCount = 0;

function CaseViewTabsController($scope, $element, $timeout, CaseAnalysesService,
    LanguageCatalogService) {
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

    vm.$onChanges = function(changes) {
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
        vm.refresh();
    };

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
            if (vm.activeServiceId && !analyses.some(a => a.serviceId === vm.activeServiceId)) {
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

    // Tabs in display order: null stands for the case text.
    function tabKeys() {
        return [null, ...vm.analyses.map(analysis => analysis.serviceId)];
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
        caseItem: "<",
    },
    transclude: true,
    controller: [
        "$scope", "$element", "$timeout", "CaseAnalysesService", "LanguageCatalogService",
        CaseViewTabsController,
    ],
    templateUrl: "/assets/static/views/teacher/fragments/case-view-tabs.template.html",
};
