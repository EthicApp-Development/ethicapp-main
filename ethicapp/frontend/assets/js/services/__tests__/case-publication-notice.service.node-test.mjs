// The dialog that asks a case's author to confirm its publication (#939).
// `$uibModal` is a fake that runs the dialog's controller and lets the test
// confirm or cancel it.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CasePublicationNoticeService } from "../case-publication-notice.service.js";

function createFakeModal() {
    const opened = [];
    const $uibModal = {
        open(options) {
            let resolveResult;
            let rejectResult;
            const result = new Promise((resolve, reject) => {
                resolveResult = resolve;
                rejectResult = reject;
            });
            const instance = {
                close:   value => resolveResult(value),
                dismiss: reason => rejectResult(reason),
            };
            const [, controller] = options.controller;
            const $ctrl = {};
            controller.call($ctrl, instance);
            opened.push({ options, $ctrl });
            return { result };
        },
    };
    return { $uibModal, opened };
}

describe("CasePublicationNoticeService.confirm", () => {
    it("opens the notice dialog with its title and text announced", () => {
        const { $uibModal, opened } = createFakeModal();

        CasePublicationNoticeService($uibModal).confirm();

        assert.equal(opened.length, 1);
        const { options } = opened[0];
        assert.equal(
            options.templateUrl,
            "/assets/static/views/teacher/fragments/case-publication-notice-modal.template.html"
        );
        assert.deepEqual(options.controller.slice(0, -1), ["$uibModalInstance"]);
        assert.equal(options.controllerAs, "$ctrl");
        assert.equal(options.ariaLabelledBy, "casePublicationNoticeTitle");
        assert.equal(options.ariaDescribedBy, "casePublicationNoticeBody");
    });

    it("resolves true when the author confirms", async () => {
        const { $uibModal, opened } = createFakeModal();

        const answer = CasePublicationNoticeService($uibModal).confirm();
        opened[0].$ctrl.confirm();

        assert.equal(await answer, true);
    });

    it("resolves false when the author cancels", async () => {
        const { $uibModal, opened } = createFakeModal();

        const answer = CasePublicationNoticeService($uibModal).confirm();
        opened[0].$ctrl.cancel();

        assert.equal(await answer, false);
    });

    it("resolves false when the dialog is dismissed another way", async () => {
        const { $uibModal } = createFakeModal();
        const dismissing = {
            open(options) {
                $uibModal.open(options);
                return { result: Promise.reject("backdrop click") };
            },
        };

        assert.equal(await CasePublicationNoticeService(dismissing).confirm(), false);
    });
});
