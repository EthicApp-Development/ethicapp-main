// The case view's "Add analysis" dialog (#1039). `$uibModal` is a fake that
// runs the dialog's controller and lets the test answer it; the analyses
// service answers POST /cases/:id/analyses.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { CaseAnalysisAddDialogService } from "../case-analysis-add-dialog.service.js";

const template = readFileSync(new URL(
    "../../../static/views/teacher/fragments/case-analysis-add-modal.template.html",
    import.meta.url), "utf8");
const optionsTemplate = readFileSync(new URL(
    "../../../static/views/teacher/fragments/case-analysis-options.template.html",
    import.meta.url), "utf8");
const locale = name => JSON.parse(readFileSync(new URL(
    `../../../locales/${name}.json`, import.meta.url), "utf8"));

const SERVICES = [{ id: "mock-case-analysis" }, { id: "case-evaluation" }];
const ANALYSES = [{ serviceId: "mock-case-analysis", status: "requested" }];

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function createFakeModal() {
    const opened = [];
    const $uibModal = {
        open(options) {
            const result = deferred();
            const listeners = {};
            const $scope = {
                $applyAsync() {},
                $on(name, listener) {
                    listeners[name] = listener;
                },
            };
            // What ui-bootstrap does: "modal.closing" first, which may cancel.
            const closeWith = (settle, value, closing) => {
                let prevented = false;
                listeners["modal.closing"]?.({ preventDefault: () => { prevented = true; } },
                    value, closing);
                if (!prevented) {
                    settle(value);
                }
                return !prevented;
            };
            const instance = {
                close:   value => closeWith(result.resolve, value, true),
                dismiss: reason => closeWith(result.reject, reason, false),
            };
            const [, , , controller] = options.controller;
            const $ctrl = {};
            controller.call($ctrl, $scope, instance, options.resolve.dialog());
            opened.push({ options, $ctrl, instance });
            return { result: result.promise };
        },
    };
    return { $uibModal, opened };
}

function createService(addAnalyses = async () => ANALYSES) {
    const requests = [];
    const { $uibModal, opened } = createFakeModal();
    const service = CaseAnalysisAddDialogService($uibModal, {
        addAnalyses: (caseId, serviceIds) => {
            requests.push({ caseId, serviceIds });
            return addAnalyses(caseId, serviceIds);
        },
    });
    return { service, opened, requests };
}

// Opens the dialog with its services loaded and the given ones checked.
function openWith(service, opened, checked = []) {
    const result = service.open({ caseId: 7, chosenServiceIds: ["case-topic-listing"] });
    const { $ctrl } = opened.at(-1);
    $ctrl.handleServicesLoaded(SERVICES);
    for (const serviceId of checked) {
        $ctrl.formModel.analysisSelection[serviceId] = true;
    }
    return { result, $ctrl };
}

describe("CaseAnalysisAddDialogService", () => {
    it("opens the dialog without the services the case has, waiting for the others", () => {
        const { service, opened } = createService();

        service.open({ caseId: 7, chosenServiceIds: ["case-topic-listing"] });
        const [{ options, $ctrl }] = opened;

        assert.equal(options.templateUrl,
            "/assets/static/views/teacher/fragments/case-analysis-add-modal.template.html");
        assert.equal(options.windowClass, "case-analysis-add");
        assert.deepEqual($ctrl.excludedServiceIds, ["case-topic-listing"]);
        assert.equal($ctrl.formModel.analysisEnabled, true);
        assert.equal($ctrl.loading, true);
        assert.equal($ctrl.canConfirm(), false, "the services are not loaded yet");

        $ctrl.handleServicesLoaded(SERVICES);
        assert.equal($ctrl.canConfirm(), true);
    });

    it("sends the chosen services and closes with the case's analyses", async () => {
        const { service, opened, requests } = createService();
        const checked = ["case-evaluation", "mock-case-analysis"];
        const { result, $ctrl } = openWith(service, opened, checked);

        await $ctrl.confirm();

        // In the listed order.
        assert.deepEqual(requests, [{
            caseId:     7,
            serviceIds: ["mock-case-analysis", "case-evaluation"],
        }]);
        assert.deepEqual(await result, ANALYSES);
    });

    it("sends nothing until a service is chosen", async () => {
        const { service, opened, requests } = createService();
        const { $ctrl } = openWith(service, opened);

        await $ctrl.confirm();

        assert.equal(requests.length, 0);
        assert.equal($ctrl.hasAttemptedSubmit, true);
    });

    it("cannot confirm without services to add", () => {
        const { service, opened } = createService();
        service.open({ caseId: 7 });
        const [{ $ctrl }] = opened;

        $ctrl.handleServicesLoaded([]);

        assert.equal($ctrl.hasServices(), false);
        assert.equal($ctrl.canConfirm(), false);
    });

    it("sends one request for two quick clicks and cannot be closed while it runs", async () => {
        const pending = deferred();
        const { service, opened, requests } = createService(() => pending.promise);
        const { result, $ctrl } = openWith(service, opened, ["mock-case-analysis"]);
        const { instance } = opened[0];

        const first = $ctrl.confirm();
        const second = $ctrl.confirm();
        assert.equal($ctrl.submitting, true);
        assert.equal($ctrl.canConfirm(), false);

        $ctrl.cancel();
        assert.equal(instance.dismiss("escape key press"), false, "Escape waits too");

        pending.resolve(ANALYSES);
        await Promise.all([first, second]);

        assert.equal(requests.length, 1);
        assert.deepEqual(await result, ANALYSES);
    });

    it("stays open and says why when the request is refused", async () => {
        let fail = true;
        const { service, opened, requests } = createService(async () => {
            if (fail) {
                throw { status: 400, data: { code: "CASE_ANALYSIS_SERVICE_INVALID" } };
            }
            return ANALYSES;
        });
        const { result, $ctrl } = openWith(service, opened, ["mock-case-analysis"]);

        const originalError = console.error;
        console.error = () => {};
        try {
            await $ctrl.confirm();
        } finally {
            console.error = originalError;
        }

        assert.equal($ctrl.errorKey, "case_analysis_save_invalid");
        assert.equal($ctrl.submitting, false);

        fail = false;
        await $ctrl.confirm();
        assert.equal($ctrl.errorKey, null);
        assert.equal(requests.length, 2);
        assert.deepEqual(await result, ANALYSES);
    });

    it("resolves null when cancelled", async () => {
        const { service, opened, requests } = createService();
        const { result, $ctrl } = openWith(service, opened, ["mock-case-analysis"]);

        $ctrl.cancel();

        assert.equal(await result, null);
        assert.equal(requests.length, 0);
    });
});

describe("case analysis add dialog template", () => {
    it("reuses the creation form's options in add mode", () => {
        assert.match(template, /<case-analysis-options\s+mode="add"/u);
        assert.match(template, /excluded-service-ids="\$ctrl\.excludedServiceIds"/u);
        assert.match(template, /on-services-loaded="\$ctrl\.handleServicesLoaded\(services\)"/u);
        assert.match(template, /id="caseAnalysisAddTitle"/u);
        assert.match(template, /id="caseAnalysisAddBody"/u);
        assert.match(template, /class="btn btn-primary case-analysis-add-confirm"/u);
        assert.match(template, /ng-disabled="!\$ctrl\.canConfirm\(\)"/u);
    });

    it("hides the creation form's switch in add mode", () => {
        assert.match(optionsTemplate, /<legend ng-if="!\$ctrl\.isAddMode\(\)">/u);
        assert.match(optionsTemplate,
            /class="checkbox case-form-field" ng-if="!\$ctrl\.isAddMode\(\)"/u);
        assert.match(optionsTemplate, /\$ctrl\.selectionErrorKey\(\) \| translate/u);
    });

    it("has every key it uses in both locales", () => {
        const keys = [...`${template}${optionsTemplate}`
            .matchAll(/'(case_analysis_[a-z_]+|cancel|loading)'/gu)]
            .map(match => match[1]);
        keys.push(
            "case_analysis_add_action",
            "case_analysis_add_failed",
            "case_analysis_add_select_tool",
            "case_analysis_save_invalid"
        );

        for (const catalog of [locale("es_CL"), locale("en_US")]) {
            for (const key of keys) {
                assert.equal(typeof catalog[key], "string", key);
            }
            assert.equal(catalog.case_analysis_creation_only_help, undefined);
        }
    });
});
