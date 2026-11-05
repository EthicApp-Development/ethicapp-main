// The activities-empty-page component (#1098, epic #1093): the page of a
// teacher with no activities (#1053), shown by Actividades and the home, with
// step 1 bound to `show-design-step`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import activitiesEmptyPageComponent from "../activities-empty-page.component.js";

const ASSETS = new URL("../../../", import.meta.url);
const VIEWS = new URL("static/views/teacher/", ASSETS);
const read = path => readFileSync(new URL(path, VIEWS), "utf8");
const template = read("fragments/activities-empty-page.template.html");

describe("activities empty page component", () => {
    it("binds whether step 1 shows, and nothing else", () => {
        assert.deepEqual(activitiesEmptyPageComponent.bindings, { showDesignStep: "<" });
        assert.equal(activitiesEmptyPageComponent.templateUrl,
            "/assets/static/views/teacher/fragments/activities-empty-page.template.html");
    });

    it("hides step 1 and the numbers with its binding, not a page's alias", () => {
        assert.equal(template.match(/ng-if="\$ctrl\.showDesignStep"/gu).length, 2);
        assert.doesNotMatch(template, /\bap\./u);
        assert.doesNotMatch(template, /\bha\./u);
    });

    it("is shown by Actividades and the home, each with its own design check", () => {
        assert.ok(read("activity.index.html").includes(
            'show-design-step="ap.showDesignStep"></activities-empty-page>'));
        assert.ok(read("home.html").includes(
            'show-design-step="ha.showDesignStep"></activities-empty-page>'));
    });
});
