import assert from "node:assert/strict";
import { describe, it } from "node:test";

import caseAnalysisPanelComponent from "../case-analysis-panel.component.js";
import caseViewTabsComponent from "../case-view-tabs.component.js";

// The controllers are the last entry of the components' annotated arrays.
const CaseViewTabsController = caseViewTabsComponent.controller.at(-1);
const CaseAnalysisPanelController = caseAnalysisPanelComponent.controller.at(-1);

const flush = () => new Promise(resolve => setImmediate(resolve));

// $timeout with a delay is a poll and is kept until the test fires it; without
// a delay (moving the focus) it runs at once.
function fakeTimeout() {
    const timers = new Set();
    const $timeout = (callback, delay) => {
        if (delay === undefined) {
            callback();
            return null;
        }
        const timer = { callback, delay };
        timers.add(timer);
        return timer;
    };
    $timeout.cancel = timer => timers.delete(timer);
    const fire = () => {
        const [timer] = timers;
        timers.delete(timer);
        timer.callback();
    };
    return { $timeout, timers, fire };
}

function deferred() {
    let resolve;
    const promise = new Promise((res) => {
        resolve = res;
    });
    return { promise, resolve };
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

// `listResults` are returned in order (the last one repeats); a deferred()
// entry keeps its request pending until the test resolves it.
function createTabs(listResults, { generate } = {}) {
    const results = [...listResults];
    const calls = [];
    const generateCalls = [];
    const { $timeout, timers, fire } = fakeTimeout();
    const service = {
        listAnalyses: async (caseId) => {
            calls.push(caseId);
            const next = results.length > 1 ? results.shift() : results[0];
            if (next instanceof Error) {
                throw next;
            }
            return next?.promise ?? next;
        },
        generateAnalysis: async (caseId, serviceId) => {
            generateCalls.push({ caseId, serviceId });
            return generate?.promise ?? generate;
        },
    };
    const $scope = { $applyAsync: () => {} };
    const $element = [{ querySelector: () => null }];
    const languageCatalog = { getCurrentUiLanguageCode: () => "es_CL" };

    const vm = new CaseViewTabsController($scope, $element, $timeout, service, languageCatalog);
    return { vm, calls, generateCalls, timers, fire };
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
        const { vm, timers, fire } = createTabs([
            [analysis({ status: "processing" })],
            [analysis()],
        ]);

        openCase(vm);
        await flush();

        assert.equal(vm.hasAnalysisTabs(), true);
        assert.equal(vm.isActive(null), true);
        assert.equal(timers.size, 1);
        assert.equal([...timers][0].delay, 5000);

        fire();
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

    it("applies a list response slower than the poll interval and then stops", async () => {
        const slow = deferred();
        const { vm, calls, timers, fire } = createTabs([
            [analysis({ status: "processing" })],
            slow,
            [analysis()],
        ]);

        openCase(vm);
        await flush();
        fire();
        await flush();

        // The request is pending: no further poll is scheduled meanwhile, and
        // a refresh asked for now waits for it instead of overlapping.
        assert.equal(calls.length, 2);
        assert.equal(timers.size, 0);
        const queued = vm.refresh();
        assert.equal(calls.length, 2);

        slow.resolve([analysis()]);
        await queued;

        assert.equal(calls.length, 3);
        assert.equal(vm.analyses[0].status, "ready");
        assert.equal(timers.size, 0);
    });

    it("ignores a slow list response that predates an accepted generation", async () => {
        const slow = deferred();
        const { vm, calls, timers } = createTabs([
            [analysis()],
            slow,
            [analysis({ status: "requested" })],
        ]);

        openCase(vm);
        await flush();
        const pending = vm.refresh();
        await flush();

        vm.handleAnalysisChanged({ serviceId: "mock-case-analysis", status: "requested" });
        slow.resolve([analysis()]);
        await pending;

        assert.equal(calls.length, 3);
        assert.equal(vm.analyses[0].status, "requested");
        assert.equal(timers.size, 1);
    });

    it("drops list responses after the view is destroyed", async () => {
        const slow = deferred();
        const { vm, timers } = createTabs([slow]);

        openCase(vm);
        await flush();
        vm.$onDestroy();
        slow.resolve([analysis({ status: "processing" })]);
        await flush();

        assert.deepEqual(vm.analyses, []);
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
    const calls = { get: 0, generate: [] };
    const service = {
        getAnalysis: async () => {
            calls.get += 1;
            return detail;
        },
    };
    const vm = new CaseAnalysisPanelController({ $applyAsync: () => {} }, service);
    vm.caseItem = { id: 7 };
    vm.onAnalysisChanged = () => {};
    vm.onGenerate = async ({ serviceId }) => {
        calls.generate.push(serviceId);
        if (generate instanceof Error) {
            throw generate;
        }
        return generate;
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

    it("asks the tabs to generate after the confirmation", async () => {
        const { vm, calls } = createPanel({ generate: "accepted" });
        vm.summary = analysis({ status: "failed" });

        vm.askToGenerate();
        assert.equal(vm.confirmingGenerate, true);
        await vm.confirmGenerate();

        assert.deepEqual(calls.generate, ["mock-case-analysis"]);
        assert.equal(vm.confirmingGenerate, false);
        assert.equal(vm.generating, false);
        assert.equal(vm.notice, null);
    });

    it("explains a busy (409) or disabled (503) service", async () => {
        for (const [outcome, key] of [
            ["busy", "case_analysis_generate_busy"],
            ["disabled", "case_analysis_generate_disabled"],
        ]) {
            const { vm } = createPanel({ generate: outcome });
            vm.summary = analysis({ status: "failed" });

            await vm.confirmGenerate();

            assert.equal(vm.notice.key, key);
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

// The panel wired to the tabs as the template does (on-generate).
function openPanel(tabs) {
    const { vm } = createPanel();
    vm.onGenerate = ({ serviceId }) => tabs.generateAnalysis(serviceId);
    vm.onAnalysisChanged = ({ analysis: changed }) => tabs.handleAnalysisChanged(changed);
    setSummary(vm, tabs.analyses[0]);
    return vm;
}

describe("caseViewTabs with caseAnalysisPanel", () => {
    it("follows an accepted generation after its panel was closed", async () => {
        const request = deferred();
        const { vm: tabs, generateCalls, timers } = createTabs([[analysis()]], {
            generate: request,
        });
        openCase(tabs);
        await flush();
        tabs.selectTab("mock-case-analysis");

        const panel = openPanel(tabs);
        const generating = panel.confirmGenerate();

        // The teacher goes back to the case text before the POST answers.
        tabs.selectTab(null);
        panel.$onDestroy();
        request.resolve({
            outcome:  "accepted",
            analysis: { serviceId: "mock-case-analysis", status: "requested", stale: false },
        });
        await generating;
        await flush();

        assert.deepEqual(generateCalls, [{ caseId: 7, serviceId: "mock-case-analysis" }]);
        assert.equal(tabs.analyses[0].status, "requested");
        assert.equal(timers.size, 1);

        // Opening the tab again shows the generation and offers no other one.
        tabs.selectTab("mock-case-analysis");
        const reopened = openPanel(tabs);
        assert.equal(reopened.state(), "pending");
        assert.equal(reopened.canGenerate(), false);
    });

    it("refreshes the list when the service answers busy", async () => {
        const { vm: tabs, calls } = createTabs([
            [analysis({ status: "failed" })],
            [analysis({ status: "processing" })],
        ], { generate: { outcome: "busy", analysis: null } });
        openCase(tabs);
        await flush();

        const outcome = await tabs.generateAnalysis("mock-case-analysis");
        await flush();

        assert.equal(outcome, "busy");
        assert.equal(calls.length, 2);
        assert.equal(tabs.analyses[0].status, "processing");
    });
});
