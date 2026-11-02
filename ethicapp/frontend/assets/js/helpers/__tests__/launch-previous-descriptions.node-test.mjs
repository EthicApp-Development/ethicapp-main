// "Used before" in the launch wizard's second step (#972, epic #965).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    PREVIOUS_DESCRIPTIONS_LIMIT,
    previousDescriptions,
} from "../launch-previous-descriptions.js";

function activity(sessionId, description, time) {
    return { sessionId, description, time };
}

describe("previousDescriptions", () => {
    it("offers the last five distinct descriptions, most recent first", () => {
        const activities = [
            activity(1, "Ética · Sección 1", "2026-03-01T10:00:00Z"),
            activity(2, "Ética · Sección 2", "2026-04-01T10:00:00Z"),
            activity(3, "Taller · 2026-1", "2026-05-01T10:00:00Z"),
            activity(4, "Ética · Sección 3", "2026-06-01T10:00:00Z"),
            activity(5, "Ética · Sección 4", "2026-07-01T10:00:00Z"),
            activity(6, "Ética · Sección 5", "2026-08-01T10:00:00Z"),
        ];

        assert.equal(PREVIOUS_DESCRIPTIONS_LIMIT, 5);
        assert.deepEqual(previousDescriptions(activities), [
            "Ética · Sección 5",
            "Ética · Sección 4",
            "Ética · Sección 3",
            "Taller · 2026-1",
            "Ética · Sección 2",
        ]);
    });

    it("lists a repeated description once, where it was last used", () => {
        const activities = [
            activity(1, "Ética · Sección 3", "2026-10-01T10:00:00Z"),
            activity(2, "Taller · 2026-2", "2026-10-15T10:00:00Z"),
            activity(3, "  Ética · Sección 3 ", "2026-10-28T10:00:00Z"),
        ];

        assert.deepEqual(previousDescriptions(activities), [
            "Ética · Sección 3",
            "Taller · 2026-2",
        ]);
    });

    it("skips blank and missing descriptions", () => {
        const activities = [
            activity(1, "", "2026-10-01T10:00:00Z"),
            activity(2, "   ", "2026-10-02T10:00:00Z"),
            activity(3, null, "2026-10-03T10:00:00Z"),
            { sessionId: 4, time: "2026-10-04T10:00:00Z" },
            activity(5, "Sección 1", "2026-09-01T10:00:00Z"),
        ];

        assert.deepEqual(previousDescriptions(activities), ["Sección 1"]);
    });

    it("breaks ties by session id and puts undated activities last", () => {
        const activities = [
            activity(7, "Sin fecha", null),
            activity(2, "Mismo momento, antes", "2026-10-01T10:00:00Z"),
            { sessionid: 3, description: "Mismo momento, después", time: "2026-10-01T10:00:00Z" },
        ];

        assert.deepEqual(previousDescriptions(activities), [
            "Mismo momento, después",
            "Mismo momento, antes",
            "Sin fecha",
        ]);
    });

    it("takes a limit, and copes with a missing catalog", () => {
        const activities = [
            activity(1, "A", "2026-10-01T10:00:00Z"),
            activity(2, "B", "2026-10-02T10:00:00Z"),
        ];

        assert.deepEqual(previousDescriptions(activities, 1), ["B"]);
        assert.deepEqual(previousDescriptions(null), []);
        assert.deepEqual(previousDescriptions(undefined), []);
    });
});
