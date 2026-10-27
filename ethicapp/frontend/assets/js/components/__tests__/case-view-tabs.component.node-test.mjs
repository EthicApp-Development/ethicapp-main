import assert from "node:assert/strict";
import { describe, it } from "node:test";

import caseAnalysisPanelComponent from "../case-analysis-panel.component.js";
import caseViewTabsComponent from "../case-view-tabs.component.js";

// The controllers are the last entry of the components' annotated arrays.
const CaseViewTabsController = caseViewTabsComponent.controller.at(-1);
const CaseAnalysisPanelController = caseAnalysisPanelComponent.controller.at(-1);

const flush = () => new Promise(resolve => setImmediate(resolve));

function fakeInterval() {
    const timers = new Set();
    const $interval = (callback) => {
        const timer = { callback };
        timers.add(timer);
        return timer;
    };
    $interval.cancel = timer => timers.delete(timer);
    return { $interval, timers };
}

function analysis(overrides = {}) {
    return {
        serviceId: "mock-case-analysis",
        status:    "ready",
        stale:     false,
        updatedAt: "2026-10-27T10:00:00.000Z",
        ui:        { component: "mock-case-analysis", translations: null },
        usable:    true,
        ...overrides,
    };
}

function createTabs(listResults) {
    const results = [...listResults];
    const calls = [];
    const { $interval, timers } = fakeInterval();
    const service = {
        listAnalyses: async (caseId) => {
            calls.push(caseId);
            const next = results.length > 1 ? results.shift() : results[0];
            if (next instanceof Error) {
                throw next;
            }
            return next;
        },
    };
    const $scope = { $applyAsync: () => {} };
    const $element = [{ querySelector: () => null }];
    const $timeout = callback => callback();
    const languageCatalog = { getCurrentUiLanguageCode: () => "es_CL" };

    const vm = new CaseViewTabsController($scope, $element, $interval, $timeout, service,
        languageCatalog);
    return { vm, calls, timers };
}

function openCase(vm, caseId = 7) {
    vm.caseItem = { id: caseId };
    vm.$onChanges({ caseItem: { currentValue: vm.caseItem } });
}

describe("caseViewTabs", () => {
    it("shows no tab bar for a case without analyses", async () => {
        const { vm, calls, timers } = createTabs([[]]);

        openCase(vm);
        await flush();

        assert.deepEqual(calls, [7]);
        assert.equal(vm.hasAnalysisTabs(), false);
        assert.equal(vm.isActive(null), true);
        assert.equal(timers.size, 0);
    });

    it("opens on the case text and polls only while a generation is in flight", async () => {
        const { vm, timers } = createTabs([
            [analysis({ status: "processing" })],
            [analysis()],
        ]);

        openCase(vm);
        await flush();

        assert.equal(vm.hasAnalysisTabs(), true);
        assert.equal(vm.isActive(null), true);
        assert.equal(timers.size, 1);

        [...timers][0].callback();
        await flush();

        assert.equal(vm.analyses[0].status, "ready");
        assert.equal(timers.size, 0);
    });

    it("does not poll a stale generation", async () => {
        const { vm, timers } = createTabs([[analysis({ status: "processing", stale: true })]]);

        openCase(vm);
        await flush();

        assert.equal(timers.size, 0);
    });

    it("returns to the case text when the open analysis disappears", async () => {
        const { vm } = createTabs([[analysis()], []]);

        openCase(vm);
        await flush();
        vm.selectTab("mock-case-analysis");
        assert.equal(vm.isActive("mock-case-analysis"), true);

        await vm.refresh();

        assert.equal(vm.isActive(null), true);
    });

    it("flags a failed listing and keeps the case text", async () => {
        const { vm } = createTabs([new Error("network")]);
        const originalError = console.error;
        console.error = () => {};
        try {
            openCase(vm);
            await flush();
        } finally {
            console.error = originalError;
        }

        assert.equal(vm.listFailed, true);
        assert.equal(vm.hasAnalysisTabs(), false);
        assert.equal(vm.isActive(null), true);
    });

    it("merges an accepted generation and starts polling", async () => {
        const { vm, timers } = createTabs([[analysis()]]);

        openCase(vm);
        await flush();
        assert.equal(timers.size, 0);

        vm.handleAnalysisChanged({
            serviceId: "mock-case-analysis",
            status:    "requested",
            stale:     false,
        });

        assert.equal(vm.analyses[0].status, "requested");
        assert.equal(vm.analyses[0].usable, true);
        assert.equal(timers.size, 1);

        vm.$onDestroy();
        assert.equal(timers.size, 0);
    });

    it("moves between tabs with the arrow keys, Home and End", async () => {
        const { vm } = createTabs([[analysis(), analysis({ serviceId: "case-analyst" })]]);
        openCase(vm);
        await flush();

        const key = name => ({ key: name, preventDefault: () => {} });

        vm.onTabKeydown(key("ArrowRight"), null);
        assert.equal(vm.isActive("mock-case-analysis"), true);
        vm.onTabKeydown(key("End"), "mock-case-analysis");
        assert.equal(vm.isActive("case-analyst"), true);
        vm.onTabKeydown(key("ArrowRight"), "case-analyst");
        assert.equal(vm.isActive(null), true);
        vm.onTabKeydown(key("ArrowLeft"), null);
        assert.equal(vm.isActive("case-analyst"), true);
        vm.onTabKeydown(key("Home"), "case-analyst");
        assert.equal(vm.isActive(null), true);
        vm.onTabKeydown(key("Enter"), null);
        assert.equal(vm.isActive(null), true);
    });

    it("builds distinct DOM ids for the case text and each analysis", () => {
        const { vm } = createTabs([[]]);
        assert.notEqual(vm.tabId(null), vm.tabId("case-text"));
        assert.match(vm.panelId("svc a/b"), /-panel-analysis-svc_a_b$/);
    });
});

function createPanel({ detail, generate } = {}) {
    const calls = { get: 0, generate: 0, changed: [], refresh: 0 };
    const service = {
        getAnalysis: async () => {
            calls.get += 1;
            return detail;
        },
        generateAnalysis: async () => {
            calls.generate += 1;
            if (generate instanceof Error) {
                throw generate;
            }
            return generate;
        },
    };
    const vm = new CaseAnalysisPanelController({ $applyAsync: () => {} }, service);
    vm.caseItem = { id: 7 };
    vm.onAnalysisChanged = ({ analysis: changed }) => calls.changed.push(changed);
    vm.onRefreshRequested = () => {
        calls.refresh += 1;
    };
    return { vm, calls };
}

function setSummary(vm, summary) {
    vm.summary = summary;
    vm.$onChanges({ summary: { currentValue: summary } });
}

describe("caseAnalysisPanel", () => {
    it("loads the document when opened and only again when the status changes", async () => {
        const summary = analysis();
        const { vm, calls } = createPanel({ detail: { ...summary, document: { wordCount: 3 } } });

        setSummary(vm, summary);
        await flush();
        assert.equal(calls.get, 1);
        assert.equal(vm.hasDocument(), true);
        assert.equal(vm.hasRegisteredComponent(), true);

        // Polling hands the panel a new object with the same state.
        setSummary(vm, { ...summary });
        await flush();
        assert.equal(calls.get, 1);

        setSummary(vm, { ...summary, status: "requested", updatedAt: "later" });
        await flush();
        assert.equal(calls.get, 2);
    });

    it("uses the generic view for services without a registered component", async () => {
        const summary = analysis({ serviceId: "case-analyst", ui: { component: null } });
        const { vm } = createPanel({ detail: { ...summary, document: { score: 4 } } });

        setSummary(vm, summary);
        await flush();

        assert.equal(vm.hasRegisteredComponent(), false);
        assert.deepEqual(vm.genericFields, [{ key: "score", text: "4", structured: false }]);
    });

    it("offers a new generation only when it can be accepted", () => {
        const { vm } = createPanel();
        vm.summary = analysis({ status: "processing" });
        assert.equal(vm.canGenerate(), false);
        vm.summary = analysis({ status: "processing", stale: true });
        assert.equal(vm.canGenerate(), true);
        vm.summary = analysis({ status: "failed" });
        assert.equal(vm.canGenerate(), true);
        vm.summary = analysis({ status: "failed", usable: false });
        assert.equal(vm.canGenerate(), false);
    });

    it("hands an accepted generation to the tabs", async () => {
        const reserved = { serviceId: "mock-case-analysis", status: "requested" };
        const generate = { outcome: "accepted", analysis: reserved };
        const { vm, calls } = createPanel({ generate });
        vm.summary = analysis({ status: "failed" });

        vm.askToGenerate();
        assert.equal(vm.confirmingGenerate, true);
        await vm.confirmGenerate();

        assert.equal(calls.generate, 1);
        assert.deepEqual(calls.changed, [reserved]);
        assert.equal(vm.confirmingGenerate, false);
        assert.equal(vm.generating, false);
        assert.equal(vm.notice, null);
    });

    it("explains a busy (409) or disabled (503) service and refreshes the tabs", async () => {
        for (const [outcome, key] of [
            ["busy", "case_analysis_generate_busy"],
            ["disabled", "case_analysis_generate_disabled"],
        ]) {
            const { vm, calls } = createPanel({ generate: { outcome, analysis: null } });
            vm.summary = analysis({ status: "failed" });

            await vm.confirmGenerate();

            assert.equal(vm.notice.key, key);
            assert.equal(calls.refresh, 1);
            assert.deepEqual(calls.changed, []);
        }
    });

    it("reports a failed request", async () => {
        const { vm } = createPanel({ generate: new Error("network") });
        vm.summary = analysis({ status: "failed" });
        const originalError = console.error;
        console.error = () => {};
        try {
            await vm.confirmGenerate();
        } finally {
            console.error = originalError;
        }

        assert.equal(vm.notice.key, "case_analysis_generate_failed");
        assert.equal(vm.generating, false);
    });
});
