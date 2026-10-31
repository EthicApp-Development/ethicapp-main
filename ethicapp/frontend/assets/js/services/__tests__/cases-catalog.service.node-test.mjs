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
