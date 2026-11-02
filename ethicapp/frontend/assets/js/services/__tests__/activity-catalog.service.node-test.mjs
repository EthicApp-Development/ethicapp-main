// ActivityCatalogService.createActivity (#972, epic #965): the launch's two
// requests, the AI services switch, and failures the launch wizard can name.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    ActivityCatalogService,
    LaunchActivityError,
} from "../activity-catalog.service.js";

const DESIGN = { id: 7, type: "semantic_differential", metainfo: { title: "Privacidad" } };

function createService(responses) {
    const requests = [];
    const $http = async (request) => {
        requests.push(request);
        const next = responses[request.url];
        if (next instanceof Error) {
            throw next;
        }
        return next;
    };
    return { service: ActivityCatalogService($http), requests };
}

const ok = {
    "/sessions":   { data: { status: "ok", id: 41 } },
    "/activities": { data: { status: "ok", activity: { sessionid: 41 }, servicesNotRunning: [] } },
};

describe("ActivityCatalogService.createActivity", () => {
    it("creates the session and the activity, keeping the design's services on by default", async () => {
        const { service, requests } = createService(ok);

        assert.equal(await service.createActivity(DESIGN, "Sección 3"), 41);
        assert.deepEqual(requests.map(request => [request.method, request.url]), [
            ["POST", "/sessions"],
            ["POST", "/activities"],
        ]);
        assert.deepEqual(requests[0].data, {
            name: "Privacidad", description: "Sección 3", type: "T", additionalConfig: {},
        });
        assert.deepEqual(requests[1].data, { sessionId: 41, designId: 7 });
        assert.equal(service.getActivities().length, 1);
    });

    it("sends aiServices false when the teacher turned them off", async () => {
        const { service, requests } = createService(ok);
        await service.createActivity(DESIGN, "Sección 3", { aiServices: false });
        assert.deepEqual(requests[1].data, { sessionId: 41, designId: 7, aiServices: false });
    });

    it("rejects with the failed request, its status and the server's code", async () => {
        const sessionFailure = Object.assign(new Error("400"), {
            status: 400, data: { code: "ACTIVITY_DESCRIPTION_REQUIRED" },
        });
        const { service } = createService({ ...ok, "/sessions": sessionFailure });

        await assert.rejects(service.createActivity(DESIGN, " "), (error) => {
            assert.ok(error instanceof LaunchActivityError);
            assert.equal(error.stage, "session");
            assert.equal(error.status, 400);
            assert.equal(error.code, "ACTIVITY_DESCRIPTION_REQUIRED");
            return true;
        });
    });

    it("names the activity request when it fails", async () => {
        const activityFailure = Object.assign(new Error("404"), { status: 404, data: { error: "Design not found." } });
        const { service } = createService({ ...ok, "/activities": activityFailure });

        await assert.rejects(service.createActivity(DESIGN, "Sección 3"), (error) => {
            assert.equal(error.stage, "activity");
            assert.equal(error.status, 404);
            assert.equal(error.code, null);
            return true;
        });
    });
});
