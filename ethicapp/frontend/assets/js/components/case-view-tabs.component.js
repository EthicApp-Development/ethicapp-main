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

function CaseViewTabsController($scope, $element, $interval, $timeout, CaseAnalysesService,
    LanguageCatalogService) {
    const vm = this;
    instanceCount += 1;
    const idPrefix = `case-view-tabs-${instanceCount}`;

    let destroyed = false;
    let loadedCaseId = null;
    let poll = null;
    let listSequence = 0;

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
        stopPolling();
    };

    function startPolling() {
        if (!poll) {
            poll = $interval(() => vm.refresh(), CASE_ANALYSES_POLL_INTERVAL_MS);
        }
    }

    function stopPolling() {
        if (poll) {
            $interval.cancel(poll);
            poll = null;
        }
    }

    function syncPolling() {
        if (!destroyed && vm.analyses.some(isCaseAnalysisInFlight)) {
            startPolling();
            return;
        }
        stopPolling();
    }

    vm.refresh = async function() {
        const caseId = loadedCaseId;
        if (!caseId) {
            stopPolling();
            return;
        }

        const sequence = ++listSequence;
        try {
            const analyses = await CaseAnalysesService.listAnalyses(caseId);
            if (destroyed || sequence !== listSequence || caseId !== loadedCaseId) {
                return;
            }
            vm.analyses = analyses;
            vm.listFailed = false;
            if (vm.activeServiceId && !analyses.some(a => a.serviceId === vm.activeServiceId)) {
                vm.activeServiceId = null;
            }
        } catch (error) {
            if (destroyed || sequence !== listSequence) {
                return;
            }
            console.error("[caseViewTabs] Could not load the case analyses.", error);
            vm.listFailed = true;
        }

        syncPolling();
        $scope.$applyAsync();
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
        vm.analyses = mergeCaseAnalysis(vm.analyses, analysis);
        syncPolling();
    };
}

export default {
    bindings: {
        caseItem: "<",
    },
    transclude: true,
    controller: [
        "$scope", "$element", "$interval", "$timeout", "CaseAnalysesService",
        "LanguageCatalogService", CaseViewTabsController,
    ],
    templateUrl: "/assets/static/views/teacher/fragments/case-view-tabs.template.html",
};
