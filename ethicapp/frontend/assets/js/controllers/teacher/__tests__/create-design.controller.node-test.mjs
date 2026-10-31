// The create-design page when the server refuses the selected case (#924):
// it explains why and clears the case. AngularJS services are fakes.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CreateDesignController } from "../create_design.controller.js";

const CASE = Object.freeze({ id: 43, title: "A case" });

function createController(createDesign) {
    const navigations = [];
    const created = [];
    const $scope = {
        $applyAsync(fn) {
            fn?.();
        },
        navigateTo(path) {
            navigations.push(path);
        },
    };
    const DesignCatalogService = {
        async createDesign(design) {
            created.push(design);
            return createDesign(design);
        },
    };
    const UserInformationService = {
        getUserInformation: async () => ({ name: "Teacher", email: "t@example.org" }),
    };
    const LanguageCatalogService = {
        getLanguages:           async () => [],
        getDefaultLanguageCode: (languages, fallback) => fallback,
    };

    const vm = {};
    CreateDesignController.call(vm, $scope, { history: { length: 1 } },
        DesignCatalogService, UserInformationService, LanguageCatalogService);
    return { vm, navigations, created };
}

async function quietly(action) {
    const originalError = console.error;
    console.error = () => {};
    try {
        return await action();
    } finally {
        console.error = originalError;
    }
}

describe("CreateDesignController.uploadDesign", () => {
    it("sends the selected case and opens the new design", async () => {
        const { vm, navigations, created } = createController(async () => 31);
        vm.selectCase(CASE);

        await vm.uploadDesign("A design", "semantic_differential");

        assert.equal(created[0].caseId, CASE.id);
        assert.deepEqual(navigations, ["/designs/31/edit"]);
        assert.equal(vm.caseErrorKey, null);
    });

    it("explains a refused case and clears it (#924)", async () => {
        const rejection = { status: 404, data: { status: "err", code: "CASE_NOT_AVAILABLE" } };
        const { vm, navigations } = createController(async () => {
            throw rejection;
        });
        vm.selectCase(CASE);

        await quietly(() => vm.uploadDesign("A design", "semantic_differential"));

        assert.equal(vm.associatedCase, null);
        assert.equal(vm.caseErrorKey, "save_design_case_not_available");
        assert.deepEqual(navigations, []);
    });

    it("hides the message once another case is picked or the design is sent again", async () => {
        const rejection = { status: 404, data: { code: "CASE_NOT_AVAILABLE" } };
        let outcome = async () => {
            throw rejection;
        };
        const { vm, created } = createController(() => outcome());
        vm.selectCase(CASE);
        await quietly(() => vm.uploadDesign("A design", "semantic_differential"));

        vm.selectCase({ id: 41, title: "Another case" });
        assert.equal(vm.caseErrorKey, null);

        vm.clearAssociatedCase();
        outcome = async () => 32;
        await vm.uploadDesign("A design", "semantic_differential");
        assert.equal(created.at(-1).caseId, null, "created without a case");
        assert.equal(vm.caseErrorKey, null);
    });

    it("keeps the case and shows nothing for other failures", async () => {
        const { vm, navigations } = createController(async () => {
            throw { status: 500, data: { status: "err" } };
        });
        vm.selectCase(CASE);

        await quietly(() => vm.uploadDesign("A design", "semantic_differential"));

        assert.equal(vm.associatedCase, CASE);
        assert.equal(vm.caseErrorKey, null);
        assert.deepEqual(navigations, []);
    });
});
