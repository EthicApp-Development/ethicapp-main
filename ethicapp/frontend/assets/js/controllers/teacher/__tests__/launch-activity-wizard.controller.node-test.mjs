// The launch wizard's shell and step 1 (#971, epic #965): the step lives in
// the URL, going back keeps the search and the selection, and the route's
// design is preselected.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { LaunchActivityWizardController } from "../launch-activity-wizard.controller.js";

const template = readFileSync(new URL(
    "../../../../static/views/teacher/activity.new.html", import.meta.url), "utf8");

const DESIGNS = [
    {
        id:        1, userOwned: true, archived:  false, valid:     true, createdAt: "2026-01-01T00:00:00Z",
        metainfo:  { title: "Puente" }, phases:    [{ mode: "individual", questions: [{}] }],
    },
    {
        id:             2, userOwned:      true, archived:       false, valid:          true, createdAt:      "2026-10-31T00:00:00Z",
        usesAiServices: true, metainfo:       { title: "Privacidad" },
        phases:         [{ mode:             "team", stdntAmount:      3, chat:             true, questions:        [],
            externalServices: { enabledServiceIds: ["tutor"] } }],
    },
    { id: 3, userOwned: true, archived: false, valid: false, metainfo: { title: "Roto" }, phases: [] },
];

// A fake $location whose search changes reach the controller as Angular's
// $routeUpdate would, and a window whose history goes back the same way.
function createWizard({ routeParams = {}, search = {} } = {}) {
    const scopeHandlers = {};
    const $scope = {
        $on(name, handler) {
            (scopeHandlers[name] ||= []).push(handler);
        },
        $applyAsync() {},
        navigateTo(path) {
            calls.navigated = path;
        },
    };
    const calls = { navigated: null, historyBack: 0, pushes: [], replaces: [] };
    let current = { ...search };
    const history = [{ ...current }];
    const fireRouteUpdate = () => (scopeHandlers.$routeUpdate || []).forEach(handler => handler());

    const $location = {
        search(key, value) {
            if (key === undefined) {
                return { ...current };
            }
            const next = { ...current };
            if (value === null) {
                delete next[key];
            } else {
                next[key] = String(value);
            }
            current = next;
            let replaced = false;
            const chain = {
                replace() {
                    replaced = true;
                    history[history.length - 1] = { ...current };
                    calls.replaces.push({ ...current });
                    return chain;
                },
            };
            // Angular applies the change after the call; a push unless replaced.
            queueMicrotask(() => {
                if (!replaced) {
                    history.push({ ...current });
                    calls.pushes.push({ ...current });
                }
            });
            return chain;
        },
    };
    const $window = {
        scrollY:  0,
        scrollTo() {},
        document: { getElementById: () => null },
        history:  {
            get length() {
                return history.length;
            },
            back() {
                calls.historyBack += 1;
                history.pop();
                current = { ...history[history.length - 1] };
                fireRouteUpdate();
            },
        },
    };
    const $timeout = fn => fn();
    const $rootScope = { $on: () => () => {} };

    const vm = {};
    LaunchActivityWizardController.call(vm, $scope, $rootScope, routeParams, $location,
        $timeout, $window,
        { getDesigns: async () => DESIGNS },
        { loadActivities: async () => [{ designId: 1, time: "2026-10-28T00:00:00Z" }] },
        { getServices: async () => [{ id: "tutor", ui: { translations: { en_US: { label: "Tutor" } } } }] },
        { getCurrentUiLanguageCode: () => "en_US" });

    return {
        vm,
        calls,
        settle: () => new Promise(resolve => setImmediate(resolve)),
        browserBack() {
            $window.history.back();
        },
    };
}

describe("launch wizard, step 1", () => {
    it("lists the launchable designs by last launch and counts the ones with errors", async () => {
        const { vm } = createWizard();
        await vm.ready;

        assert.equal(vm.step, 1);
        assert.deepEqual(vm.rows.map(row => row.id), [2, 1]);
        assert.equal(vm.total, 2);
        assert.equal(vm.designsWithErrors, 1);
        assert.equal(vm.hasSelection(), false);
    });

    it("previews the selected design with its services' names", async () => {
        const { vm, settle } = createWizard();
        await vm.ready;

        vm.selectDesign(2);
        await settle();
        assert.equal(vm.selectedRow.title, "Privacidad");
        assert.deepEqual(vm.preview.phases[0].services, [{ id: "tutor", name: "Tutor" }]);
        assert.equal(vm.preview.launch, null, "never launched");
    });

    it("preselects the route's design", async () => {
        const { vm } = createWizard({ routeParams: { designId: "1" } });
        await vm.ready;
        assert.equal(vm.selectedDesignId, 1);
        assert.equal(vm.preview.launch.key, "launch_wizard_launched_one");
    });

    it("does not preselect a design that cannot be launched", async () => {
        const { vm } = createWizard({ routeParams: { designId: "3" } });
        await vm.ready;
        assert.equal(vm.hasSelection(), false);
    });

    it("shows 20 rows, then more on request", async () => {
        const { vm } = createWizard();
        await vm.ready;
        vm.rows = Array.from({ length: 45 }, (_, index) => ({ id: index }));
        assert.equal(vm.getVisibleRows().length, 20);
        vm.showMore();
        vm.showMore();
        assert.equal(vm.getVisibleRows().length, 45);
        assert.equal(vm.hasMoreRows(), false);
    });
});

describe("launch wizard, steps in the URL", () => {
    it("moves to step 2 only with a design, and Back returns with the search and selection kept", async () => {
        const { vm, calls, settle, browserBack } = createWizard();
        await vm.ready;

        vm.goToLaunchStep();
        assert.equal(vm.step, 1, "no design chosen yet");

        vm.search = "priv";
        vm.handleSearchChange();
        vm.selectDesign(2);
        vm.goToLaunchStep();
        await settle();
        assert.equal(vm.step, 2);
        assert.deepEqual(calls.pushes, [{ step: "2" }]);

        browserBack();
        assert.equal(vm.step, 1);
        assert.equal(vm.search, "priv");
        assert.equal(vm.selectedDesignId, 2);
        assert.deepEqual(vm.rows.map(row => row.id), [2]);
    });

    it("goes back in the history from step 2 when step 1 came before it", async () => {
        const { vm, calls, settle } = createWizard();
        await vm.ready;
        vm.chooseAndContinue(1);
        await settle();
        assert.equal(vm.step, 2);

        vm.goToChooseStep();
        assert.equal(calls.historyBack, 1);
        assert.equal(vm.step, 1);
    });

    it("opens step 2 from the URL with the route's design, and leaves it without going back", async () => {
        const { vm, calls } = createWizard({ routeParams: { designId: "2" }, search: { step: "2" } });
        await vm.ready;
        assert.equal(vm.step, 2);

        vm.goToChooseStep();
        assert.equal(calls.historyBack, 0);
        assert.deepEqual(calls.replaces, [{}]);
        assert.equal(vm.step, 1);
    });

    it("starts over at step 1 when the URL asks for step 2 without a design", async () => {
        const { vm, calls } = createWizard({ search: { step: "2" } });
        await vm.ready;
        assert.equal(vm.step, 1);
        assert.deepEqual(calls.replaces, [{}]);
    });

    it("cancels to the previous page, else home", async () => {
        const { vm, calls } = createWizard();
        await vm.ready;
        vm.cancel();
        assert.equal(calls.historyBack, 0);
        assert.equal(calls.navigated, "/");
    });
});

describe("launch wizard template", () => {
    it("marks the current step for assistive technology", () => {
        assert.match(template, /<nav class="launch-wizard-stepper" aria-label=/);
        assert.equal((template.match(/ng-attr-aria-current="\{\{ lw\.step === [12] \? 'step' : undefined \}\}"/g) || []).length, 2);
    });

    it("selects rows as radio buttons and moves on with a double click", () => {
        assert.match(template, /role="radiogroup"/);
        assert.match(template, /<input type="radio" name="launch-design"/);
        assert.match(template, /ng-dblclick="lw\.chooseAndContinue\(row\.id\)"/);
    });

    it("disables Next until a design is chosen, and launches with the wizard's description", () => {
        assert.match(template, /ng-disabled="!lw\.hasSelection\(\)" ng-click="lw\.goToLaunchStep\(\)"/);
        assert.match(template, /ng-submit="ac\.createSession\(lw\.selectedDesignId, lw\.description\)"/);
        assert.match(template, /ng-disabled="ac\.showSpinner \|\| !ac\.hasDescription\(lw\.description\)"/);
    });

    it("links the designs with errors to Diseños", () => {
        assert.match(template, /<a href="#!\/designs">\{\{ 'launch_wizard_review_in_designs' \| translate \}\}<\/a>/);
    });

    it("shows no design type", () => {
        assert.doesNotMatch(template, /design_type|semantic_differential|ranking/);
    });
});
