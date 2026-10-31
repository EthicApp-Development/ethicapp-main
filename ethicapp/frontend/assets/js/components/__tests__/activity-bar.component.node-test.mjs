import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import activityBarComponent from "../activity-bar.component.js";
import { activityControlsDirective } from "../../directives/activity-controls.directive.js";

// The controller is the last entry of the component's annotated array.
const ActivityBarController = activityBarComponent.controller.at(-1);

const readAsset = path => readFileSync(new URL(path, import.meta.url), "utf8");
const locale = name => JSON.parse(readAsset(`../../../locales/${name}.json`));

function createBar(bindings) {
    const vm = new ActivityBarController();
    Object.assign(vm, bindings);
    vm.$doCheck();
    return vm;
}

const RUNNING = {
    name:   "Ética en la práctica",
    code:   "k00211",
    status: "in_progress",
    phases: [
        { id: 40, number: 1, mode: "individual" },
        { id: 41, number: 2, mode: "team" },
    ],
    currentPhase: { id: 41, number: 2, mode: "team" },
};

describe("activity bar", () => {
    it("shows the status, the current phase and the connected students", () => {
        const vm = createBar({
            activity:    RUNNING,
            totalPhases: 3,
            users:       [{ role: "A" }, { role: "A" }, { role: "P" }],
            isFinished:  false,
        });

        assert.equal(vm.statusName, "in_progress");
        assert.deepEqual(vm.phaseSummary, { number: 2, total: 3, modeKey: "activity_bar_phase_mode_team" });
        assert.equal(vm.connectedCount, 2);
        assert.equal(vm.isWaitingForFirstPhase(), false);
    });

    it("follows the shared state on every digest", () => {
        const users = [{ role: "A" }];
        const vm = createBar({ activity: RUNNING, totalPhases: 3, users, isFinished: false });
        const firstSummary = vm.phaseSummary;

        vm.$doCheck();
        assert.equal(vm.phaseSummary, firstSummary, "the same summary while nothing changed");

        users.push({ role: "A" });
        vm.activity = {
            ...RUNNING,
            phases:       [...RUNNING.phases, { id: 42, number: 3, mode: "individual" }],
            currentPhase: { id: 42, number: 3, mode: "individual" },
        };
        vm.isFinished = true;
        vm.$doCheck();

        assert.equal(vm.connectedCount, 2);
        assert.deepEqual(vm.phaseSummary, { number: 3, total: 3, modeKey: "activity_bar_phase_mode_individual" });
        assert.equal(vm.statusName, "finished");
    });

    it("says no phase started once the design is loaded", () => {
        const waiting = { ...RUNNING, status: "initiated", phases: [], currentPhase: null };

        assert.equal(createBar({ activity: waiting, totalPhases: 3, users: [] }).isWaitingForFirstPhase(), true);
        assert.equal(createBar({ activity: waiting, totalPhases: undefined, users: [] }).isWaitingForFirstPhase(), false);
        assert.equal(createBar({ activity: undefined, totalPhases: 3, users: [] }).isWaitingForFirstPhase(), false);
        assert.equal(createBar({ activity: waiting, totalPhases: 3, users: [], isFinished: true })
            .isWaitingForFirstPhase(), false);
    });
});

describe("activity controls", () => {
    const directive = activityControlsDirective();
    const ControlsController = directive.controller.at(-1);

    function createControls(startNextPhase) {
        const emitted = [];
        const $scope = {
            $id:        12,
            parentCtrl: { startNextPhase },
            $emit:      (name, data) => emitted.push({ name, data }),
        };
        ControlsController($scope);
        return { $scope, emitted };
    }

    it("still announces the new phase to the dashboard", async () => {
        const { $scope, emitted } = createControls(async () => 41);
        await $scope.startNextPhaseAndNotify();
        assert.deepEqual(emitted, [{ name: "activity:phase-advanced", data: { phaseId: 41 } }]);
    });

    it("announces nothing when the phase did not start", async () => {
        const { $scope, emitted } = createControls(async () => null);
        await $scope.startNextPhaseAndNotify();
        assert.deepEqual(emitted, []);
    });

    it("gives each tooltip its own id, referenced as the button's description", () => {
        const { $scope } = createControls(async () => null);
        assert.deepEqual($scope.tipIds, { next: "activity-hold-tip-next-12", end: "activity-hold-tip-end-12" });
        assert.match(directive.template, /aria-describedby="\{\{ tipIds\.next \}\}"/);
        assert.match(directive.template, /id="\{\{ tipIds\.next \}\}"/);
        assert.match(directive.template, /aria-describedby="\{\{ tipIds\.end \}\}"/);
        assert.match(directive.template, /id="\{\{ tipIds\.end \}\}"/);
    });

    it("keeps the 2.5 s hold on both buttons", () => {
        assert.equal(directive.template.match(/hold-to-confirm hold-ms="2500"/g).length, 2);
    });

    it("hides a tooltip on Escape until the pointer or the focus leaves", () => {
        const { $scope } = createControls(async () => null);
        $scope.dismissTipOnEscape({ key: "Enter" }, "next");
        assert.equal($scope.dismissedTip, null);
        $scope.dismissTipOnEscape({ key: "Escape" }, "next");
        assert.equal($scope.dismissedTip, "next");
        $scope.restoreTip();
        assert.equal($scope.dismissedTip, null);
    });
});

describe("activity bar text", () => {
    it("has every key of the bar and the controls in both locales", () => {
        const sources = [
            readAsset("../../../static/views/teacher/fragments/activity-bar.template.html"),
            activityControlsDirective().template,
        ].join("\n");
        const keys = new Set([...sources.matchAll(/'([a-z0-9_]+)'\s*\|\s*translate/g)].map(match => match[1]));
        for (const key of ["activity_bar_phase_mode_team", "activity_bar_phase_mode_individual",
            "initiated", "in_progress", "finished"]) {
            keys.add(key);
        }

        assert.ok(keys.has("activity_hold_next_phase_tip"));
        for (const name of ["es_CL", "en_US"]) {
            const catalog = locale(name);
            for (const key of keys) {
                assert.equal(typeof catalog[key], "string", `${name} has ${key}`);
            }
        }
    });
});
