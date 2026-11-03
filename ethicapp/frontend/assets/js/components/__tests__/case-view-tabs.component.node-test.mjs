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
// `caseServices` are the usable case services the catalog lists; `dialog`
// answers the "Add analysis" dialog (#1039), or is a deferred() entry;
// `removeDialog` answers the "Remove analysis" dialog (#1040) likewise, or
// is an Error it rejects with.
function createTabs(listResults, {
    generate,
    caseServices = [],
    dialog = null,
    removeDialog = false,
} = {}) {
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

    const serviceRequests = [];
    const servicesCatalog = {
        getServices: async (options) => {
            serviceRequests.push(options);
            return caseServices;
        },
    };
    const dialogCalls = [];
    const addDialog = {
        open: async (options) => {
            dialogCalls.push(options);
            return dialog?.promise ?? dialog;
        },
    };

    const removeCalls = [];
    const removeDialogService = {
        open: async (options) => {
            removeCalls.push(options);
            if (removeDialog instanceof Error) {
                throw removeDialog;
            }
            return removeDialog?.promise ?? removeDialog;
        },
    };

    const vm = new CaseViewTabsController($scope, $element, $timeout, service, languageCatalog,
        servicesCatalog, addDialog, removeDialogService);
    return { vm, calls, generateCalls, timers, fire, serviceRequests, dialogCalls, removeCalls };
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

describe("caseViewTabs with material and rights (#1018)", () => {
    function openWithFixedTabs(vm, { materialCount = 2, showRights = true } = {}) {
        vm.materialCount = materialCount;
        vm.showRights = showRights;
        openCase(vm);
    }

    it("orders the case text, the material, the analyses and the rights", async () => {
        const { vm } = createTabs([[analysis()]]);
        openWithFixedTabs(vm);
        await flush();

        assert.equal(vm.hasTabBar(), true);
        const key = name => ({ key: name, preventDefault: () => {} });
        vm.onTabKeydown(key("ArrowRight"), null);
        assert.equal(vm.isActive(vm.materialTab), true);
        vm.onTabKeydown(key("ArrowRight"), vm.materialTab);
        assert.equal(vm.isActive("mock-case-analysis"), true);
        vm.onTabKeydown(key("End"), "mock-case-analysis");
        assert.equal(vm.isActive(vm.rightsTab), true);
        vm.onTabKeydown(key("ArrowRight"), vm.rightsTab);
        assert.equal(vm.isActive(null), true);
    });

    it("shows the tab bar for the rights alone, and no material tab without material", async () => {
        const { vm } = createTabs([[]]);
        openWithFixedTabs(vm, { materialCount: 0 });
        await flush();

        assert.equal(vm.hasAnalysisTabs(), false);
        assert.equal(vm.hasMaterialTab(), false);
        assert.equal(vm.hasTabBar(), true);
        const key = name => ({ key: name, preventDefault: () => {} });
        vm.onTabKeydown(key("ArrowRight"), null);
        assert.equal(vm.isActive(vm.rightsTab), true);
    });

    it("keeps a fixed tab open when the analyses reload, and leaves it when it goes", async () => {
        const { vm } = createTabs([[analysis()]]);
        openWithFixedTabs(vm);
        await flush();

        vm.selectTab(vm.materialTab);
        await vm.refresh();
        assert.equal(vm.isActive(vm.materialTab), true);

        vm.materialCount = 0;
        vm.$onChanges({ materialCount: { currentValue: 0 } });
        assert.equal(vm.isActive(null), true);
    });

    it("builds DOM ids for the fixed tabs apart from the analyses'", () => {
        const { vm } = createTabs([[]]);
        assert.match(vm.tabId(vm.materialTab), /-tab-material$/);
        assert.match(vm.panelId(vm.rightsTab), /-panel-rights$/);
        assert.notEqual(vm.tabId(vm.rightsTab), vm.tabId("rights"));
    });
});

describe("caseViewTabs: Add analysis (#1039)", () => {
    const SERVICES = [{ id: "mock-case-analysis" }, { id: "case-evaluation" }];

    // Opens the case as its creator would.
    async function openAsCreator(vm, { canAddAnalyses = true } = {}) {
        vm.caseItem = { id: 7 };
        vm.canAddAnalyses = canAddAnalyses;
        vm.showRights = true;
        vm.$onChanges({
            caseItem:       { currentValue: vm.caseItem },
            canAddAnalyses: { currentValue: canAddAnalyses },
        });
        await flush();
    }

    it("offers it to the creator of a case without analyses", async () => {
        const { vm, serviceRequests } = createTabs([[]], { caseServices: SERVICES });

        await openAsCreator(vm);

        assert.deepEqual(serviceRequests, [{ scopes: ["case"] }]);
        assert.equal(vm.canAddAnalysis(), true);
        assert.equal(vm.hasTabBar(), true);
    });

    it("offers it while a service is not chosen, and not once all are", async () => {
        const some = createTabs([[analysis()]], { caseServices: SERVICES });
        await openAsCreator(some.vm);
        assert.equal(some.vm.canAddAnalysis(), true);

        const all = createTabs([[analysis(), analysis({ serviceId: "case-evaluation" })]], {
            caseServices: SERVICES,
        });
        await openAsCreator(all.vm);
        assert.equal(all.vm.canAddAnalysis(), false);
    });

    it("is not offered to other teachers, without services, or before the list loads", async () => {
        const other = createTabs([[]], { caseServices: SERVICES });
        await openAsCreator(other.vm, { canAddAnalyses: false });
        assert.equal(other.vm.canAddAnalysis(), false);
        assert.deepEqual(other.serviceRequests, [], "the services are not asked for");

        const none = createTabs([[]], { caseServices: [] });
        await openAsCreator(none.vm);
        assert.equal(none.vm.canAddAnalysis(), false);

        const slow = deferred();
        const loading = createTabs([slow], { caseServices: SERVICES });
        await openAsCreator(loading.vm);
        assert.equal(loading.vm.canAddAnalysis(), false);
        slow.resolve([]);
        await flush();
        assert.equal(loading.vm.canAddAnalysis(), true);

        const failed = createTabs([new Error("offline")], { caseServices: SERVICES });
        const originalError = console.error;
        console.error = () => {};
        try {
            await openAsCreator(failed.vm);
        } finally {
            console.error = originalError;
        }
        assert.equal(failed.vm.canAddAnalysis(), false);
    });

    it("shows the new analyses in their processing state, opens the first and polls", async () => {
        const added = [analysis(), analysis({ serviceId: "case-evaluation", status: "requested" })];
        const { vm, dialogCalls, timers } = createTabs([[analysis()]], {
            caseServices: SERVICES,
            dialog:       added,
        });
        await openAsCreator(vm);

        await vm.addAnalyses();

        assert.deepEqual(dialogCalls, [{ caseId: 7, chosenServiceIds: ["mock-case-analysis"] }]);
        assert.deepEqual(vm.analyses, added);
        assert.equal(vm.isActive("case-evaluation"), true);
        assert.equal(timers.size, 1, "the new analysis is polled");
        assert.equal(vm.canAddAnalysis(), false, "nothing is left to add");
        assert.equal(vm.adding, false);
    });

    it("opens one dialog for two quick clicks", async () => {
        const pending = deferred();
        const { vm, dialogCalls } = createTabs([[]], { caseServices: SERVICES, dialog: pending });
        await openAsCreator(vm);

        const first = vm.addAnalyses();
        const second = vm.addAnalyses();
        assert.equal(vm.adding, true);
        pending.resolve(null);
        await Promise.all([first, second]);

        assert.equal(dialogCalls.length, 1);
        assert.equal(vm.adding, false);
    });

    it("keeps the list as it was when the dialog is cancelled", async () => {
        const { vm, timers } = createTabs([[analysis()]], { caseServices: SERVICES, dialog: null });
        await openAsCreator(vm);
        const before = vm.analyses;

        await vm.addAnalyses();

        assert.equal(vm.analyses, before);
        assert.equal(vm.isActive(null), true);
        assert.equal(timers.size, 0);
    });

    it("ignores a list loaded before the analyses were added", async () => {
        const slow = deferred();
        const added = [analysis({ status: "requested" })];
        const { vm, calls } = createTabs([[], slow, added], {
            caseServices: SERVICES,
            dialog:       added,
        });
        await openAsCreator(vm);

        const refresh = vm.refresh();
        await vm.addAnalyses();
        slow.resolve([]);
        await refresh;

        assert.deepEqual(vm.analyses, added);
        assert.equal(calls.length, 3, "the stale list is asked for again");
    });
});

describe("caseViewTabs: Remove analysis (#1040)", () => {
    const SERVICES = [{ id: "mock-case-analysis" }, { id: "case-evaluation" }];
    const EVALUATION = analysis({ serviceId: "case-evaluation" });

    async function openAsCreator(vm, { canAddAnalyses = true } = {}) {
        vm.caseItem = { id: 7 };
        vm.canAddAnalyses = canAddAnalyses;
        vm.$onChanges({
            caseItem:       { currentValue: vm.caseItem },
            canAddAnalyses: { currentValue: canAddAnalyses },
        });
        await flush();
    }

    it("removes the tab once confirmed, opens the case text and offers it again", async () => {
        const { vm, removeCalls } = createTabs([[analysis(), EVALUATION]], {
            caseServices: SERVICES,
            removeDialog: true,
        });
        const removedNotices = [];
        vm.onAnalysisRemoved = notice => removedNotices.push(notice);
        await openAsCreator(vm);
        vm.selectTab("case-evaluation");
        assert.equal(vm.canRemoveAnalyses(), true);
        assert.equal(vm.canAddAnalysis(), false, "both services are chosen");

        assert.equal(await vm.removeAnalysis("case-evaluation"), true);

        assert.deepEqual(removeCalls, [{
            caseId:    7,
            serviceId: "case-evaluation",
            title:     "case-evaluation",
            inFlight:  false,
        }]);
        assert.deepEqual(vm.analyses.map(entry => entry.serviceId), ["mock-case-analysis"]);
        assert.equal(vm.isActive(null), true);
        assert.deepEqual(removedNotices, [
            { serviceId: "case-evaluation", title: "case-evaluation" },
        ]);
        assert.equal(vm.canAddAnalysis(), true, "the removed service is offered again");
        assert.equal(vm.removing, false);
    });

    it("says when a generation is in flight, and stops polling once none is left", async () => {
        const { vm, removeCalls, timers } = createTabs([[analysis({ status: "processing" })]], {
            removeDialog: true,
        });
        await openAsCreator(vm);
        assert.equal(timers.size, 1);

        await vm.removeAnalysis("mock-case-analysis");

        assert.equal(removeCalls[0].inFlight, true);
        assert.equal(vm.hasAnalysisTabs(), false);
        assert.equal(timers.size, 0);
    });

    it("keeps the tab when the dialog is cancelled", async () => {
        const { vm, removeCalls } = createTabs([[analysis()]], { removeDialog: false });
        const removedNotices = [];
        vm.onAnalysisRemoved = notice => removedNotices.push(notice);
        await openAsCreator(vm);
        vm.selectTab("mock-case-analysis");

        assert.equal(await vm.removeAnalysis("mock-case-analysis"), false);

        assert.equal(removeCalls.length, 1);
        assert.equal(vm.analyses.length, 1);
        assert.equal(vm.isActive("mock-case-analysis"), true);
        assert.deepEqual(removedNotices, []);
    });

    it("keeps the tab when the dialog fails", async () => {
        const { vm } = createTabs([[analysis()]], { removeDialog: new Error("broken") });
        await openAsCreator(vm);
        vm.selectTab("mock-case-analysis");
        const originalError = console.error;
        console.error = () => {};
        try {
            assert.equal(await vm.removeAnalysis("mock-case-analysis"), false);
        } finally {
            console.error = originalError;
        }

        assert.equal(vm.analyses.length, 1);
        assert.equal(vm.isActive("mock-case-analysis"), true);
        assert.equal(vm.removing, false);
    });

    it("is not offered to other teachers, and opens one dialog for two quick clicks", async () => {
        const other = createTabs([[analysis()]], { removeDialog: true });
        await openAsCreator(other.vm, { canAddAnalyses: false });
        assert.equal(other.vm.canRemoveAnalyses(), false);
        assert.equal(await other.vm.removeAnalysis("mock-case-analysis"), false);
        assert.deepEqual(other.removeCalls, []);

        const pending = deferred();
        const { vm, removeCalls } = createTabs([[analysis()]], { removeDialog: pending });
        await openAsCreator(vm);
        const first = vm.removeAnalysis("mock-case-analysis");
        const second = vm.removeAnalysis("mock-case-analysis");
        pending.resolve(false);
        await Promise.all([first, second]);
        assert.equal(removeCalls.length, 1);
        assert.equal(await vm.removeAnalysis("unknown-service"), false);
        assert.equal(removeCalls.length, 1);
    });

    it("ignores a list loaded before the analysis was removed", async () => {
        const slow = deferred();
        const { vm, calls } = createTabs([[analysis()], slow, []], { removeDialog: true });
        await openAsCreator(vm);

        const refresh = vm.refresh();
        await vm.removeAnalysis("mock-case-analysis");
        slow.resolve([analysis()]);
        await refresh;

        assert.deepEqual(vm.analyses, []);
        assert.equal(calls.length, 3, "the stale list is asked for again");
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

    it("offers Remove analysis to the creator and leaves it to the tabs", async () => {
        const { vm } = createPanel();
        vm.summary = analysis();
        assert.equal(vm.canRemove(), false, "without on-remove");
        vm.removable = false;
        vm.onRemove = async () => true;
        assert.equal(vm.canRemove(), false, "not the creator");

        const requests = [];
        const removal = deferred();
        vm.removable = true;
        vm.onRemove = ({ serviceId }) => {
            requests.push(serviceId);
            return removal.promise;
        };
        vm.confirmingGenerate = true;
        assert.equal(vm.canRemove(), true);

        const asked = vm.askToRemove();
        assert.equal(vm.removing, true);
        assert.equal(vm.confirmingGenerate, false);
        await vm.askToRemove();
        removal.resolve(false);
        await asked;

        assert.deepEqual(requests, ["mock-case-analysis"], "one dialog at a time");
        assert.equal(vm.removing, false);
    });

    it("mentions the previous result only when the document predates the generation", async () => {
        const firstRun = analysis({ status: "processing", generatedAt: null });
        // A fast adapter: the detail already holds the first result.
        const fast = createPanel({
            detail: {
                ...firstRun,
                status:      "ready",
                generatedAt: "2026-10-27T10:05:00.000Z",
                document:    { wordCount: 3 },
            },
        });
        setSummary(fast.vm, firstRun);
        await flush();
        assert.equal(fast.vm.state(), "pending");
        assert.equal(fast.vm.hasDocument(), true);
        assert.equal(fast.vm.showsPreviousResult(), false);

        const rerun = analysis({ status: "processing", generatedAt: "2026-10-27T10:00:00.000Z" });
        const again = createPanel({ detail: { ...rerun, document: { wordCount: 3 } } });
        setSummary(again.vm, rerun);
        await flush();
        assert.equal(again.vm.showsPreviousResult(), true);
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

// The panel wired to the tabs as the template does (on-generate, on-remove).
function openPanel(tabs) {
    const { vm } = createPanel();
    vm.onGenerate = ({ serviceId }) => tabs.generateAnalysis(serviceId);
    vm.removable = tabs.canRemoveAnalyses();
    vm.onRemove = ({ serviceId }) => tabs.removeAnalysis(serviceId);
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

    it("removes the analysis from its panel and closes the tab", async () => {
        const { vm: tabs, removeCalls } = createTabs([[analysis()]], { removeDialog: true });
        tabs.caseItem = { id: 7 };
        tabs.canAddAnalyses = true;
        tabs.$onChanges({ caseItem: { currentValue: tabs.caseItem } });
        await flush();
        tabs.selectTab("mock-case-analysis");

        const panel = openPanel(tabs);
        assert.equal(panel.canRemove(), true);
        await panel.askToRemove();

        assert.equal(removeCalls.length, 1);
        assert.equal(tabs.hasAnalysisTabs(), false);
        assert.equal(tabs.isActive(null), true);
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
