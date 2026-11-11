// "+1 min" (#1112, epic #1105) with a fake query: the parameters of the one
// conditional statement, the read of the refusal's reason only when nothing
// was updated, and the reason for each state of the activity. The statement's
// conditions, locks and concurrency are covered by
// phase-clock-extension.integration-test.mjs against PostgreSQL.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    EXTEND_PHASE_DEADLINE_SQL,
    EXTENSION_STATE_SQL,
    extendPhaseDeadline,
    extensionRefusal,
} from "../phase-clock-extension.js";

const TEACHER = 5;
const SESSION = 10;
const PHASE = 101;
const FINISHED = 3;
const ENDS_AT = new Date("2026-11-11T10:06:00.000Z");

const REQUEST = Object.freeze({
    sessionId:      String(SESSION),
    phaseId:        PHASE,
    teacherId:      TEACHER,
    minutes:        1,
    expectedEndsAt: "2026-11-11T07:05:00.123-03:00",
});

function fakeQuery(answers) {
    const calls = [];
    const query = async (sql, params) => {
        calls.push({ sql, params });
        return answers.get(sql) ?? [];
    };
    return { query, calls };
}

// An EXTENSION_STATE_SQL row of a soft-mode activity at phase PHASE, whose
// deadline is in the future.
function stateRow(overrides = {}) {
    return {
        creator:             TEACHER,
        status:              2,
        current_stage:       PHASE,
        time_mode:           "soft",
        phase_id:            PHASE,
        ends_at:             ENDS_AT,
        deadline_handled_at: null,
        deadline_passed:     false,
        ...overrides,
    };
}

describe("extendPhaseDeadline", () => {
    it("runs one statement with the request, the deadline in UTC and the finished status",
        async () => {
            const { query, calls } = fakeQuery(new Map([
                [EXTEND_PHASE_DEADLINE_SQL, [{ phase_id: PHASE, ends_at: ENDS_AT }]],
            ]));

            const result = await extendPhaseDeadline(REQUEST, { query });

            assert.deepEqual(result, { status: "extended", phaseId: PHASE, endsAt: ENDS_AT });
            assert.deepEqual(calls, [{
                sql:    EXTEND_PHASE_DEADLINE_SQL,
                params: [SESSION, PHASE, TEACHER, 1, "2026-11-11T10:05:00.123Z", FINISHED],
            }]);
        });

    // Decision of 2026-11-11: once the deadline has passed, the minute is
    // added to the database's now(); the expected deadline is compared with
    // the old one, to the millisecond. The integration tests run it.
    it("adds the minute to the later of the deadline and now()", () => {
        assert.match(EXTEND_PHASE_DEADLINE_SQL,
            /SET ends_at = GREATEST\(st\.ends_at, now\(\)\) \+ \$4::integer \* interval/);
        assert.match(EXTEND_PHASE_DEADLINE_SQL,
            /date_trunc\('milliseconds', st\.ends_at\) = \$5::timestamptz/);
        assert.match(EXTEND_PHASE_DEADLINE_SQL, /deadline_handled_at = NULL/);
    });

    it("reads why only when nothing was updated", async () => {
        const { query, calls } = fakeQuery(new Map([
            [EXTENSION_STATE_SQL, [stateRow({ status: FINISHED, current_stage: null })]],
        ]));

        const result = await extendPhaseDeadline(REQUEST, { query });

        assert.deepEqual(result, { status: "finished" });
        assert.deepEqual(calls.map(call => call.sql),
            [EXTEND_PHASE_DEADLINE_SQL, EXTENSION_STATE_SQL]);
        assert.deepEqual(calls[1].params, [SESSION, PHASE]);
    });

    it("answers not_found when the session is gone", async () => {
        const { query } = fakeQuery(new Map());

        assert.deepEqual(await extendPhaseDeadline(REQUEST, { query }), { status: "not_found" });
    });
});

describe("extensionRefusal", () => {
    const request = { teacherId: TEACHER, phaseId: PHASE };
    const reason = overrides => extensionRefusal(stateRow(overrides), request);

    it("says the session is not found when it is gone or another teacher's", () => {
        assert.equal(extensionRefusal(undefined, request), "not_found");
        assert.equal(reason({ creator: 6 }), "not_found");
    });

    it("says the phase is not found when it is not one of the session's", () => {
        assert.equal(reason({ phase_id: null, ends_at: null }), "phase_not_found");
        assert.equal(reason({ phase_id: null, status: FINISHED }), "phase_not_found");
    });

    it("says the activity is finished before anything about its phase", () => {
        assert.equal(reason({ status: FINISHED, current_stage: null }), "finished");
        assert.equal(reason({ status: FINISHED, time_mode: "none" }), "finished");
    });

    it("says the phase is not the current one", () => {
        assert.equal(reason({ current_stage: 102 }), "not_current");
        assert.equal(reason({ current_stage: null, status: 1 }), "not_current");
    });

    it("says there is no deadline without a time mode or a duration", () => {
        assert.equal(reason({ time_mode: "none" }), "no_deadline");
        assert.equal(reason({ time_mode: "none", ends_at: null }), "no_deadline");
        assert.equal(reason({ time_mode: "hard", ends_at: null }), "no_deadline");
    });

    it("says a hard deadline passed and not handled stands", () => {
        assert.equal(reason({ time_mode: "hard", deadline_passed: true }), "deadline_passed");
    });

    it("says the deadline changed otherwise", () => {
        // The expected deadline no longer matches.
        assert.equal(reason({}), "deadline_changed");
        // A soft deadline that passed can be extended, as a handled hard one.
        assert.equal(reason({ deadline_passed: true }), "deadline_changed");
        assert.equal(reason({
            time_mode:           "hard",
            deadline_passed:     true,
            deadline_handled_at: new Date(),
        }), "deadline_changed");
    });
});
