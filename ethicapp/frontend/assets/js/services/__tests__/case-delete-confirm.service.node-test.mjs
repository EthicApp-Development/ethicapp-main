// The dialog that asks before deleting a case (#1017). `$uibModal` is a fake
// that runs the dialog's controller and lets the test answer it; the catalog
// answers GET /cases/:id/uses.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { CaseDeleteConfirmService } from "../case-delete-confirm.service.js";

const template = readFileSync(new URL(
    "../../../static/views/teacher/fragments/case-delete-confirm-modal.template.html",
    import.meta.url), "utf8");
const locale = name => JSON.parse(readFileSync(new URL(
    `../../../locales/${name}.json`, import.meta.url), "utf8"));

const NO_USES = {
    ownDesigns:           [],
    activityCount:        0,
    otherDesignCount:     0,
    otherTeacherCount:    0,
    designsKeepingAccess: 0,
};

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
            const [, , , controller] = options.controller;
            const $ctrl = {};
            const $scope = { $applyAsync() {} };
            controller.call($ctrl, $scope, instance, options.resolve.dialog());
            opened.push({ options, $ctrl });
            return { result };
        },
    };
    return { $uibModal, opened };
}

function createService(getCaseUses = async () => NO_USES) {
    const requested = [];
    const { $uibModal, opened } = createFakeModal();
    const service = CaseDeleteConfirmService($uibModal, {
        getCaseUses: (caseId) => {
            requested.push(caseId);
            return getCaseUses(caseId);
        },
    });
    return { service, opened, requested };
}

describe("CaseDeleteConfirmService.confirm", () => {
    it("opens the dialog for the case, with its title and text announced", async () => {
        const { service, opened, requested } = createService();

        service.confirm({ caseId: 7, title: " Screens ", archived: false });

        const { options, $ctrl } = opened[0];
        assert.equal(options.templateUrl,
            "/assets/static/views/teacher/fragments/case-delete-confirm-modal.template.html");
        assert.equal(options.ariaLabelledBy, "caseDeleteConfirmTitle");
        assert.equal(options.ariaDescribedBy, "caseDeleteConfirmBody");
        assert.equal(options.windowClass, "case-delete-confirm");
        assert.equal($ctrl.title, "Screens");
        assert.equal($ctrl.canArchive, true);
        assert.deepEqual(requested, [7]);
        await $ctrl.loaded;
    });

    it("does not offer to archive an archived case", async () => {
        const { service, opened } = createService();
        service.confirm({ caseId: 7, title: "Gone", archived: true });
        const { $ctrl } = opened[0];
        assert.equal($ctrl.canArchive, false);
        $ctrl.archiveInstead();
        await $ctrl.loaded;
    });

    it("waits for the designs before deleting, then lists them", async () => {
        let answer;
        const { service, opened } = createService(() => new Promise((resolve) => {
            answer = resolve;
        }));
        const choice = service.confirm({ caseId: 7, title: "Screens" });
        const { $ctrl } = opened[0];
        assert.equal($ctrl.loading, true);
        assert.equal($ctrl.canDelete(), false);
        $ctrl.confirmDelete();

        answer({ ...NO_USES, ownDesigns: [
            { id: 3, title: "Remote work", archived: false },
            { id: 4, title: null, archived: true },
        ] });
        await $ctrl.loaded;
        assert.equal($ctrl.loading, false);
        assert.deepEqual($ctrl.designs, [
            { id: 3, title: "Remote work", archived: false },
            { id: 4, title: null, archived: true },
        ]);
        assert.equal($ctrl.refusal, null);
        assert.equal($ctrl.canDelete(), true);
        $ctrl.confirmDelete();
        assert.equal(await choice, "delete");
    });

    it("says why the case cannot be deleted when the list was stale", async () => {
        const { service, opened } = createService(async () => ({
            ...NO_USES, otherDesignCount: 2, otherTeacherCount: 2, designsKeepingAccess: 2,
        }));
        const choice = service.confirm({ caseId: 7, title: "Screens" });
        const { $ctrl } = opened[0];
        await $ctrl.loaded;
        assert.deepEqual($ctrl.refusal,
            { key: "cases_delete_used_by_others_other", params: { count: 2, teachers: 2 } });
        assert.equal($ctrl.canDelete(), false);
        $ctrl.confirmDelete();
        $ctrl.archiveInstead();
        assert.equal(await choice, "archive");
    });

    it("refuses a case an activity started using", async () => {
        const { service, opened } = createService(async () => ({ ...NO_USES, activityCount: 1 }));
        service.confirm({ caseId: 7 });
        const { $ctrl } = opened[0];
        await $ctrl.loaded;
        assert.equal($ctrl.refusal.key, "cases_delete_in_use_one");
        $ctrl.cancel();
    });

    it("lets the teacher delete when the designs cannot be loaded", async () => {
        const originalWarn = console.warn;
        console.warn = () => {};
        try {
            const { service, opened } = createService(async () => {
                throw new Error("down");
            });
            const choice = service.confirm({ caseId: 7, title: "Screens" });
            const { $ctrl } = opened[0];
            await $ctrl.loaded;
            assert.equal($ctrl.loadFailed, true);
            assert.equal($ctrl.canDelete(), true);
            $ctrl.confirmDelete();
            assert.equal(await choice, "delete");
        } finally {
            console.warn = originalWarn;
        }
    });

    it("answers archive or cancel", async () => {
        for (const [method, expected] of [["archiveInstead", "archive"], ["cancel", "cancel"]]) {
            const { service, opened } = createService();
            const answer = service.confirm({ caseId: 7 });
            await opened[0].$ctrl.loaded;
            opened[0].$ctrl[method]();
            assert.equal(await answer, expected, method);
        }
    });

    it("cancels when the dialog is dismissed another way", async () => {
        const dismissing = {
            open: () => ({ result: Promise.reject("escape key press") }),
        };
        const answer = CaseDeleteConfirmService(dismissing, {}).confirm({ caseId: 7 });
        assert.equal(await answer, "cancel");
    });
});

describe("case delete dialog template", () => {
    it("labels the dialog and focuses Cancel first", () => {
        assert.match(template, /id="caseDeleteConfirmTitle"/u);
        assert.match(template, /id="caseDeleteConfirmBody"/u);
        assert.match(template, /case-delete-confirm-cancel" autofocus/u);
    });

    it("offers Archive instead only when allowed, and deletes with a red button", () => {
        assert.match(template,
            /ng-if="\$ctrl\.canArchive"\s+ng-click="\$ctrl\.archiveInstead\(\)"/u);
        assert.match(template,
            /btn btn-danger case-delete-confirm-delete"\s+ng-if="!\$ctrl\.refusal"/u);
        assert.match(template, /ng-disabled="!\$ctrl\.canDelete\(\)"/u);
    });

    it("lists the designs, says while they load and when they could not", () => {
        assert.match(template, /class="case-delete-confirm-designs"/u);
        assert.match(template, /ng-repeat="design in \$ctrl\.designs track by design\.id"/u);
        assert.match(template, /'cases_delete_dialog_design_untitled'/u);
        assert.match(template, /ng-if="\$ctrl\.loading"/u);
        assert.match(template, /ng-if="\$ctrl\.loadFailed"/u);
        assert.match(template, /'cases_delete_dialog_copies'/u);
    });

    it("binds the title through the sanitized translation", () => {
        assert.match(template, /ng-bind-html="\(\(\$ctrl\.title/u);
    });

    it("has every key it uses in both locales", () => {
        const keys = [...template.matchAll(/'(cases_delete_[a-z_]+|cancel)'/gu)]
            .map(match => match[1]);
        assert.ok(keys.length > 10);
        for (const catalog of [locale("es_CL"), locale("en_US")]) {
            for (const key of keys) {
                assert.equal(typeof catalog[key], "string", key);
            }
        }
    });
});
