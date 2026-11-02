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

describe("DesignCatalogService.createDesign", () => {
    function createPostService(postOutcome) {
        const posts = [];
        const $http = async () => ({ data: { status: "ok" } });
        $http.get = async () => ({ data: { status: "ok", result: [] } });
        $http.post = async (url, body) => {
            posts.push({ url, body });
            return postOutcome();
        };
        const $rootScope = { $broadcast() {}, $emit() {}, $applyAsync(fn) { fn?.(); } };

        return { service: DesignCatalogService($rootScope, $http), posts };
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

    it("posts the design with its case and resolves the new id", async () => {
        const { service, posts } = createPostService(async () => ({
            data: { status: "ok", id: 31 },
        }));

        const design = { caseId: 3, languageCode: "es_CL", tags: [{ id: 9 }] };
        const designId = await service.createDesign(design);

        assert.equal(designId, 31);
        assert.equal(posts[0].url, "/designs");
        assert.equal(posts[0].body.caseId, 3);
        assert.deepEqual(posts[0].body.tagIds, [9]);
        assert.equal(service.designs[0], design);
    });

    it("rejects with the HTTP error when the case is refused (#924)", async () => {
        const rejection = { status: 404, data: { status: "err", code: "CASE_NOT_AVAILABLE" } };
        const { service } = createPostService(async () => { throw rejection; });

        await quietly(() => assert.rejects(service.createDesign({ caseId: 43 }),
            (error) => error === rejection));
        assert.deepEqual(service.designs, []);
    });

    it("rejects when the API answers without ok", async () => {
        const { service } = createPostService(async () => ({ data: { status: "err" } }));

        await quietly(() => assert.rejects(service.createDesign({}), /Failed to create design/u));
    });
});

describe("DesignCatalogService.getDesignAiServices", () => {
    function createGetService(getOutcome) {
        const gets = [];
        const $http = async () => ({ data: { status: "ok" } });
        $http.get = async (url) => {
            gets.push(url);
            return getOutcome();
        };
        const $rootScope = { $broadcast() {}, $emit() {}, $applyAsync(fn) { fn?.(); } };

        return { service: DesignCatalogService($rootScope, $http), gets };
    }

    it("resolves the design's services by phase (#969)", async () => {
        const services = [{ phaseNumber: 1, serviceId: "polyadic-bridge", canRun: false }];
        const { service, gets } = createGetService(async () => ({
            data: { status: "ok", services },
        }));

        assert.deepEqual(await service.getDesignAiServices(5), services);
        assert.deepEqual(gets, ["/designs/5/ai-services"]);
    });

    it("rejects with the HTTP error when the design cannot be launched", async () => {
        const rejection = { status: 404, data: { error: "Design not found." } };
        const { service } = createGetService(async () => { throw rejection; });

        await assert.rejects(service.getDesignAiServices(5), (error) => error === rejection);
    });

    it("rejects when the API answers without a list", async () => {
        const { service } = createGetService(async () => ({ data: { status: "ok" } }));

        await assert.rejects(service.getDesignAiServices(5), /Unexpected response format/u);
    });
});
