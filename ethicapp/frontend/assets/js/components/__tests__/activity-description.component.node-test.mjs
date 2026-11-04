// The activity card of the home page and the dashboard (#973, epic #965): its
// heading is the activity's name followed by its description, instead of a
// separate "Description:" line. Since #1055 it reads the activity's own
// fields (the design's title and the case), names no design type, and says
// the launch date in the browser's time zone and the UI language.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { activityDescriptionComponent } from "../activity-description.component.js";
import { phaseModeKey } from "../../helpers/activity-bar.js";

const template = readFileSync(new URL(
    "../../../static/views/teacher/fragments/activity-description.template.html", import.meta.url), "utf8");

function fakeRootScope() {
    const listeners = {};
    return {
        listeners,
        $on(event, listener) {
            (listeners[event] ||= []).push(listener);
            return () => {
                listeners[event] = listeners[event].filter(item => item !== listener);
            };
        },
        $emit(event) {
            for (const listener of listeners[event] || []) {
                listener();
            }
        },
    };
}

function createCard(activity, { language = "es_CL", associatedCase, rootScope } = {}) {
    const translate = { use: () => translate.language, language };
    const $rootScope = rootScope || fakeRootScope();
    const Controller = activityDescriptionComponent.controller.at(-1);
    const vm = new Controller($rootScope, translate);
    vm.activity = activity;
    vm.associatedCase = associatedCase;
    vm.$onInit();
    vm.$doCheck();
    return { vm, translate, $rootScope };
}

// Today, so the card reads it as "today, <time>" in any time zone.
function todayAt(hours, minutes) {
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date.toISOString();
}

describe("activity card heading", () => {
    it("holds the name and the description", () => {
        const { vm } = createCard({ name: "Privacidad en apps de salud", description: "Sección 3 · 2026-2" });
        assert.deepEqual(vm.title, { name: "Privacidad en apps de salud", description: "Sección 3 · 2026-2" });

        const title = vm.title;
        vm.$doCheck();
        assert.equal(vm.title, title, "the same title while nothing changed");

        vm.activity = { name: "Privacidad en apps de salud", description: "Sección 5 · 2026-2" };
        vm.$doCheck();
        assert.equal(vm.title.description, "Sección 5 · 2026-2");
    });

    it("holds the name alone for an activity without a description", () => {
        assert.deepEqual(createCard({ name: "Caso", description: "" }).vm.title, { name: "Caso", description: "" });
        assert.deepEqual(createCard({ name: "Caso", description: null }).vm.title, { name: "Caso", description: "" });
    });

    it("shows the description in the heading only, after a separator", () => {
        const heading = template.match(/<div class="panel-heading[^"]*"[^>]*>(.*)<\/div>/)?.[1];
        assert.ok(heading, "one heading on one line");
        assert.match(heading, /\{\{ \$ctrl\.title\.name \}\}/);
        assert.match(heading, /<span class="activity-item-description" ng-if="\$ctrl\.title\.description">/);
        assert.match(heading, /<span ng-if="\$ctrl\.title\.name"> · <\/span>\{\{ \$ctrl\.title\.description \}\}/);
        assert.doesNotMatch(template, /activity_description_colon|no_description/, "no separate description line");
    });
});

describe("activity card, the design and the case (#1055)", () => {
    it("reads the design's title from the activity, not from a design document", () => {
        const { vm } = createCard({
            designId:    7,
            designTitle: " Privacidad  en apps ",
            design:      { metainfo: { title: "Old title" } },
        });
        assert.equal(vm.designTitle, "Privacidad en apps");

        const fromDocument = createCard({ design: { metainfo: { title: "Old title" } } });
        assert.equal(fromDocument.vm.designTitle, "");
        assert.match(template, /\{\{ \$ctrl\.designTitle \}\}/);
        assert.doesNotMatch(template, /\.design\.metainfo/);
    });

    it("names no design type", () => {
        assert.doesNotMatch(template, /ranking_activity|semantic_differential|activity\.type/);
    });

    it("reads the case from the activity's caseId and caseTitle", () => {
        const { vm } = createCard({
            caseId:    31,
            caseTitle: "Datos de pacientes",
            design:    { associatedCase: { id: 9, title: "Old case" } },
        });
        assert.deepEqual(vm.caseItem, { id: 31, title: "Datos de pacientes" });
        assert.equal(vm.formatCaseLabel(vm.caseItem), "Datos de pacientes");

        const caseItem = vm.caseItem;
        vm.$doCheck();
        assert.equal(vm.caseItem, caseItem, "the same case while nothing changed");
    });

    it("shows no case for an activity without one, whatever a design document says", () => {
        const { vm } = createCard({
            caseId: null, caseTitle: null, design: { associatedCase: { id: 9, title: "Old case" } },
        });
        assert.equal(vm.caseItem, null);
    });

    it("prefers the case the dashboard passes, with its author", () => {
        const associatedCase = {
            id: 31, title: "Datos", authorFirstname: "Ana", authorLastname: "Rojas",
        };
        const { vm } = createCard({ caseId: 31, caseTitle: "Datos" }, { associatedCase });
        assert.equal(vm.caseItem, associatedCase);
        assert.equal(vm.formatCaseLabel(vm.caseItem), "Datos (Ana Rojas)");
    });
});

describe("activity card, the launch date (#1055)", () => {
    it("says the date in the UI language and local time, not in UTC", () => {
        const { vm } = createCard({ time: todayAt(18, 1) });
        assert.deepEqual(vm.launchDate.label,
            { key: "activity_date_today", params: { time: "18:01" } });
        assert.ok(vm.launchDate.full.length > 0, "a full date for the hover title");
        assert.doesNotMatch(template, /\(UTC\)|\| date:/);
    });

    it("gives an older date with its time", () => {
        const { vm } = createCard({ time: "2020-03-05T12:00:00Z" }, { language: "en_US" });
        assert.ok(vm.launchDate.label.text.includes("2020"), vm.launchDate.label.text);
        assert.match(vm.launchDate.label.text, /\d{1,2}:\d{2}/u);
    });

    it("shows a dash without a valid date", () => {
        assert.deepEqual(createCard({ time: null }).vm.launchDate.label, { text: "—" });
    });

    it("follows a change of the UI language, and stops when the card goes away", () => {
        const { vm, translate, $rootScope } = createCard({ time: "2020-03-05T12:00:00Z" });
        const spanish = vm.launchDate.label.text;

        translate.language = "en_US";
        $rootScope.$emit("$translateChangeSuccess");
        assert.notEqual(vm.launchDate.label.text, spanish);

        vm.$onDestroy();
        assert.deepEqual($rootScope.listeners.$translateChangeSuccess, []);
    });

    it("formats the date again when the activity's time changes", () => {
        const { vm } = createCard({ time: null });
        vm.activity = { time: todayAt(9, 5) };
        vm.$doCheck();
        assert.deepEqual(vm.launchDate.label,
            { key: "activity_date_today", params: { time: "09:05" } });
    });
});

describe("activity card, its actions", () => {
    it("offers only Ver, the one action its pages use", () => {
        assert.deepEqual(Object.keys(activityDescriptionComponent.bindings).sort(), [
            "activity", "associatedCase", "enableLink", "onView", "showStatusAndCode",
        ]);
        assert.doesNotMatch(template, /onArchive|onUnarchive|onSelect/);
        assert.match(template, /ng-click="\$ctrl\.onView\(\$ctrl\.activity\)"/);
    });
});

// The card's status reads as the activity's row in Actividades (#1078): "Sin
// iniciar" for an activity with no phase started, the phase for one in
// progress, and "Finalizada".
describe("activity card status", () => {
    it("says an activity with no phase started is not started", () => {
        const { vm } = createCard({ status: "initiated", currentPhase: null });
        assert.equal(vm.status.id, "not-started");
        assert.equal(vm.status.key, "activities_status_not_started");
        assert.equal(vm.status.modeKey, null);
    });

    it("says the phase of an activity in progress, as the list does", () => {
        const { vm } = createCard({
            status: "in_progress", currentPhase: { number: 2, mode: "team" }, phaseCount: 3,
        });
        assert.equal(vm.status.id, "in-progress");
        assert.equal(vm.status.key, "activity_bar_phase_label");
        assert.deepEqual(vm.status.params, { number: 2, total: 3 });
        assert.equal(vm.status.modeKey, phaseModeKey("team"));
    });

    it("says a finished activity is finished, by name or by code", () => {
        for (const status of ["finished", 3]) {
            const { vm } = createCard({ status, currentPhase: null });
            assert.equal(vm.status.id, "finished");
            assert.equal(vm.status.key, "finished");
        }
    });

    it("keeps the same status while nothing changed, and follows a new phase", () => {
        const activity = {
            status: "in_progress", currentPhase: { number: 1, mode: "individual" }, phaseCount: 2,
        };
        const { vm } = createCard(activity);
        const status = vm.status;
        vm.$doCheck();
        assert.equal(vm.status, status, "the same object, so watchers settle");

        vm.activity = { ...activity, currentPhase: { number: 2, mode: "team" } };
        vm.$doCheck();
        assert.deepEqual(vm.status.params, { number: 2, total: 2 });
        assert.equal(vm.status.modeKey, phaseModeKey("team"));
    });

    it("translates the status as the list's Estado column, with the generic names gone", () => {
        assert.match(template,
            /\$ctrl\.status\.key \| translate:\{ number: \$ctrl\.status\.params\.number/);
        assert.match(template,
            /mode: \(\$ctrl\.status\.modeKey \? \(\$ctrl\.status\.modeKey \| translate\) : ''\)/);
        assert.match(template, /'text-success': \$ctrl\.status\.id === 'in-progress'/);
        assert.doesNotMatch(template, /getReadableStatus/);
    });
});
