// The cached parts of a student's full state that a phase start changes
// (#1176): the descriptor and the phase list are dropped together, and the
// groups are cached per list of phases.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { studentActivityDescriptorCacheKey } from "../student-activity-descriptor.js";
import {
    invalidatePhaseStartCachesWith,
    studentActivityGroupsCacheKey,
    studentActivityPhasesCacheKey,
} from "../student-phase-state-cache.js";

function fakeRedis(keys) {
    const store = new Set(keys);
    const calls = [];
    return {
        store,
        calls,
        async del(...deleted) {
            calls.push(deleted);
            deleted.forEach(key => store.delete(key));
        },
    };
}

describe("student phase state cache (#1176)", () => {
    it("drops the descriptor and the phase list of the session in one call", async () => {
        const other = studentActivityPhasesCacheKey(8);
        const redis = fakeRedis([
            studentActivityDescriptorCacheKey(7),
            studentActivityPhasesCacheKey(7),
            other,
        ]);

        await invalidatePhaseStartCachesWith(redis, "7");

        assert.deepEqual(redis.calls, [["descriptor:7:v2", "session:7:phases:v2"]]);
        assert.deepEqual([...redis.store], [other], "another session keeps its cache");
    });

    it("keys a student's groups by the listed phases, so a new phase is read anew", () => {
        const before = studentActivityGroupsCacheKey(7, 42, [1]);
        const after = studentActivityGroupsCacheKey(7, 42, [1, 2]);

        assert.equal(before, "session:7:user:42:groups:1");
        assert.equal(after, "session:7:user:42:groups:1,2");
        assert.notEqual(before, after);
        assert.equal(studentActivityGroupsCacheKey("7", "42", ["2", 1]), after,
            "the order and the type of the numbers do not matter");
        assert.notEqual(studentActivityGroupsCacheKey(7, 43, [1, 2]), after);
    });
});
