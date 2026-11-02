// The launch wizard's second step (#972, epic #965): the AI services check,
// the switch, the previous descriptions, and the launch with its progress and
// errors in the action bar.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import launchActivityStepComponent, {
    launchErrorKey,
} from "../launch-activity-step.component.js";
import { LaunchActivityError } from "../../services/activity-catalog.service.js";

// The controller is the last entry of the component's annotated array.
const LaunchActivityStepController = launchActivityStepComponent.controller.at(-1);

const template = readFileSync(new URL(
    "../../../static/views/teacher/fragments/launch-activity-step.template.html", import.meta.url), "utf8");

const DESIGN = { id: 7, locked: false, metainfo: { title: "Privacidad" }, type: "semantic_differential" };

function httpError(status, data = {}) {
    return Object.assign(new Error(`HTTP ${status}`), { status, data });
}

function createStep({
    services = [{ phaseNumber: 1, serviceId: "tutor", canRun: true }],
    servicesError = null,
    valid = true,
    design = DESIGN,
    createActivity = async () => 41,
    activities = [],
    description = "",
} = {}) {
    const calls = { navigated: null, created: [], locked: [], validChecks: 0 };
    const $scope = { $applyAsync() {} };
    const $rootScope = {
        $on: () => () => {},
        navigateTo(path) {
            calls.navigated = path;
        },
    };
    const $timeout = fn => fn();
    const $window = { document: { getElementById: () => null } };

    const designs = {
        async getDesignAiServices(id) {
            assert.equal(id, 7);
            if (servicesError) {
                throw servicesError;
            }
            return services;
        },
        async isDesignValid() {
            calls.validChecks += 1;
            if (valid instanceof Error) {
                throw valid;
            }
            return valid;
        },
        async getDesignById() {
            return design;
        },
        async lockDesign(id, local) {
            calls.locked.push([id, local]);
        },
    };
    const activityCatalog = {
        getActivities: () => activities,
        async createActivity(...args) {
            calls.created.push(args);
            return createActivity(...args);
        },
    };
    const externalServices = {
        getServices: async () => [{ id: "tutor", ui: { translations: { en_US: { label: "Tutor" } } } }],
    };
    const languages = { getCurrentUiLanguageCode: () => "en_US" };

    const vm = new LaunchActivityStepController($scope, $rootScope, $timeout, $window,
        designs, activityCatalog, externalServices, languages);
    vm.designId = 7;
    vm.preview = { title: "Privacidad", phaseCount: 1 };
    vm.description = description;
    let backs = 0;
    vm.onBack = () => {
        backs += 1;
    };
    vm.$onInit();

    return { vm, calls, backs: () => backs };
}

describe("launch step, AI services", () => {
    it("checks the design's services and names them", async () => {
        const { vm } = createStep();
        assert.equal(vm.aiServices.state, "loading");
        assert.equal(vm.canLaunch(), false, "not while checking");

        await vm.ready;
        assert.equal(vm.aiServices.state, "all");
        assert.equal(vm.aiServices.runnable[0].name, "Tutor");
        assert.deepEqual(vm.aiServices.summary, { key: "launch_wizard_ai_summary_one", params: { count: 1 } });
    });

    it("turns the services off with the switch", async () => {
        const { vm } = createStep();
        await vm.ready;

        vm.aiServicesEnabled = false;
        vm.refreshAiServices();
        assert.equal(vm.aiServices.state, "off");
        assert.equal(vm.aiServices.summary.key, "launch_wizard_ai_summary_none");
    });

    it("reports a failed check and lets the teacher launch", async () => {
        const { vm } = createStep({ servicesError: httpError(500), description: "Sección 1" });
        await vm.ready;
        assert.equal(vm.aiServices.state, "failed");
        assert.equal(vm.error, null);
        assert.equal(vm.canLaunch(), true);
    });

    it("says in the bar when the design can no longer be launched", async () => {
        const { vm } = createStep({ servicesError: httpError(404) });
        await vm.ready;
        assert.equal(vm.error, "launch_wizard_error_design_unavailable");
    });
});

describe("launch step, description", () => {
    it("offers the previous descriptions and fills the field with one", async () => {
        const { vm } = createStep({
            activities: [
                { sessionId: 1, description: "Sección 1", time: "2026-10-01T00:00:00Z" },
                { sessionId: 2, description: "Sección 2", time: "2026-10-02T00:00:00Z" },
            ],
        });
        await vm.ready;

        assert.deepEqual(vm.previousDescriptions, ["Sección 2", "Sección 1"]);
        vm.useDescription("Sección 1");
        assert.equal(vm.description, "Sección 1");
        assert.equal(vm.isCurrentDescription("Sección 1"), true);
    });

    it("cannot launch with a blank description", async () => {
        const { vm, calls } = createStep({ description: "   " });
        await vm.ready;

        assert.equal(vm.canLaunch(), false);
        await vm.launch();
        assert.equal(calls.validChecks, 0);
        assert.deepEqual(calls.created, []);
    });

    it("previews the card with the design's title and the description", async () => {
        const { vm } = createStep({ description: "  Ética  · Sección 3 " });
        assert.deepEqual(vm.cardTitle(), { name: "Privacidad", description: "Ética · Sección 3" });
    });
});

describe("launch step, launch", () => {
    it("launches with the trimmed description and opens the dashboard", async () => {
        const { vm, calls } = createStep({ description: "  Sección 3 " });
        await vm.ready;

        const launching = vm.launch();
        assert.equal(vm.launching, true);
        assert.equal(vm.canLaunch(), false, "disabled while launching");
        await launching;

        assert.deepEqual(calls.created, [[DESIGN, "Sección 3", { aiServices: undefined }]]);
        assert.deepEqual(calls.locked, [[7, true]]);
        assert.equal(calls.navigated, "/activities/41");
        assert.equal(vm.launching, true, "it stays busy until the dashboard opens");
    });

    it("launches with aiServices false when the switch is off", async () => {
        const { vm, calls } = createStep({ description: "Sección 3" });
        await vm.ready;
        vm.aiServicesEnabled = false;
        vm.refreshAiServices();

        await vm.launch();
        assert.deepEqual(calls.created[0][2], { aiServices: false });
    });

    it("does not toggle the local lock of a design already locked", async () => {
        const { vm, calls } = createStep({ description: "Sección 3", design: { ...DESIGN, locked: true } });
        await vm.ready;
        await vm.launch();
        assert.deepEqual(calls.locked, []);
        assert.equal(calls.navigated, "/activities/41");
    });

    it("shows an invalid design in the bar", async () => {
        const { vm, calls } = createStep({ description: "Sección 3", valid: false });
        await vm.ready;
        await vm.launch();

        assert.equal(vm.error, "faulty_design");
        assert.equal(vm.launching, false);
        assert.deepEqual(calls.created, []);
        assert.equal(calls.navigated, null);
    });

    it("shows a server error in the bar and lets the teacher try again", async () => {
        const { vm, calls } = createStep({
            description: "Sección 3",
            createActivity: async () => {
                throw new LaunchActivityError("activity", httpError(500));
            },
        });
        await vm.ready;
        await vm.launch();

        assert.equal(vm.error, "launch_wizard_error_failed");
        assert.equal(vm.launching, false);
        assert.equal(vm.canLaunch(), true);
        assert.equal(calls.navigated, null);
    });

    it("goes back only while not launching", async () => {
        const { vm, backs } = createStep();
        vm.back();
        assert.equal(backs(), 1);
        vm.launching = true;
        vm.back();
        assert.equal(backs(), 1);
    });
});

describe("launchErrorKey", () => {
    it("names what went wrong", () => {
        assert.equal(launchErrorKey(new LaunchActivityError("session",
            httpError(400, { code: "ACTIVITY_DESCRIPTION_REQUIRED" }))), "launch_wizard_error_description_required");
        assert.equal(launchErrorKey(new LaunchActivityError("session", httpError(403))),
            "launch_wizard_error_not_allowed");
        assert.equal(launchErrorKey(new LaunchActivityError("activity", httpError(404))),
            "launch_wizard_error_design_unavailable");
        assert.equal(launchErrorKey(httpError(404)), "launch_wizard_error_design_unavailable");
        assert.equal(launchErrorKey(new LaunchActivityError("session", httpError(500))),
            "launch_wizard_error_failed");
        assert.equal(launchErrorKey(new Error("offline")), "launch_wizard_error_failed");
    });
});

describe("launch step template", () => {
    it("launches from the action bar, disabled while it cannot, with its progress", () => {
        assert.match(template, /<form name="launchActivityForm" class="launch-step" ng-submit="\$ctrl\.launch\(\)" novalidate>/);
        assert.match(template, /<button type="submit" class="btn btn-primary launch-wizard-action" ng-disabled="!\$ctrl\.canLaunch\(\)">/);
        assert.match(template, /\{\{ 'preparing_dashboard' \| translate \}\}/);
    });

    it("shows errors in the action bar", () => {
        assert.match(template, /<span class="launch-wizard-actions-error" role="alert" ng-if="\$ctrl\.error">/);
    });

    it("draws the AI services switch as an accessible switch", () => {
        assert.match(template, /<input type="checkbox" role="switch" class="launch-step-switch"/);
        assert.match(template, /ng-model="\$ctrl\.aiServicesEnabled"/);
    });

    it("reuses today's notice for services that cannot run", () => {
        assert.match(template, /'activity_services_not_running_text' \| translate/);
    });
});
