// The case form and the share switch both tell the design views which designs
// a case made private turned private (#934).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CasesCatalogService } from "../cases-catalog.service.js";

function createService(result) {
    const patches = [];
    const broadcasts = [];
    const $http = {
        async get() {
            return { data: { status: "ok", result: [] } };
        },
        async patch(url, body) {
            patches.push({ url, body });
            return { data: { status: "ok", result } };
        },
    };
    const $rootScope = {
        $broadcast(name, data) {
            broadcasts.push({ name, data });
        },
    };

    return { service: CasesCatalogService($rootScope, $http), patches, broadcasts };
}

const CASE_FORM = {
    title:      "A case",
    authors:    [],
    visibility: "private",
};

describe("CasesCatalogService.updateCase", () => {
    it("announces the designs the form's save turned private", async () => {
        const { service, patches, broadcasts } = createService({
            id: 41, visibility: "private", affectedDesignIds: [12, 13],
        });

        const result = await service.updateCase(41, CASE_FORM);

        assert.equal(patches[0].url, "/cases/41");
        assert.deepEqual(result.affectedDesignIds, [12, 13]);
        assert.deepEqual(broadcasts, [{
            name: "caseVisibilityUpdatedDesigns",
            data: { caseId: 41, affectedDesignIds: [12, 13], visibility: "private" },
        }]);
    });

    it("announces nothing when no design became private", async () => {
        const { service, broadcasts } = createService({
            id: 41, visibility: "public", affectedDesignIds: [],
        });

        await service.updateCase(41, { ...CASE_FORM, visibility: "public" });

        assert.deepEqual(broadcasts, []);
    });

    it("announces nothing for a server that does not report designs", async () => {
        const { service, broadcasts } = createService({ id: 41, visibility: "private" });

        await service.updateCase(41, CASE_FORM);

        assert.deepEqual(broadcasts, []);
    });
});

describe("CasesCatalogService.updateCaseVisibility", () => {
    it("announces the designs the switch turned private", async () => {
        const { service, patches, broadcasts } = createService({
            id: 41, visibility: "private", public: false, affectedDesignIds: [12],
        });

        await service.updateCaseVisibility(41, "private");

        assert.deepEqual(patches[0], {
            url:  "/cases/41/visibility",
            body: { visibility: "private" },
        });
        assert.deepEqual(broadcasts, [{
            name: "caseVisibilityUpdatedDesigns",
            data: { caseId: 41, affectedDesignIds: [12], visibility: "private" },
        }]);
    });

    it("announces nothing when the case is made public", async () => {
        const { service, broadcasts } = createService({
            id: 41, visibility: "public", public: true, affectedDesignIds: [],
        });

        await service.updateCaseVisibility(41, "public");

        assert.deepEqual(broadcasts, []);
    });
});

describe("CasesCatalogService and the designs that keep a case (#939)", () => {
    it("hands the form's caller the count of other teachers' designs", async () => {
        const { service, broadcasts } = createService({
            id: 41, visibility: "private", affectedDesignIds: [], designsKeepingAccess: 2,
        });

        const result = await service.updateCase(41, CASE_FORM);

        assert.equal(result.designsKeepingAccess, 2);
        assert.deepEqual(broadcasts, []);
    });

    it("hands the switch's caller the count of other teachers' designs", async () => {
        const { service } = createService({
            id:                   41,
            visibility:           "private",
            public:               false,
            affectedDesignIds:    [12],
            designsKeepingAccess: 0,
        });

        const result = await service.updateCaseVisibility(41, "private");

        assert.equal(result.designsKeepingAccess, 0);
        assert.deepEqual(result.affectedDesignIds, [12]);
    });

    it("sends the visibility the author chose, and only that, to the switch endpoint", async () => {
        const { service, patches } = createService({
            id:                   41,
            visibility:           "public",
            public:               true,
            affectedDesignIds:    [],
            designsKeepingAccess: 1,
        });

        await service.updateCaseVisibility(41, "public");

        assert.deepEqual(patches[0].body, { visibility: "public" });
    });
});

describe("CasesCatalogService.updateCaseSharing (#1014)", () => {
    // The publication modal's model: the whole case form, of which only the
    // sharing fields are sent.
    const MODAL_FORM = {
        title:               "A case",
        authors:             [{ authorFirstname: "Ada", authorEmail: "ada@example.test" }],
        currentPdfPath:      "/uploads/cases/41/case.pdf",
        visibility:          "public",
        licenseCode:         "CC-BY-SA-4.0",
        attributionText:     "By Ada",
        rightsStatus:        "used_with_permission",
        licenseNotes:        "Notes",
        permissionStatement: "Granted",
        commercialSource:    "",
        languageCode:        "en_US",
    };

    it("sends only the sharing fields, as JSON, to the sharing endpoint", async () => {
        const { service, patches } = createService({
            id: 41, visibility: "public", affectedDesignIds: [],
        });

        await service.updateCaseSharing(41, MODAL_FORM);

        assert.deepEqual(patches[0], {
            url:  "/cases/41/sharing",
            body: {
                visibility:          "public",
                licenseCode:         "CC-BY-SA-4.0",
                attributionText:     "By Ada",
                rightsStatus:        "used_with_permission",
                licenseNotes:        "Notes",
                permissionStatement: "Granted",
                commercialSource:    "",
            },
        });
    });

    it("fills the defaults of the case form for empty fields", async () => {
        const { service, patches } = createService({ id: 41, visibility: "private" });

        await service.updateCaseSharing(41, {});

        assert.deepEqual(patches[0].body, {
            visibility:          "private",
            licenseCode:         "CC-BY-NC-SA-4.0",
            attributionText:     "",
            rightsStatus:        "own_work",
            licenseNotes:        "",
            permissionStatement: "",
            commercialSource:    "",
        });
    });

    it("announces the designs the save turned private and hands back the answer", async () => {
        const { service, broadcasts } = createService({
            id: 41, visibility: "private", affectedDesignIds: [12], designsKeepingAccess: 2,
        });

        const result = await service.updateCaseSharing(41, {
            ...MODAL_FORM,
            visibility: "private",
        });

        assert.equal(result.designsKeepingAccess, 2);
        assert.deepEqual(broadcasts, [{
            name: "caseVisibilityUpdatedDesigns",
            data: { caseId: 41, affectedDesignIds: [12], visibility: "private" },
        }]);
    });
});

describe("CasesCatalogService.getCaseUses (#1012)", () => {
    function createUsesService(answer) {
        const gets = [];
        const $http = {
            async get(url, config) {
                gets.push({ url, config });
                return answer();
            },
        };
        return { service: CasesCatalogService({ $broadcast() {} }, $http), gets };
    }

    it("reads the case's uses and hands back the answer's result", async () => {
        const uses = {
            ownDesigns:           [{ id: 12, title: "Mine", archived: false }],
            activityCount:        3,
            otherDesignCount:     2,
            otherTeacherCount:    1,
            designsKeepingAccess: 2,
        };
        const { service, gets } = createUsesService(() => ({
            data: { status: "ok", result: uses },
        }));

        const result = await service.getCaseUses(41);

        assert.deepEqual(gets, [{ url: "/cases/41/uses", config: undefined }]);
        assert.deepEqual(result, uses);
    });

    it("leaves the cached lists alone", async () => {
        const { service, gets } = createUsesService(() => ({
            data: { status: "ok", result: { ownDesigns: [], activityCount: 0 } },
        }));

        await service.getCaseUses(41);

        assert.equal(gets.length, 1);
        assert.deepEqual(service.cases, []);
    });

    it("rejects with the answer of a case the teacher cannot read", async () => {
        const notFound = { status: 404, data: { status: "err", code: "CASE_NOT_FOUND" } };
        const { service } = createUsesService(() => {
            throw notFound;
        });

        await assert.rejects(service.getCaseUses(999), error => error === notFound);
    });
});
