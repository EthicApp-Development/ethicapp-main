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

// ActivityCatalogService.setArchived (#1048, epic #1046): the explicit archive
// route, and the cached activity updated from its answer.
describe("ActivityCatalogService.setArchived", () => {
    function createArchiveService(respond) {
        const requests = [];
        const $http = async (request) => {
            requests.push(request);
            return respond(request);
        };
        const service = ActivityCatalogService($http);
        service.activities = [
            { sessionId: 41, archived: false },
            { sessionId: 42, archived: true },
        ];
        return { service, requests };
    }

    const answerAsked = request => ({
        data: { status: "ok", result: { id: 41, archived: request.data.archived } },
    });

    it("sends the flag it is asked for and caches the server's answer", async () => {
        const { service, requests } = createArchiveService(answerAsked);
        const updates = [];
        service.registerListener("onActivityCatalogUpdated", update => updates.push(update));

        assert.deepEqual(await service.setArchived(41, true), { id: 41, archived: true });
        assert.deepEqual(requests, [{
            method: "PATCH", url: "/activities/41/archive", data: { archived: true },
        }]);
        assert.equal(service.getActivities()[0].archived, true);
        assert.equal(updates.length, 1);
    });

    it("restores an activity, whatever form its session id has", async () => {
        const { service, requests } = createArchiveService(() => ({
            data: { status: "ok", result: { id: 42, archived: false } },
        }));

        await service.setArchived("42", false);

        assert.deepEqual(requests[0].data, { archived: false });
        assert.equal(service.getActivities()[1].archived, false);
    });

    it("leaves the flag as asked when the same request is sent twice", async () => {
        const { service } = createArchiveService(answerAsked);

        await service.setArchived(41, true);
        await service.setArchived(41, true);

        assert.equal(service.getActivities()[0].archived, true);
    });

    it("rejects with the server's refusal and leaves the cache as it was", async () => {
        const refusal = Object.assign(new Error("409"), {
            status: 409, data: { status: "err", code: "ACTIVITY_NOT_FINISHED" },
        });
        const { service } = createArchiveService(() => {
            throw refusal;
        });

        await assert.rejects(service.setArchived(41, true), refusal);
        assert.equal(service.getActivities()[0].archived, false);
    });
});

describe("ActivityCatalogService.loadActivities (#1055)", () => {
    const ROW = Object.freeze({
        sessionId: 41, designId: 7, designTitle: "Privacidad", caseId: null, caseTitle: null,
    });

    it("keeps the activities as GET /activities sends them", async () => {
        const { service, requests } = createService({
            "/activities": { data: { status: "ok", activities: [{ ...ROW }] } },
        });
        const updates = [];
        service.registerListener("onActivityCatalogUpdated", update => updates.push(update));

        assert.deepEqual(await service.loadActivities(), [ROW]);
        assert.deepEqual(requests.map(request => [request.method, request.url]),
            [["GET", "/activities"]]);
        assert.equal(Object.hasOwn(service.getActivities()[0], "title"), false,
            "no title copied from a design document");
        assert.equal(updates.length, 1);
    });

    it("answers an empty list when the request fails", async () => {
        const { service } = createService({ "/activities": new Error("500") });
        const errors = console.error;
        console.error = () => {};
        try {
            assert.deepEqual(await service.loadActivities(), []);
        } finally {
            console.error = errors;
        }
    });
});
