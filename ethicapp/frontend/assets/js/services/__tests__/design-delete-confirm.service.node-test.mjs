// The dialog that asks before deleting a design (#978). `$uibModal` is a fake
// that runs the dialog's controller and lets the test answer it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { DesignDeleteConfirmService } from "../design-delete-confirm.service.js";

const template = readFileSync(new URL(
    "../../../static/views/teacher/fragments/design-delete-confirm-modal.template.html",
    import.meta.url), "utf8");

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
            const [, , controller] = options.controller;
            const $ctrl = {};
            controller.call($ctrl, instance, options.resolve.dialog());
            opened.push({ options, $ctrl });
            return { result };
        },
    };
    return { $uibModal, opened };
}

describe("DesignDeleteConfirmService.confirm", () => {
    it("opens the dialog for the design, with its title and text announced", () => {
        const { $uibModal, opened } = createFakeModal();

        DesignDeleteConfirmService($uibModal).confirm({ title: "Remote work", canArchive: true });

        const { options, $ctrl } = opened[0];
        assert.equal(options.templateUrl,
            "/assets/static/views/teacher/fragments/design-delete-confirm-modal.template.html");
        assert.equal(options.ariaLabelledBy, "designDeleteConfirmTitle");
        assert.equal(options.ariaDescribedBy, "designDeleteConfirmBody");
        assert.equal($ctrl.title, "Remote work");
        assert.equal($ctrl.canArchive, true);
    });

    it("does not offer to archive unless asked", () => {
        const { $uibModal, opened } = createFakeModal();
        DesignDeleteConfirmService($uibModal).confirm({ title: "Gone" });
        assert.equal(opened[0].$ctrl.canArchive, false);
    });

    it("answers delete, archive or cancel", async () => {
        for (const [method, expected] of [
            ["confirmDelete", "delete"], ["archiveInstead", "archive"], ["cancel", "cancel"],
        ]) {
            const { $uibModal, opened } = createFakeModal();
            const answer = DesignDeleteConfirmService($uibModal).confirm({ canArchive: true });
            opened[0].$ctrl[method]();
            assert.equal(await answer, expected, method);
        }
    });

    it("cancels when the dialog is dismissed another way", async () => {
        const dismissing = {
            open: () => ({ result: Promise.reject("escape key press") }),
        };
        assert.equal(await DesignDeleteConfirmService(dismissing).confirm({}), "cancel");
    });
});

describe("design delete dialog template", () => {
    it("labels the dialog and focuses Cancel first", () => {
        assert.match(template, /id="designDeleteConfirmTitle"/u);
        assert.match(template, /id="designDeleteConfirmBody"/u);
        assert.match(template, /design-delete-confirm-cancel" autofocus/u);
    });

    it("offers Archive instead only when allowed, and deletes with a red button", () => {
        assert.match(template,
            /ng-if="\$ctrl\.canArchive"\s+ng-click="\$ctrl\.archiveInstead\(\)"/u);
        assert.match(template, /btn btn-danger design-delete-confirm-delete/u);
    });

    it("binds the title through the sanitized translation", () => {
        assert.match(template, /ng-bind-html="\(\(\$ctrl\.title/u);
    });
});
