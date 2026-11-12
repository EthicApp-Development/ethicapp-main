// The phase deadline runner's statements (#1113) with a fake query function:
// their parameters and the mapping of their rows. The integration suite
// (phase-deadline-runner.integration-test.mjs) runs them on PostgreSQL.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CLAIM_DUE_DEADLINE_SQL } from "../../../helpers/phase-start-helper.js";
import {
    createPhaseDeadlineStore,
    DUE_ENFORCED_DEADLINES_SQL,
    MARK_DEADLINE_HANDLED_SQL,
    SETTLE_UNENFORCED_DEADLINES_SQL,
} from "../phase-deadline-store.js";

const IN_PROGRESS = 2;

function setup(rows = []) {
    const queries = [];
    const store = createPhaseDeadlineStore({
        dbQuery: async (sql, params) => {
            queries.push([sql, params]);
            return rows;
        },
    });
    return { store, queries };
}

describe("the phase deadline store", () => {
    it("lists the enforced due deadlines, leaving out the phases backing off", async () => {
        const { store, queries } = setup([
            { session_id: "4", teacher_id: "7", phase_id: "40", phase_number: 2 },
        ]);

        const due = await store.listDueEnforced({ limit: 20, excludePhaseIds: [11, 12] });

        assert.deepEqual(queries, [[DUE_ENFORCED_DEADLINES_SQL, [IN_PROGRESS, 20, [11, 12]]]]);
        assert.deepEqual(due, [{ sessionId: 4, teacherId: 7, phaseId: 40, phaseNumber: 2 }]);
    });

    it("selects hard-mode activities in progress on the phase, due and not handled", () => {
        for (const condition of [
            "s.current_stage = st.id", "st.ends_at <= now()", "st.deadline_handled_at IS NULL",
            "s.time_mode = 'hard'", "s.status = $1", "LIMIT $2",
        ]) {
            assert.ok(DUE_ENFORCED_DEADLINES_SQL.includes(condition), condition);
        }
    });

    it("settles the unenforced due deadlines and counts them", async () => {
        const { store, queries } = setup([{ id: 1 }, { id: 2 }]);

        assert.equal(await store.settleUnenforced({ limit: 20 }), 2);
        assert.deepEqual(queries, [[SETTLE_UNENFORCED_DEADLINES_SQL, [IN_PROGRESS, 20]]]);
        assert.match(SETTLE_UNENFORCED_DEADLINES_SQL, /SKIP LOCKED/);
    });

    it("marks one deadline handled with the claim of a deadline start", async () => {
        assert.equal(MARK_DEADLINE_HANDLED_SQL, CLAIM_DUE_DEADLINE_SQL);

        const marked = setup([{ id: 40 }]);
        assert.equal(await marked.store.markHandled(40), true);
        assert.deepEqual(marked.queries, [[MARK_DEADLINE_HANDLED_SQL, [40]]]);

        const already = setup([]);
        assert.equal(await already.store.markHandled(40), false);
    });
});
