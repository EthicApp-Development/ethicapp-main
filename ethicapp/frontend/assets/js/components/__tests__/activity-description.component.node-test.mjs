// The activity card of Actividades, the home page and the dashboard (#973,
// epic #965): its heading is the activity's name followed by its
// description, instead of a separate "Description:" line.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { activityDescriptionComponent } from "../activity-description.component.js";

const template = readFileSync(new URL(
    "../../../static/views/teacher/fragments/activity-description.template.html", import.meta.url), "utf8");

function createCard(activity) {
    const vm = new activityDescriptionComponent.controller();
    vm.activity = activity;
    vm.$doCheck();
    return vm;
}

describe("activity card heading", () => {
    it("holds the name and the description", () => {
        const vm = createCard({ name: "Privacidad en apps de salud", description: "Sección 3 · 2026-2" });
        assert.deepEqual(vm.title, { name: "Privacidad en apps de salud", description: "Sección 3 · 2026-2" });

        const title = vm.title;
        vm.$doCheck();
        assert.equal(vm.title, title, "the same title while nothing changed");

        vm.activity = { name: "Privacidad en apps de salud", description: "Sección 5 · 2026-2" };
        vm.$doCheck();
        assert.equal(vm.title.description, "Sección 5 · 2026-2");
    });

    it("holds the name alone for an activity without a description", () => {
        assert.deepEqual(createCard({ name: "Caso", description: "" }).title, { name: "Caso", description: "" });
        assert.deepEqual(createCard({ name: "Caso", description: null }).title, { name: "Caso", description: "" });
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
