import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import phaseNavigatorComponent from "../phase-navigator.component.js";
import { participantSearchFilter } from "../../filters/participant-search.filter.js";
import { clampOverflowDirective, isClampedOverflowing } from "../../directives/clamp-overflow.directive.js";
import { compactPhaseDescriptionTemplatesRegistry }
    from "../../directives/templates/dashboard/phase-description-templates.registry.js";

// The controller is the last entry of the component's annotated array.
const PhaseNavigatorController = phaseNavigatorComponent.controller.at(-1);

const readAsset = path => readFileSync(new URL(path, import.meta.url), "utf8");
const locale = name => JSON.parse(readAsset(`../../../locales/${name}.json`));
const FRAGMENTS = "../../../static/views/teacher/fragments";

const DESIGN_PHASES = [{ mode: "individual" }, { mode: "team" }, { mode: "individual" }];

function startedPhase(id, number, mode, state = []) {
    return { descriptor: { id, number, mode }, state };
}

function createNavigator(bindings) {
    const selected = [];
    const vm = new PhaseNavigatorController();
    Object.assign(vm, { onSelect: locals => selected.push(locals) }, bindings);
    vm.$doCheck();
    return { vm, selected };
}

describe("phase navigator", () => {
    it("lists the design's phases, the current one marked", () => {
        const phases = [startedPhase(40, 1, "individual"), startedPhase(41, 2, "team")];
        const { vm } = createNavigator({
            designPhases: DESIGN_PHASES, phases, currentPhaseId: 41, selectedPhaseId: 41,
        });

        assert.deepEqual(vm.rows.map(row => [row.number, row.started, row.current]),
            [[1, true, false], [2, true, true], [3, false, false]]);
        assert.equal(vm.isSelected(vm.rows[1]), true);
        assert.equal(vm.isSelected(vm.rows[0]), false);
        assert.equal(vm.isSelected(vm.rows[2]), false);
    });

    it("selects started phases only", () => {
        const phases = [startedPhase(40, 1, "individual")];
        const { vm, selected } = createNavigator({
            designPhases: DESIGN_PHASES, phases, currentPhaseId: 40, selectedPhaseId: 40,
        });

        vm.select(vm.rows[0]);
        vm.select(vm.rows[1]);
        assert.deepEqual(selected, [{ phaseId: 40 }]);
    });

    it("keeps its rows while nothing changed and follows new responses", () => {
        const state = [{ userId: 1, userName: "Ana", r1: null }];
        const phases = [startedPhase(40, 1, "individual", state)];
        const { vm } = createNavigator({
            designPhases: DESIGN_PHASES, phases, currentPhaseId: 40, selectedPhaseId: 40,
        });
        const firstRows = vm.rows;

        vm.$doCheck();
        assert.equal(vm.rows, firstRows, "the same rows while nothing changed");

        state[0].r1 = 3;
        vm.$doCheck();
        assert.notEqual(vm.rows, firstRows);
        assert.deepEqual([vm.rows[0].answered, vm.rows[0].participants], [1, 1]);
    });

    it("selects a new phase as soon as it starts", () => {
        const phases = [startedPhase(40, 1, "individual")];
        const { vm } = createNavigator({
            designPhases: DESIGN_PHASES, phases, currentPhaseId: 40, selectedPhaseId: 40,
        });

        phases.push(startedPhase(41, 2, "team"));
        vm.currentPhaseId = 41;
        vm.selectedPhaseId = 41;
        vm.$doCheck();
        assert.equal(vm.rows[1].current, true);
        assert.equal(vm.isSelected(vm.rows[1]), true);
    });
});

describe("phase pills", () => {
    const templateUrl = attrs => phaseNavigatorComponent.templateUrl.at(-1)(attrs);

    // A row of pills: the list scrolls sideways and the selected pill sits at
    // `pillLeft` px from its left edge. Timeouts run when the test flushes.
    function createPills(bindings, { pillLeft = 0 } = {}) {
        const list = { scrollLeft: 0, clientWidth: 300 };
        const pill = { offsetLeft: pillLeft, offsetWidth: 100 };
        list.querySelector = selector => (selector === ".phase-pill-selected" ? pill : null);
        const element = { querySelector: selector => (selector === ".phase-pills-list" ? list : null) };
        const timeouts = [];
        const $timeout = (fn, delay, invokeApply) => timeouts.push({ fn, delay, invokeApply });
        const vm = new PhaseNavigatorController([element], $timeout);
        Object.assign(vm, { onSelect: () => {} }, bindings);
        vm.$doCheck();
        const flush = () => {
            while (timeouts.length > 0) {
                timeouts.shift().fn();
            }
        };
        return { vm, list, timeouts, flush };
    }

    it("uses the pills template with layout=\"pills\" and the navigator otherwise", () => {
        assert.match(templateUrl({ layout: "pills" }), /\/phase-pills\.template\.html$/);
        assert.match(templateUrl({}), /\/phase-navigator\.template\.html$/);
    });

    it("marks the current phase and checks the earlier ones", () => {
        const phases = [startedPhase(40, 1, "individual"), startedPhase(41, 2, "team")];
        const { vm } = createNavigator({
            designPhases: DESIGN_PHASES, phases, currentPhaseId: 41, selectedPhaseId: 40,
        });

        assert.deepEqual(vm.rows.map(row => vm.marker(row)), ["done", "current", "pending"]);
    });

    it("brings the selected pill into view, outside the digest, only when the selection changes", () => {
        const phases = [startedPhase(40, 1, "individual")];
        const { vm, list, timeouts, flush } = createPills({
            designPhases: DESIGN_PHASES, phases, currentPhaseId: 40, selectedPhaseId: 40,
        }, { pillLeft: 500 });

        assert.equal(timeouts.length, 1);
        assert.equal(timeouts[0].invokeApply, false);
        flush();
        assert.equal(list.scrollLeft, 308);

        vm.$doCheck();
        assert.equal(timeouts.length, 0, "nothing to do while the selection stays");

        phases.push(startedPhase(41, 2, "team"));
        vm.currentPhaseId = 41;
        vm.selectedPhaseId = 41;
        vm.$doCheck();
        assert.equal(timeouts.length, 1, "the new phase's pill comes into view");
    });

    it("leaves the rail's navigator alone", () => {
        const timeouts = [];
        const element = { querySelector: () => null };
        const vm = new PhaseNavigatorController([element], fn => timeouts.push(fn));
        Object.assign(vm, { designPhases: DESIGN_PHASES, phases: [], selectedPhaseId: null });
        vm.$doCheck();
        assert.doesNotThrow(() => timeouts.forEach(fn => fn()));
    });

    it("has a keyboard-reachable button per pill, disabled until its phase starts", () => {
        const template = readAsset(`${FRAGMENTS}/phase-pills.template.html`);
        assert.match(template, /<button type="button" class="phase-pill"/);
        assert.match(template, /ng-disabled="!row\.started"/);
        assert.match(template, /aria-current/);
    });
});

describe("participantSearch filter", () => {
    it("filters a table's rows by name", () => {
        const filter = participantSearchFilter();
        const rows = [{ userName: "Ana" }, { userName: "Beto" }];
        assert.deepEqual(filter(rows, "be"), [rows[1]]);
        assert.equal(filter(rows, ""), rows);
    });
});

describe("clampOverflow directive", () => {
    it("tells whether a clamped element hides content", () => {
        assert.equal(isClampedOverflowing({ scrollHeight: 120, clientHeight: 60 }), true);
        assert.equal(isClampedOverflowing({ scrollHeight: 60, clientHeight: 60 }), false);
        assert.equal(isClampedOverflowing({ scrollHeight: 61, clientHeight: 60 }), false);
        assert.equal(isClampedOverflowing(null), false);
    });

    it("assigns the measure to its expression after the digest", () => {
        const assigned = [];
        const queued = [];
        const scope = {
            $applyAsync: fn => queued.push(fn),
            $on:         () => {},
        };
        const $parse = expression => ({ assign: (target, value) => assigned.push([expression, value]) });
        const element = [{ scrollHeight: 100, clientHeight: 60, firstElementChild: null }];

        clampOverflowDirective($parse).link(scope, element, { clampOverflow: "ctrl.instructionsOverflow" });
        while (queued.length > 0) {
            queued.shift()();
        }
        assert.deepEqual(assigned, [["ctrl.instructionsOverflow", true]]);
    });
});

describe("dashboard templates", () => {
    it("has a compact phase description for every design type", () => {
        assert.deepEqual(Object.keys(compactPhaseDescriptionTemplatesRegistry).sort(),
            ["ranking", "semantic_differential"]);
    });

    it("has every key of the new layout in both locales", () => {
        const sources = [
            readAsset("../../../static/views/teacher/activity.view.html"),
            readAsset(`${FRAGMENTS}/phase-navigator.template.html`),
            readAsset(`${FRAGMENTS}/phase-pills.template.html`),
            readAsset(`${FRAGMENTS}/activity-dashboard-context.template.html`),
            readAsset(`${FRAGMENTS}/sd-individual-results-table.template.html`),
            readAsset(`${FRAGMENTS}/sd-group-results-table.template.html`),
            readAsset(`${FRAGMENTS}/phase-context-features.template.html`),
            readAsset(`${FRAGMENTS}/sd-phase-description-compact.template.html`),
            readAsset(`${FRAGMENTS}/ranking-phase-description-compact.template.html`),
        ].join("\n");
        // Every quoted identifier with an underscore is a translation key.
        const keys = new Set([...sources.matchAll(/'([a-z][a-z0-9]*_[a-z0-9_]+)'/g)].map(match => match[1]));

        assert.ok(keys.has("dashboard_participants_tab"));
        assert.ok(keys.has("dashboard_item_short"));
        assert.ok(keys.has("dashboard_phase_pill"));
        assert.ok(keys.has("dashboard_ai_services_summary_other"));
        assert.ok(keys.has("dashboard_sections_label"));
        for (const name of ["es_CL", "en_US"]) {
            const catalog = locale(name);
            for (const key of keys) {
                assert.equal(typeof catalog[key], "string", `${name} has ${key}`);
            }
        }
    });
});
