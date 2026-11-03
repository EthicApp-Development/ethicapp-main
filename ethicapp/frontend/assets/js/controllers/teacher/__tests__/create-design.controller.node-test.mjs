// The create-design page when the server refuses the selected case (#924):
// it explains why and clears the case. And the case of the URL
// (`?caseId=`, #1019): preselected when the teacher may associate it, else
// explained. AngularJS services are fakes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { CreateDesignController } from "../create_design.controller.js";

const CASE = Object.freeze({ id: 43, title: "A case" });
const TEACHER_ID = 650;

function fakeLocation(search) {
    const location = {
        searchValue: { ...search },
        replaced:    false,
        search(key, value) {
            if (key === undefined) {
                return location.searchValue;
            }
            if (value === null) {
                delete location.searchValue[key];
            } else {
                location.searchValue[key] = value;
            }
            return location;
        },
        replace() {
            location.replaced = true;
            return location;
        },
    };
    return location;
}

function createController(createDesign = async () => 31, {
    search = {}, getCaseById = async () => {
        throw { status: 404 };
    },
} = {}) {
    const navigations = [];
    const created = [];
    const caseRequests = [];
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
        getUserInformation: async () => ({
            id: TEACHER_ID, name: "Teacher", email: "t@example.org",
        }),
    };
    const LanguageCatalogService = {
        getLanguages:           async () => [],
        getDefaultLanguageCode: (languages, fallback) => fallback,
    };
    const $location = fakeLocation(search);
    const CasesCatalogService = {
        async getCaseById(caseId) {
            caseRequests.push(caseId);
            return getCaseById(caseId);
        },
    };

    const vm = {};
    CreateDesignController.call(vm, $scope, { history: { length: 1 } },
        DesignCatalogService, UserInformationService, LanguageCatalogService,
        $location, CasesCatalogService);
    return { vm, navigations, created, caseRequests, $location };
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

describe("CreateDesignController, the case of the URL (#1019)", () => {
    const ownCase = Object.freeze({
        id: 7, title: "Own case", creator: TEACHER_ID, visibility: "private", archived: false,
    });
    const sharedCase = Object.freeze({
        id: 8, title: "Shared case", creator: 9, visibility: "public", archived: false,
    });

    function withCase(caseItem) {
        return async () => caseItem;
    }

    it("starts with no case and loads none without the parameter", async () => {
        const { vm, caseRequests, $location } = createController();
        await vm.ready;

        assert.equal(vm.associatedCase, null);
        assert.equal(vm.caseErrorKey, null);
        assert.equal(vm.caseLoading, false);
        assert.deepEqual(caseRequests, []);
        assert.equal($location.replaced, false);
    });

    it("preselects the teacher's own case that is not archived", async () => {
        const { vm, caseRequests } = createController(undefined, {
            search: { caseId: "7" }, getCaseById: withCase(ownCase),
        });
        assert.equal(vm.caseLoading, true);
        await vm.ready;

        assert.deepEqual(caseRequests, [7]);
        assert.equal(vm.associatedCase, ownCase);
        assert.equal(vm.caseErrorKey, null);
        assert.equal(vm.caseLoading, false);
    });

    it("preselects another teacher's public case, and saves the design with it", async () => {
        const { vm, created, navigations } = createController(async () => 33, {
            search: { caseId: "8" }, getCaseById: withCase(sharedCase),
        });
        await vm.ready;
        assert.equal(vm.associatedCase, sharedCase);

        await vm.uploadDesign("A design", "semantic_differential");
        assert.equal(created[0].caseId, 8);
        assert.deepEqual(navigations, ["/designs/33/edit"]);
    });

    it("removes the parameter from the URL once read, replacing the history entry", async () => {
        const { vm, $location } = createController(undefined, {
            search: { caseId: "7" }, getCaseById: withCase(ownCase),
        });
        await vm.ready;

        assert.deepEqual($location.searchValue, {});
        assert.equal($location.replaced, true);
    });

    it("does not preselect the teacher's archived case, and says it is archived", async () => {
        const { vm } = createController(undefined, {
            search: { caseId: "7" }, getCaseById: withCase({ ...ownCase, archived: true }),
        });
        await vm.ready;

        assert.equal(vm.associatedCase, null);
        assert.equal(vm.caseErrorKey, "design_new_from_case_archived");
    });

    it("does not preselect another teacher's private case it can read", async () => {
        const { vm } = createController(undefined, {
            search:      { caseId: "8" },
            getCaseById: withCase({ ...sharedCase, visibility: "private" }),
        });
        await vm.ready;

        assert.equal(vm.associatedCase, null);
        assert.equal(vm.caseErrorKey, "design_new_from_case_not_available");
    });

    it("does not preselect a case it cannot read or that is missing", async () => {
        const { vm } = createController(undefined, { search: { caseId: "404" } });
        await quietlyWarn(() => vm.ready);

        assert.equal(vm.associatedCase, null);
        assert.equal(vm.caseErrorKey, "design_new_from_case_not_available");
        assert.equal(vm.caseLoading, false);
    });

    it("says when the case could not be loaded", async () => {
        const { vm } = createController(undefined, {
            search:      { caseId: "7" },
            getCaseById: async () => {
                throw { status: 500 };
            },
        });
        await quietlyWarn(() => vm.ready);

        assert.equal(vm.associatedCase, null);
        assert.equal(vm.caseErrorKey, "design_new_from_case_load_failed");
    });

    it("does not load a non-numeric id, and says the case is not available", async () => {
        for (const caseId of ["abc", "-1", "7.5"]) {
            const { vm, caseRequests, $location } = createController(undefined, {
                search: { caseId }, getCaseById: withCase(ownCase),
            });
            await vm.ready;

            assert.deepEqual(caseRequests, [], caseId);
            assert.equal(vm.associatedCase, null, caseId);
            assert.equal(vm.caseErrorKey, "design_new_from_case_not_available", caseId);
            assert.deepEqual($location.searchValue, {}, caseId);
        }
    });

    it("keeps the teacher's choice when they pick or remove a case before it loads", async () => {
        for (const choose of [vm => vm.selectCase(CASE), vm => vm.clearAssociatedCase()]) {
            let resolveCase;
            const { vm } = createController(undefined, {
                search:      { caseId: "7" },
                getCaseById: () => new Promise(resolve => {
                    resolveCase = resolve;
                }),
            });
            await Promise.resolve();
            choose(vm);
            resolveCase(ownCase);
            await vm.ready;

            assert.notEqual(vm.associatedCase, ownCase);
            assert.equal(vm.caseErrorKey, null);
            assert.equal(vm.caseLoading, false);
        }
    });

    it("lets the teacher remove the preselected case or choose another, as today", async () => {
        const { vm, created } = createController(async () => 34, {
            search: { caseId: "7" }, getCaseById: withCase(ownCase),
        });
        await vm.ready;

        vm.clearAssociatedCase();
        assert.equal(vm.associatedCase, null);
        vm.selectCase(sharedCase);
        await vm.uploadDesign("A design", "semantic_differential");
        assert.equal(created[0].caseId, 8);
    });

    it("hides the refusal once the teacher picks a case", async () => {
        const { vm } = createController(undefined, {
            search: { caseId: "7" }, getCaseById: withCase({ ...ownCase, archived: true }),
        });
        await vm.ready;
        assert.equal(vm.caseErrorKey, "design_new_from_case_archived");

        vm.selectCase(sharedCase);
        assert.equal(vm.caseErrorKey, null);
        assert.equal(vm.associatedCase, sharedCase);
    });
});

describe("design.new.html (#1019)", () => {
    const template = readFileSync(new URL(
        "../../../../static/views/teacher/design.new.html", import.meta.url), "utf8");

    it("shows the case's loading and the refusal under the selector, and waits to submit", () => {
        assert.match(template,
            /class="help-block design-new-case-loading" ng-if="cdc\.caseLoading"/u);
        assert.match(template,
            /class="text-danger design-new-case-error" role="alert" ng-if="cdc\.caseErrorKey"/u);
        assert.match(template, /type="submit" ng-disabled="cdc\.caseLoading"/u);
    });
});

async function quietlyWarn(action) {
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
        return await action();
    } finally {
        console.warn = originalWarn;
    }
}
