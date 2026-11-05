// The activity card of the dashboard's context panel (#973, epic #965): its
// heading is the activity's name followed by its description, instead of a
// separate "Description:" line. Since #1055 it reads the activity's own
// fields (the design's title and the case), names no design type, and says
// the launch date in the browser's time zone and the UI language. Since the
// home stopped using it (#1098), it keeps only what the dashboard shows
// (#1099): no status, access code, design link or actions.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, it } from "node:test";

import { activityDescriptionComponent } from "../activity-description.component.js";

const ASSETS = new URL("../../../", import.meta.url);
const VIEWS = new URL("static/views/teacher/", ASSETS);
const template = readFileSync(
    new URL("fragments/activity-description.template.html", VIEWS), "utf8");
const dashboardContext = readFileSync(
    new URL("fragments/activity-dashboard-context.template.html", VIEWS), "utf8");
const locale = name => JSON.parse(readFileSync(new URL(`locales/${name}.json`, ASSETS), "utf8"));

// The teacher app's sources, without the bundle and the tests.
function teacherSources() {
    const sources = [];
    const walk = (url) => {
        for (const entry of readdirSync(url)) {
            const child = new URL(entry, url);
            if (statSync(child).isDirectory()) {
                if (entry !== "dist" && entry !== "__tests__") {
                    walk(new URL(`${entry}/`, url));
                }
            } else if (/\.(html|js|mjs)$/u.test(entry)) {
                sources.push({ path: child.pathname, text: readFileSync(child, "utf8") });
            }
        }
    };
    walk(new URL("js/", ASSETS));
    walk(VIEWS);
    return sources;
}

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

// The dashboard's activity bar shows the status and the access code (#893),
// and the card has no actions there: what only the home's cards used is gone
// (#1099).
describe("activity card, what the dashboard uses", () => {
    it("binds only the activity and the dashboard's case", () => {
        assert.deepEqual(Object.keys(activityDescriptionComponent.bindings).sort(),
            ["activity", "associatedCase"]);
    });

    it("is used by the dashboard's context panel alone, with those bindings only", () => {
        const usage = dashboardContext.match(/<activity-description\b[^>]*>/u)?.[0];
        assert.ok(usage, "the context panel shows the card");
        assert.match(usage, /activity="dc\.activityState\.descriptor"/u);
        assert.match(usage, /associated-case="dc\.associatedCase"/u);
        assert.doesNotMatch(usage, /enable-link|show-status-and-code|on-view/u);

        const users = teacherSources().filter(({ text }) => /<activity-description\b/u.test(text));
        assert.deepEqual(users.map(({ path }) => path.split("/").pop()),
            ["activity-dashboard-context.template.html"]);
    });

    it("shows the design's title as plain text, with no link to the design", () => {
        assert.ok(template.includes(
            "{{ 'design_used_colon' | translate }}</b> <span>{{ $ctrl.designTitle }}</span>"));
        assert.doesNotMatch(template, /#!\/designs\//u);
    });

    it("shows no status, access code or actions", () => {
        assert.doesNotMatch(template, /enableLink|showStatusAndCode|onView|isFunction/u);
        assert.doesNotMatch(template, /\$ctrl\.status|activity\.code|copy-to-clipboard/u);
        assert.doesNotMatch(template, /panel-footer|teacher-card-actions-footer|<button/u);
        const { vm } = createCard({ status: "in_progress", code: "abc123" });
        assert.equal(vm.status, undefined);
        assert.equal(vm.isFunction, undefined);
    });

    it("keeps the case link and the launch date", () => {
        assert.match(template, /<a ng-href="#!\/cases\/\{\{\$ctrl\.caseItem\.id\}\}">/u);
        assert.match(template, /<time class="activity-item-launch-date"/u);
    });

    it("translates every text in both locales", () => {
        const keys = [...template.matchAll(/'([a-z_]+)'\s*\|\s*translate/gu)]
            .map(match => match[1]);
        assert.deepEqual(keys,
            ["design_used_colon", "design_associated_case_label", "launch_date_colon"]);
        for (const name of ["es_CL", "en_US"]) {
            for (const key of keys) {
                assert.equal(typeof locale(name)[key], "string", `${name}: ${key}`);
            }
        }
    });

    it("retires the status and access code keys, and keeps those other pages use", () => {
        const retired = ["current_status_colon", "access_code_colon"];
        for (const name of ["es_CL", "en_US"]) {
            for (const key of retired) {
                assert.equal(locale(name)[key], undefined, `${name}: ${key}`);
            }
            for (const key of ["design_used_colon", "launch_date_colon", "view"]) {
                assert.equal(typeof locale(name)[key], "string", `${name}: ${key}`);
            }
        }
        const sources = teacherSources();
        for (const key of retired) {
            const used = new RegExp(`['"]${key}['"]`, "u");
            assert.ok(sources.every(({ text }) => !used.test(text)), key);
        }
    });
});

