import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DesignAnalysesService } from "../design-analyses.service.js";

function httpError(status, code = `HTTP_${status}`) {
    return { status, data: { status: "err", code } };
}

function createService(handlers = {}) {
    const requests = [];
    const respond = (method) => async (url, body) => {
        requests.push({ method, url, body });
        const handler = handlers[method];
        if (!handler) {
            throw new Error(`Unexpected ${method} ${url}`);
        }
        return handler(url, body);
    };
    const $http = { get: respond("get"), post: respond("post") };

    return { service: DesignAnalysesService($http), requests };
}

const ok = result => ({ data: { status: "ok", result } });

describe("DesignAnalysesService.getAnalysis", () => {
    it("reads one analysis with encoded ids", async () => {
        const detail = { serviceId: "case-analyst-claim-typology", status: "ready", document: {} };
        const { service, requests } = createService({ get: async () => ok(detail) });

        assert.deepEqual(await service.getAnalysis(12, "case-analyst-claim-typology"), detail);
        assert.deepEqual(requests.map(({ method, url }) => [method, url]), [
            ["get", "/designs/12/analyses/case-analyst-claim-typology"],
        ]);
    });

    it("is null when the design has no such analysis or is not the teacher's", async () => {
        for (const status of [403, 404]) {
            const { service } = createService({ get: async () => { throw httpError(status); } });
            assert.equal(await service.getAnalysis(12, "svc"), null);
        }
    });

    it("rejects on other errors and unexpected responses", async () => {
        const failing = createService({ get: async () => { throw httpError(500); } });
        await assert.rejects(failing.service.getAnalysis(12, "svc"), error => error.status === 500);

        const malformed = createService({ get: async () => ({ data: { status: "err" } }) });
        await assert.rejects(malformed.service.getAnalysis(12, "svc"), /Unexpected design analysis/);
    });
});

describe("DesignAnalysesService.generateAnalysis", () => {
    it("reports an accepted generation with the reserved analysis", async () => {
        const reserved = { serviceId: "svc", status: "requested" };
        const { service, requests } = createService({ post: async () => ok(reserved) });

        assert.deepEqual(await service.generateAnalysis(12, "svc"), { outcome: "accepted", analysis: reserved });
        assert.deepEqual(requests.map(({ method, url }) => [method, url]), [
            ["post", "/designs/12/analyses/svc/generate"],
        ]);
    });

    it("tells the refusals apart", async () => {
        const cases = [
            [httpError(409, "DESIGN_LOCKED"), "locked"],
            [httpError(409, "DESIGN_ANALYSIS_PROCESSING"), "busy"],
            [httpError(409, "DESIGN_ANALYSIS_NOT_APPLICABLE"), "not-applicable"],
            [httpError(409, "DESIGN_CHANGED"), "changed"],
            [httpError(503, "DESIGN_ANALYSIS_SERVICE_DISABLED"), "disabled"],
        ];

        for (const [error, outcome] of cases) {
            const { service } = createService({ post: async () => { throw error; } });
            assert.deepEqual(await service.generateAnalysis(12, "svc"), { outcome, analysis: null });
        }

        const failing = createService({ post: async () => { throw httpError(404); } });
        await assert.rejects(failing.service.generateAnalysis(12, "svc"), error => error.status === 404);
    });
});
