// The case view's "Remove analysis" dialog (#1040). `$uibModal` is a fake that
// runs the dialog's controller and lets the test answer it; the analyses
// service answers DELETE /cases/:id/analyses/:serviceId.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { CaseAnalysisRemoveDialogService } from "../case-analysis-remove-dialog.service.js";

const template = readFileSync(new URL(
    "../../../static/views/teacher/fragments/case-analysis-remove-modal.template.html",
    import.meta.url), "utf8");
const panelTemplate = readFileSync(new URL(
    "../../../static/views/teacher/fragments/case-analysis-panel.template.html",
    import.meta.url), "utf8");
const locale = name => JSON.parse(readFileSync(new URL(
    `../../../locales/${name}.json`, import.meta.url), "utf8"));

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

function createService(removeAnalysis = async () => undefined) {
    const requests = [];
    const { $uibModal, opened } = createFakeModal();
    const service = CaseAnalysisRemoveDialogService($uibModal, {
        removeAnalysis: (caseId, serviceId) => {
            requests.push({ caseId, serviceId });
            return removeAnalysis(caseId, serviceId);
        },
    });
    return { service, opened, requests };
}

const quietly = async (run) => {
    const originalError = console.error;
    console.error = () => {};
    try {
        return await run();
    } finally {
        console.error = originalError;
    }
};

describe("CaseAnalysisRemoveDialogService", () => {
    it("opens the dialog for the analysis, with its title announced", () => {
        const { service, opened, requests } = createService();

        service.open({ caseId: 7, serviceId: "mock-case-analysis", title: " Mock analysis " });
        const [{ options, $ctrl }] = opened;

        assert.equal(options.templateUrl,
            "/assets/static/views/teacher/fragments/case-analysis-remove-modal.template.html");
        assert.equal(options.ariaLabelledBy, "caseAnalysisRemoveTitle");
        assert.equal(options.ariaDescribedBy, "caseAnalysisRemoveBody");
        assert.equal(options.windowClass, "case-analysis-remove");
        assert.equal($ctrl.title, "Mock analysis");
        assert.equal($ctrl.inFlight, false);
        assert.deepEqual(requests, [], "nothing is removed before the confirmation");
    });

    it("says when a generation is in flight", () => {
        const { service, opened } = createService();
        service.open({ caseId: 7, serviceId: "svc", title: "Svc", inFlight: true });
        assert.equal(opened[0].$ctrl.inFlight, true);
    });

    it("removes the analysis on confirmation and resolves true", async () => {
        const { service, opened, requests } = createService();
        const result = service.open({ caseId: 7, serviceId: "mock-case-analysis", title: "Mock" });

        await opened[0].$ctrl.confirm();

        assert.deepEqual(requests, [{ caseId: 7, serviceId: "mock-case-analysis" }]);
        assert.equal(await result, true);
    });

    it("resolves false when cancelled or dismissed, without removing", async () => {
        const { service, opened, requests } = createService();
        const cancelled = service.open({ caseId: 7, serviceId: "svc" });
        opened[0].$ctrl.cancel();
        assert.equal(await cancelled, false);

        const dismissed = service.open({ caseId: 7, serviceId: "svc" });
        opened[1].instance.dismiss("escape key press");
        assert.equal(await dismissed, false);
        assert.equal(requests.length, 0);
    });

    it("sends one request for two quick clicks and cannot be closed while it runs", async () => {
        const pending = deferred();
        const { service, opened, requests } = createService(() => pending.promise);
        const result = service.open({ caseId: 7, serviceId: "svc" });
        const [{ $ctrl, instance }] = opened;

        const first = $ctrl.confirm();
        const second = $ctrl.confirm();
        assert.equal($ctrl.submitting, true);
        $ctrl.cancel();
        assert.equal(instance.dismiss("escape key press"), false, "Escape waits too");

        pending.resolve();
        await Promise.all([first, second]);

        assert.equal(requests.length, 1);
        assert.equal(await result, true);
    });

    it("stays open and says so when the request fails, and can retry", async () => {
        let fail = true;
        const { service, opened, requests } = createService(async () => {
            if (fail) {
                throw { status: 500, data: { status: "err" } };
            }
        });
        const result = service.open({ caseId: 7, serviceId: "svc" });
        const [{ $ctrl }] = opened;

        await quietly(() => $ctrl.confirm());

        assert.equal($ctrl.errorKey, "case_analysis_remove_failed");
        assert.equal($ctrl.submitting, false);

        fail = false;
        await $ctrl.confirm();
        assert.equal($ctrl.errorKey, null);
        assert.equal(requests.length, 2);
        assert.equal(await result, true);
    });
});

describe("case analysis remove dialog template", () => {
    it("labels the dialog, focuses Cancel first and removes with a red button", () => {
        assert.match(template, /id="caseAnalysisRemoveTitle"/u);
        assert.match(template, /id="caseAnalysisRemoveBody"/u);
        assert.match(template, /case-analysis-remove-cancel" autofocus/u);
        assert.match(template, /class="btn btn-danger case-analysis-remove-confirm"/u);
        assert.match(template,
            /class="case-analysis-remove-in-flight text-warning" ng-if="\$ctrl\.inFlight"/u);
    });

    it("binds the title through the sanitized translation", () => {
        assert.ok(template.includes(
            "ng-bind-html=\"('case_analysis_remove_title' | translate:{ title: $ctrl.title })\""
        ));
    });

    it("is offered from the panel for the creator only", () => {
        assert.match(panelTemplate,
            /case-analysis-remove-button"\s+ng-if="\$ctrl\.canRemove\(\)"/u);
        assert.match(panelTemplate,
            /ng-if="\$ctrl\.showsPreviousResult\(\)">\{\{ 'case_analysis_previous_result_note'/u);
    });

    it("has every key it uses in both locales, with the title in the question", () => {
        const keys = [...`${template}${panelTemplate}`
            .matchAll(/'(case_analysis_remove_[a-z_]+|cancel)'/gu)]
            .map(match => match[1]);
        keys.push("case_analysis_remove_failed", "case_analysis_remove_notice");
        assert.ok(keys.length >= 8);

        for (const catalog of [locale("es_CL"), locale("en_US")]) {
            for (const key of keys) {
                assert.equal(typeof catalog[key], "string", key);
            }
            assert.match(catalog.case_analysis_remove_title, /\{\{title\}\}/u);
            assert.match(catalog.case_analysis_remove_notice, /\{\{title\}\}/u);
        }
        assert.equal(locale("es_CL").case_analysis_remove_body,
            "Se borrará su resultado y tus cambios. Puedes volver a agregarlo después.");
    });
});
