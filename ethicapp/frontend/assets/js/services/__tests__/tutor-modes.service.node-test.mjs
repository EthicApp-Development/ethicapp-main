import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TutorModesService } from "../tutor-modes.service.js";

const ok = questions => ({ data: { status: "ok", result: { sessionId: 7, questions } } });

function createService(handler) {
    const requests = [];
    const $http = {
        get: async (url) => {
            requests.push(url);
            return handler(url);
        },
    };
    return { service: TutorModesService($http), requests };
}

describe("TutorModesService.listTutorModes", () => {
    it("reads the activity's tutor sessions", async () => {
        const questions = [{ phaseId: 20, questionKey: "p2-q1", tutorMode: "basic" }];
        const { service, requests } = createService(async () => ok(questions));

        assert.deepEqual(await service.listTutorModes(7), questions);
        assert.deepEqual(requests, ["/activities/7/tutor-modes"]);
    });

    it("shares one request between simultaneous callers", async () => {
        const { service, requests } = createService(async () => ok([]));

        await Promise.all([service.listTutorModes(7), service.listTutorModes(7)]);
        await service.listTutorModes(7);

        assert.equal(requests.length, 2, "a later call reads again");
    });

    it("is empty for an activity the teacher cannot read", async () => {
        for (const status of [403, 404]) {
            const { service } = createService(async () => { throw { status }; });
            assert.deepEqual(await service.listTutorModes(7), []);
        }
    });

    it("rejects other failures and unexpected answers", async () => {
        const failing = createService(async () => { throw { status: 500 }; });
        await assert.rejects(failing.service.listTutorModes(7), error => error.status === 500);

        const malformed = createService(async () => ({ data: { status: "ok", result: {} } }));
        await assert.rejects(malformed.service.listTutorModes(7), /Unexpected tutor modes/u);
    });
});
