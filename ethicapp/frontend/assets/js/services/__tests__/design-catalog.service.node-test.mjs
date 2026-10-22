import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DesignCatalogService } from "../design-catalog.service.js";

function createService(patchOutcome) {
    const requests = [];
    const $http = async (config) => {
        requests.push(config);
        return patchOutcome();
    };
    $http.get = async () => ({ data: { status: "ok", result: [] } });
    const $rootScope = { $broadcast() {}, $emit() {}, $applyAsync(fn) { fn?.(); } };

    return { service: DesignCatalogService($rootScope, $http), requests };
}

describe("DesignCatalogService.updateDesign", () => {
    it("sends a PATCH and resolves true when the design is saved", async () => {
        const { service, requests } = createService(async () => ({ data: { status: "ok" } }));

        const design = { caseId: 3, languageCode: "es_CL", tags: [{ id: 9 }] };
        const saved = await service.updateDesign(5, design);

        assert.equal(saved, true);
        assert.equal(requests[0].url, "/designs/5");
        assert.equal(requests[0].method, "PATCH");
        assert.deepEqual(requests[0].data.tagIds, [9]);
    });

    it("rejects with the HTTP error when the save is refused (#730)", async () => {
        const rejection = { status: 409, data: { status: "err", code: "DESIGN_LOCKED" } };
        const { service } = createService(async () => { throw rejection; });
        const originalError = console.error;
        console.error = () => {};

        try {
            await assert.rejects(service.updateDesign(5, {}), (error) => error === rejection);
        } finally {
            console.error = originalError;
        }
    });

    it("rejects when the API answers without ok", async () => {
        const { service } = createService(async () => ({ data: { status: "err" } }));
        const originalError = console.error;
        console.error = () => {};

        try {
            await assert.rejects(service.updateDesign(5, {}), /Failed to update design/u);
        } finally {
            console.error = originalError;
        }
    });
});
