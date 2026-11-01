import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { dismissibleTipDirective } from "../dismissible-tip.directive.js";
import { activityControlsDirective } from "../activity-controls.directive.js";
import { fakeKeyTarget, fakeTipOwner } from "../../helpers/__tests__/fake-dismissible-tip.mjs";

const readAsset = path => readFileSync(new URL(path, import.meta.url), "utf8");
const FRAGMENTS = "../../../static/views/teacher/fragments";
const DISMISSED = "dashboard-item-tip-dismissed";

function fakeScope() {
    const destroyers = [];
    return {
        $on(name, listener) {
            if (name === "$destroy") {
                destroyers.push(listener);
            }
        },
        destroy: () => destroyers.forEach(listener => listener()),
    };
}

function mountTips(count, ownerOptions) {
    const document = fakeKeyTarget();
    const directive = dismissibleTipDirective([document]);
    const tips = Array.from({ length: count }, () => {
        const tip = fakeTipOwner(ownerOptions);
        tip.scope = fakeScope();
        directive.link(tip.scope, tip.element, { dismissibleTip: DISMISSED });
        return tip;
    });
    return { document, tips };
}

describe("dismissibleTip directive", () => {
    it("hides a hovered tooltip on Escape pressed anywhere, until the pointer leaves", () => {
        const { document, tips: [tip, other] } = mountTips(2);
        tip.enter();

        document.keydown("Escape");
        assert.equal(tip.hasClass(DISMISSED), true);
        assert.equal(other.hasClass(DISMISSED), false, "only the hovered one");

        tip.leave();
        assert.equal(tip.hasClass(DISMISSED), false);
        tip.enter();
        assert.equal(tip.hasClass(DISMISSED), false, "back on it, it shows again");
    });

    it("hides a focused tooltip on Escape, until the focus leaves", () => {
        const { document, tips: [tip] } = mountTips(1);
        tip.focus();
        document.keydown("Tab");
        assert.equal(tip.hasClass(DISMISSED), false);

        document.keydown("Escape");
        assert.equal(tip.hasClass(DISMISSED), true);
        tip.blur(tip.inside);
        assert.equal(tip.hasClass(DISMISSED), true, "the focus moved inside the owner");
        tip.blur();
        assert.equal(tip.hasClass(DISMISSED), false);
    });

    it("keeps it hidden while the pointer stays, whatever the focus does", () => {
        const { document, tips: [tip] } = mountTips(1);
        tip.enter();
        tip.focus();
        document.keydown("Escape");

        tip.blur();
        assert.equal(tip.hasClass(DISMISSED), true);
        tip.focus();
        tip.leave();
        assert.equal(tip.hasClass(DISMISSED), true, "the focus is still inside");
        tip.blur();
        assert.equal(tip.hasClass(DISMISSED), false);
    });

    it("hides a tooltip drawn under a still pointer", () => {
        const { document, tips: [tip] } = mountTips(1);
        tip.enter({ silently: true });

        document.keydown("Escape");
        assert.equal(tip.hasClass(DISMISSED), true);
        tip.leave();
        assert.equal(tip.hasClass(DISMISSED), false);
    });

    it("follows the mouse events where the browser cannot tell the hover", () => {
        const { document, tips: [tip] } = mountTips(1, { hoverMatches: false });
        document.keydown("Escape");
        assert.equal(tip.hasClass(DISMISSED), false);

        tip.enter();
        document.keydown("Escape");
        assert.equal(tip.hasClass(DISMISSED), true);
    });

    it("leaves Escape to the other handlers: the response detail panel and the modals", () => {
        const { document, tips: [tip] } = mountTips(1);
        tip.enter();

        const event = document.keydown("Escape");
        assert.equal(tip.hasClass(DISMISSED), true);
        assert.equal(event.defaultPrevented, false);
        assert.equal(event.propagationStopped, false);
    });

    it("shares one document listener, removed with the last tooltip", () => {
        const { document, tips } = mountTips(3);
        assert.equal(document.listeners.size, 1);

        tips[0].scope.destroy();
        tips[1].scope.destroy();
        assert.equal(document.listeners.size, 1);
        tips[2].scope.destroy();
        assert.equal(document.listeners.size, 0);
        assert.equal(tips[2].handlers.size, 0, "and the owner's own listeners");
    });

    it("does nothing without a class to set", () => {
        const document = fakeKeyTarget();
        const tip = fakeTipOwner();
        dismissibleTipDirective([document]).link(fakeScope(), tip.element, { dismissibleTip: "" });
        assert.equal(document.listeners.size, 0);
        assert.equal(tip.handlers.size, 0);
    });
});

describe("dashboard tooltips dismissed with Escape", () => {
    const fragment = name => readAsset(`${FRAGMENTS}/${name}.template.html`);
    const uses = [
        ["question headers, students", fragment("sd-individual-results-table"),
            "dashboard-item-tip-dismissed", 1],
        ["question headers, groups", fragment("sd-group-results-table"),
            "dashboard-item-tip-dismissed", 1],
        ["hold-to-confirm buttons", activityControlsDirective().template,
            "activity-hold-tip-dismissed", 2],
        ["activity name", fragment("activity-bar"),
            "activity-bar-title-tip-dismissed", 1],
    ];

    for (const [name, template, dismissedClass, count] of uses) {
        it(`uses dismissible-tip for the ${name}`, () => {
            const pattern = new RegExp(`dismissible-tip="${dismissedClass}"`, "g");
            assert.equal(template.match(pattern)?.length, count);
            assert.doesNotMatch(template, /'Escape'|OnEscape|ng-blur|ng-mouseleave|tip-dismissed'/,
                "no handling of its own");
        });
    }

    it("keeps the CSS that hides each dismissed tooltip", () => {
        const css = readAsset("../../../css/main.css");
        const hides = (owner, dismissed, tip) => assert.match(css,
            new RegExp(`\\.${owner}\\.${dismissed} \\.${tip} \\{\\s*display: none;`));
        hides("dashboard-item", "dashboard-item-tip-dismissed", "dashboard-item-tip");
        hides("activity-hold", "activity-hold-tip-dismissed", "activity-hold-tip");
        hides("activity-bar-title", "activity-bar-title-tip-dismissed", "activity-bar-name-tip");
    });
});
