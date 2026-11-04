// The notice after an activity's row action (#1094, epic #1093): a component
// bound to an ActivityRowActionsService instance, with a live region that is
// always in the page, the message bound as text, its links and a dismiss
// button, and nothing read from the Activities page's controller.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import activityActionNoticeComponent from "../activity-action-notice.component.js";

const TEMPLATE_URL = "/assets/static/views/teacher/fragments/activity-action-notice.template.html";
const template = readFileSync(new URL(
    "../../../static/views/teacher/fragments/activity-action-notice.template.html",
    import.meta.url), "utf8");

describe("activity action notice", () => {
    it("binds one row actions instance one way", () => {
        assert.deepEqual(activityActionNoticeComponent.bindings, { actions: "<" });
        assert.equal(activityActionNoticeComponent.templateUrl, TEMPLATE_URL);
    });

    it("reads everything from $ctrl.actions, nothing from the page's ap", () => {
        assert.doesNotMatch(template, /\bap\./u);
        assert.match(template, /ng-if="\$ctrl\.actions\.notice"/u);
        assert.match(template,
            /ng-repeat="action in \$ctrl\.actions\.notice\.actions track by action\.id"/u);
        assert.match(template, /ng-click="\$ctrl\.actions\.runNoticeAction\(action\)"/u);
    });

    it("binds the message as text, never as HTML", () => {
        assert.match(template, /ng-bind="\$ctrl\.actions\.noticeMessage\(\)"/u);
        assert.doesNotMatch(template, /ng-bind-html/u);
    });

    it("keeps the live region in the page and offers a dismiss button", () => {
        // The region is the template's outer element, rendered with or
        // without a notice, so screen readers announce each new one.
        const outer = template.replace(/^<!--[\s\S]*?-->\s*/u, "");
        assert.match(outer,
            /^<div class="[^"]*activities-notice-region"[^>]*role="status" aria-live="polite"/u);
        assert.match(template, /ng-click="\$ctrl\.actions\.dismissNotice\(\)"/u);
        assert.match(template, /'activities_notice_dismiss' \| translate/u);
    });
});
