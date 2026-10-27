import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CaseAnalysesService } from "../case-analyses.service.js";

function httpError(status) {
    return { status, data: { status: "err", code: `HTTP_${status}` } };
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
    const $http = { get: respond("get"), post: respond("post"), put: respond("put") };

    return { service: CaseAnalysesService($http), requests };
}

const ok = result => ({ data: { status: "ok", result } });

describe("CaseAnalysesService.listAnalyses", () => {
    it("reads the list of the case", async () => {
        const list = [{ serviceId: "mock-case-analysis", status: "ready" }];
        const { service, requests } = createService({ get: async () => ok(list) });

        assert.deepEqual(await service.listAnalyses(7), list);
        assert.deepEqual(requests.map(({ method, url }) => [method, url]), [
            ["get", "/cases/7/analyses"],
        ]);
    });

    it("treats a case the teacher cannot read as a case without analyses", async () => {
        for (const status of [403, 404]) {
            const { service } = createService({ get: async () => { throw httpError(status); } });
            assert.deepEqual(await service.listAnalyses(7), []);
        }
    });

    it("rejects on other errors and unexpected responses", async () => {
        const failing = createService({ get: async () => { throw httpError(500); } });
        await assert.rejects(failing.service.listAnalyses(7), error => error.status === 500);

        const malformed = createService({ get: async () => ({ data: { status: "err" } }) });
        await assert.rejects(
            malformed.service.listAnalyses(7),
            /Unexpected case analyses response/
        );
    });
});

describe("CaseAnalysesService.getAnalysis", () => {
    it("reads one analysis with an encoded service id", async () => {
        const detail = { serviceId: "svc/a", document: { wordCount: 3 } };
        const { service, requests } = createService({ get: async () => ok(detail) });

        assert.deepEqual(await service.getAnalysis(7, "svc/a"), detail);
        assert.equal(requests[0].url, "/cases/7/analyses/svc%2Fa");
    });
});

describe("CaseAnalysesService.generateAnalysis", () => {
    it("returns the reserved analysis when the generation is accepted", async () => {
        const reserved = { serviceId: "mock-case-analysis", status: "requested" };
        const { service, requests } = createService({ post: async () => ok(reserved) });

        assert.deepEqual(await service.generateAnalysis(7, "mock-case-analysis"), {
            outcome:  "accepted",
            analysis: reserved,
        });
        assert.deepEqual(requests.map(({ method, url }) => [method, url]), [
            ["post", "/cases/7/analyses/mock-case-analysis/generate"],
        ]);
    });

    it("reports a generation in flight (409) and a disabled service (503)", async () => {
        const busy = createService({ post: async () => { throw httpError(409); } });
        assert.deepEqual(await busy.service.generateAnalysis(7, "svc"), {
            outcome:  "busy",
            analysis: null,
        });

        const disabled = createService({ post: async () => { throw httpError(503); } });
        assert.deepEqual(await disabled.service.generateAnalysis(7, "svc"), {
            outcome:  "disabled",
            analysis: null,
        });
    });

    it("rejects on other errors", async () => {
        const { service } = createService({ post: async () => { throw httpError(500); } });
        await assert.rejects(service.generateAnalysis(7, "svc"), error => error.status === 500);
    });
});

describe("CaseAnalysesService.saveAnalysis", () => {
    it("sends the edited document", async () => {
        const saved = { serviceId: "svc", status: "ready", document: { wordCount: 2 } };
        const { service, requests } = createService({ put: async () => ok(saved) });

        assert.deepEqual(await service.saveAnalysis(7, "svc", { wordCount: 2 }), saved);
        assert.deepEqual(requests[0], {
            method: "put",
            url:    "/cases/7/analyses/svc",
            body:   { document: { wordCount: 2 } },
        });
    });
});
