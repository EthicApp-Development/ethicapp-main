// The case forms ask the author to confirm before a case becomes public, and
// tell the author, once a public case is private again, how many designs of
// other teachers keep it (#939, epic #923). Cancelling changes nothing: the
// new case is not created and the edited case is not saved. The edit form
// locks the content of a case in use. AngularJS services are fakes.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CasesController } from "../cases.controller.js";

const CASE_ID = 41;

function createController({ confirmAnswer = true, saved = {}, loaded = {} } = {}) {
    const navigations = [];
    const toasts = [];
    const confirmations = [];
    const calls = { createCase: [], updateCase: [] };

    const $scope = {
        $applyAsync(fn) {
            fn?.();
        },
        $on() {},
        navigateTo(path) {
            navigations.push(path);
        },
    };
    const $translate = {
        instant(key, values) {
            return values ? `${key}(${values.count})` : key;
        },
    };
    const toast = {
        create(options) {
            toasts.push(options);
        },
    };
    const CasesCatalogService = {
        async createCase(form) {
            calls.createCase.push({ ...form });
            return { id: CASE_ID };
        },
        async updateCase(caseId, form) {
            calls.updateCase.push({ caseId, visibility: form.visibility });
            return { id: caseId, visibility: form.visibility, ...saved };
        },
        async getCaseById(caseId) {
            return { id: caseId, title: "Datos de pacientes", visibility: "private", ...loaded };
        },
        async getLicenses() {
            return [];
        },
    };
    const LanguageCatalogService = {
        getDefaultLanguageCode: (languages, fallback) => fallback,
        async getLanguages() {
            return [];
        },
    };
    const UserProfileService = {
        async getProfile() {
            return { email: "teacher@example.org" };
        },
    };
    const CasePublicationNoticeService = {
        async confirm() {
            confirmations.push(true);
            return confirmAnswer;
        },
    };

    const vm = {};
    CasesController.call(vm, $scope, { id: String(CASE_ID) }, { history: { length: 1 } },
        $translate, toast, CasesCatalogService, LanguageCatalogService, UserProfileService,
        CasePublicationNoticeService);
    return { vm, navigations, toasts, confirmations, calls };
}

function toastMessages(toasts) {
    return toasts.map(entry => entry.message);
}

describe("CasesController.createCase (#939)", () => {
    it("creates a public case once the author confirms", async () => {
        const { vm, calls, confirmations, navigations } = createController({ confirmAnswer: true });
        vm.form.visibility = "public";

        await vm.createCase();

        assert.equal(confirmations.length, 1);
        assert.equal(calls.createCase.length, 1);
        assert.equal(calls.createCase[0].visibility, "public");
        assert.deepEqual(navigations, ["/cases"]);
    });

    it("creates nothing and keeps the chosen visibility when the author cancels", async () => {
        const { vm, calls, confirmations, navigations, toasts } = createController({
            confirmAnswer: false,
        });
        vm.form.visibility = "public";

        await vm.createCase();

        assert.equal(confirmations.length, 1);
        assert.deepEqual(calls.createCase, []);
        assert.equal(vm.form.visibility, "public");
        assert.deepEqual(navigations, []);
        assert.deepEqual(toasts, []);
    });

    it("creates a private case without asking", async () => {
        const { vm, calls, confirmations } = createController({ confirmAnswer: false });

        await vm.createCase();

        assert.equal(confirmations.length, 0);
        assert.equal(calls.createCase.length, 1);
    });
});

describe("CasesController.updateCase (#939)", () => {
    function editing(visibility, options) {
        const context = createController(options);
        context.vm.caseObj = { id: CASE_ID, visibility };
        context.vm.form.visibility = visibility;
        return context;
    }

    it("publishes a private case once the author confirms, and asks only once", async () => {
        const { vm, calls, confirmations } = editing("private", { confirmAnswer: true });
        vm.form.visibility = "public";

        await vm.updateCase();
        await vm.updateCase();

        assert.equal(confirmations.length, 1);
        assert.deepEqual(calls.updateCase, [
            { caseId: CASE_ID, visibility: "public" },
            { caseId: CASE_ID, visibility: "public" },
        ]);
        assert.equal(vm.caseObj.visibility, "public");
    });

    it("saves nothing when the author cancels the publication", async () => {
        const { vm, calls, confirmations, toasts } = editing("private", { confirmAnswer: false });
        vm.form.visibility = "public";

        await vm.updateCase();

        assert.equal(confirmations.length, 1);
        assert.deepEqual(calls.updateCase, []);
        assert.equal(vm.form.visibility, "public");
        assert.equal(vm.caseObj.visibility, "private");
        assert.deepEqual(toasts, []);
    });

    it("saves a case that stays public without asking", async () => {
        const { vm, calls, confirmations } = editing("public", { confirmAnswer: false });

        await vm.updateCase();

        assert.equal(confirmations.length, 0);
        assert.equal(calls.updateCase.length, 1);
    });

    it("tells the author how many designs of other teachers keep a case made private", async () => {
        const { vm, confirmations, toasts } = editing("public", {
            saved: { affectedDesignIds: [12], designsKeepingAccess: 3 },
        });
        vm.form.visibility = "private";

        await vm.updateCase();

        assert.equal(confirmations.length, 0);
        assert.deepEqual(toastMessages(toasts), [
            "ethical_cases_update_success",
            "ethical_cases_designs_made_private_one(1) "
                + "ethical_cases_designs_keeping_access_other(3)",
        ]);
        assert.equal(toasts[1].timeout, 12000);
    });

    it("tells the author when no other teacher keeps a case made private", async () => {
        const { vm, toasts } = editing("public", {
            saved: { affectedDesignIds: [], designsKeepingAccess: 0 },
        });
        vm.form.visibility = "private";

        await vm.updateCase();

        assert.deepEqual(toastMessages(toasts), [
            "ethical_cases_update_success",
            "ethical_cases_designs_keeping_access_none(0)",
        ]);
    });

    it("says nothing about access when a private case is saved again", async () => {
        const { vm, toasts } = editing("private", {
            saved: { affectedDesignIds: [], designsKeepingAccess: 2 },
        });

        await vm.updateCase();

        assert.deepEqual(toastMessages(toasts), ["ethical_cases_update_success"]);
    });
});

describe("CasesController.loadCase", () => {
    it("locks the form of a case in use, as GET /cases/:id says", async () => {
        const { vm } = createController({ loaded: { hasLaunchedDesignActivity: true } });

        await vm.loadCase();

        assert.equal(vm.form.title, "Datos de pacientes");
        assert.equal(vm.form.hasLaunchedDesignActivity, true);
    });

    it("leaves the form of a case not in use editable", async () => {
        const { vm } = createController();

        await vm.loadCase();

        assert.equal(vm.form.hasLaunchedDesignActivity, false);
    });
});
