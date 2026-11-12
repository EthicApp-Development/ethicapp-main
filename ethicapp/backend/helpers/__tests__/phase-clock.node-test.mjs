// The phase clock's reader and its mapping (#1111, epic #1105). The route's
// access and its usual answers are covered in
// controllers/activities/__tests__/phase-clock-route.node-test.mjs; the SQL in
// phase-clock.integration-test.mjs. These are the rows those cannot easily
// produce.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PHASE_CLOCK_SQL, phaseClockFromRow, readPhaseClock } from "../phase-clock.js";

const SERVER_NOW = new Date("2026-11-11T10:01:30.000Z");

function row(overrides = {}) {
    return {
        session_id:         "10",
        time_mode:          "hard",
        status:             2,
        phase_id:           "101",
        phase_number:       1,
        started_at:         new Date("2026-11-11T10:00:00.000Z"),
        ends_at:            new Date("2026-11-11T10:05:00.000Z"),
        design_phase_count: 2,
        server_now:         SERVER_NOW,
        ...overrides,
    };
}

describe("phaseClockFromRow", () => {
    it("maps a timed phase, with numeric ids and ISO times", () => {
        assert.deepEqual(phaseClockFromRow(row()), {
            sessionId:   10,
            timeMode:    "hard",
            finished:    false,
            phaseId:     101,
            phaseNumber: 1,
            startedAt:   "2026-11-11T10:00:00.000Z",
            endsAt:      "2026-11-11T10:05:00.000Z",
            isLastPhase: false,
            serverNow:   "2026-11-11T10:01:30.000Z",
        });
    });

    it("shows no phase for a finished activity that still names one", () => {
        const clock = phaseClockFromRow(row({ status: 3 }));

        assert.equal(clock.finished, true);
        assert.equal(clock.phaseId, null);
        assert.equal(clock.endsAt, null);
        assert.equal(clock.isLastPhase, null);
    });

    it("treats a design without phases as having no next phase", () => {
        // As starting the next phase does: it answers no_next_phase.
        assert.equal(phaseClockFromRow(row({ design_phase_count: null })).isLastPhase, true);
        assert.equal(phaseClockFromRow(row({ design_phase_count: 0 })).isLastPhase, true);
    });

    it("has no start for a phase started before V45", () => {
        const clock = phaseClockFromRow(
            row({ time_mode: "none", started_at: null, ends_at: null }));

        assert.equal(clock.startedAt, null);
        assert.equal(clock.endsAt, null);
        assert.equal(clock.phaseNumber, 1);
    });

    it("reads an unknown time mode as none", () => {
        const clock = phaseClockFromRow(row({ time_mode: "paused" }));

        assert.equal(clock.timeMode, "none");
        assert.equal(clock.endsAt, null);
    });

    it("accepts times as text", () => {
        const clock = phaseClockFromRow(row({
            ends_at:    "2026-11-11 10:05:00+00",
            server_now: "2026-11-11T10:01:30Z",
        }));

        assert.equal(clock.endsAt, "2026-11-11T10:05:00.000Z");
        assert.equal(clock.serverNow, "2026-11-11T10:01:30.000Z");
    });
});

describe("readPhaseClock", () => {
    it("reads the session's row with its numeric id", async () => {
        const queries = [];
        const clock = await readPhaseClock("10", {
            query: async (sql, params) => {
                queries.push({ sql, params });
                return [row()];
            },
        });

        assert.deepEqual(queries, [{ sql: PHASE_CLOCK_SQL, params: [10] }]);
        assert.equal(clock.phaseId, 101);
    });

    it("gives null for an unknown session", async () => {
        assert.equal(await readPhaseClock(999, { query: async () => [] }), null);
    });

    it("takes the server's time from the database's clock when the row is read", () => {
        assert.match(PHASE_CLOCK_SQL, /clock_timestamp\(\) AS server_now/u);
    });
});
