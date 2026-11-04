// The home's recent activities (#918, #1055): the newest three activities in
// progress or not started, then the newest three finished, none archived.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RECENT_ACTIVITIES_LIMIT, recentActivities } from "../recent-activities.js";

function activity(sessionId, fields = {}) {
    return {
        sessionId,
        time:     `2026-10-${String(10 + sessionId).padStart(2, "0")}T12:00:00Z`,
        status:   "in_progress",
        archived: false,
        ...fields,
    };
}

const ids = list => list.map(item => item.sessionId);

describe("recentActivities", () => {
    it("lists the newest activities in progress or not started, then the finished ones", () => {
        const recent = recentActivities([
            activity(1),
            activity(2, { status: "initiated" }),
            activity(3, { status: "finished" }),
            activity(4, { status: 3 }),
            activity(5, { status: "finished", archived: true }),
            activity(6, { archived: true }),
        ]);

        assert.deepEqual(ids(recent.ongoing), [2, 1]);
        assert.deepEqual(ids(recent.finished), [4, 3]);
    });

    it("keeps three of each kind", () => {
        const many = [1, 2, 3, 4, 5].flatMap(id => [
            activity(id),
            activity(id + 10, { status: "finished", time: `2026-09-0${id}T12:00:00Z` }),
        ]);
        const recent = recentActivities(many);

        assert.equal(RECENT_ACTIVITIES_LIMIT, 3);
        assert.deepEqual(ids(recent.ongoing), [5, 4, 3]);
        assert.deepEqual(ids(recent.finished), [15, 14, 13]);
        assert.deepEqual(ids(recentActivities(many, 1).ongoing), [5]);
    });

    it("answers empty lists without activities", () => {
        for (const value of [[], null, undefined]) {
            assert.deepEqual(recentActivities(value), { ongoing: [], finished: [] });
        }
    });
});
