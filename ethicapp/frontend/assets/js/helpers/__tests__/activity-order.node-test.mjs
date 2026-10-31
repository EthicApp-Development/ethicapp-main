import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { newestActivitiesFirst } from "../activity-order.js";

const activity = (sessionId, time) => ({ sessionId, time });
const sessionIds = list => list.map(item => item.sessionId);

describe("newestActivitiesFirst (#918)", () => {
    it("puts the newest activities first, whatever order they came in", () => {
        const activities = [
            activity(1, "2026-10-01T10:00:00.000Z"),
            activity(2, "2026-10-03T10:00:00.000Z"),
            activity(3, "2026-10-02T10:00:00.000Z"),
            activity(4, "2026-10-05T10:00:00.000Z"),
            activity(5, "2026-10-04T10:00:00.000Z"),
        ];

        assert.deepEqual(sessionIds(newestActivitiesFirst(activities)), [4, 5, 2, 3, 1]);
        assert.deepEqual(sessionIds(newestActivitiesFirst(activities).slice(0, 3)), [4, 5, 2]);
    });

    it("keeps the most recent session first when the times are equal", () => {
        const time = "2026-10-01T10:00:00.000Z";

        const activities = [activity(7, time), activity(9, time), activity("8", time)];

        assert.deepEqual(sessionIds(newestActivitiesFirst(activities)), [9, "8", 7]);
    });

    it("puts activities without a valid time last", () => {
        const activities = [
            activity(1, null),
            activity(2, "2026-10-01T10:00:00.000Z"),
            activity(3, "not a date"),
        ];

        assert.deepEqual(sessionIds(newestActivitiesFirst(activities)), [2, 3, 1]);
    });

    it("returns a copy and leaves the catalog's list as it was", () => {
        const activities = [
            activity(1, "2026-10-01T10:00:00.000Z"),
            activity(2, "2026-10-02T10:00:00.000Z"),
        ];

        const ordered = newestActivitiesFirst(activities);

        assert.notEqual(ordered, activities);
        assert.deepEqual(sessionIds(activities), [1, 2]);
    });

    it("returns an empty list for anything but a list", () => {
        assert.deepEqual(newestActivitiesFirst(null), []);
        assert.deepEqual(newestActivitiesFirst(undefined), []);
    });
});
