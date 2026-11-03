// The usage counts of a case in GET /cases (#1011, epic #1008): the SQL
// expression's shape and the normalization of its value. The counts
// themselves are checked against PostgreSQL in case-usage.integration-test.mjs.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { caseUsageJsonSql, normalizeCaseUsage } from "../case-usage.js";

describe("caseUsageJsonSql (#1011)", () => {
    const sql = caseUsageJsonSql("c", "$1");

    it("is one parenthesized subquery over the case's designs", () => {
        assert.match(sql, /^\(\s*SELECT json_build_object\(/u);
        assert.match(sql, /\)$/u);
        assert.match(sql, /FROM designs usage_design\s/u);
        assert.match(sql, /WHERE usage_design\.case_id = c\.id\s/u);
    });

    it("counts the activities of every design, whoever created it", () => {
        assert.match(sql, /'activityCount', COUNT\(usage_activity\.id\)/u);
        assert.match(sql,
            /LEFT JOIN activity usage_activity ON usage_activity\.design = usage_design\.id/u);
    });

    it("splits the designs into the teacher's own and other teachers'", () => {
        const own = "FILTER (WHERE usage_design.creator = $1)";
        const other = "FILTER (WHERE usage_design.creator IS DISTINCT FROM $1)";
        const flat = sql.replace(/\s+/gu, " ");

        assert.ok(flat.includes(`'ownDesignCount', COUNT(DISTINCT usage_design.id) ${own}`));
        assert.ok(flat.includes(`'otherDesignCount', COUNT(DISTINCT usage_design.id) ${other}`));
        assert.ok(flat.includes(
            `'otherTeacherCount', COUNT(DISTINCT usage_design.creator) ${other}`));
    });

    it("counts archived designs", () => {
        assert.doesNotMatch(sql, /archived/u);
    });

    it("uses the given case alias and user placeholder", () => {
        const other = caseUsageJsonSql("source_case", "$2");

        assert.match(other, /WHERE usage_design\.case_id = source_case\.id\s/u);
        assert.equal((other.match(/\$2/gu) || []).length, 3);
        assert.doesNotMatch(other, /\$1/u);
    });
});

describe("normalizeCaseUsage (#1011)", () => {
    it("keeps the four counts", () => {
        assert.deepEqual(normalizeCaseUsage({
            activityCount:     3,
            ownDesignCount:    2,
            otherDesignCount:  4,
            otherTeacherCount: 1,
        }), {
            activityCount:     3,
            ownDesignCount:    2,
            otherDesignCount:  4,
            otherTeacherCount: 1,
        });
    });

    it("reads counts given as strings", () => {
        assert.deepEqual(normalizeCaseUsage({
            activityCount:     "5",
            ownDesignCount:    "1",
            otherDesignCount:  "0",
            otherTeacherCount: "0",
        }), {
            activityCount:     5,
            ownDesignCount:    1,
            otherDesignCount:  0,
            otherTeacherCount: 0,
        });
    });

    it("is all zeros for a case no design uses, or without a value", () => {
        const zeros = {
            activityCount:     0,
            ownDesignCount:    0,
            otherDesignCount:  0,
            otherTeacherCount: 0,
        };

        assert.deepEqual(normalizeCaseUsage({ ...zeros }), zeros);
        assert.deepEqual(normalizeCaseUsage(null), zeros);
        assert.deepEqual(normalizeCaseUsage(undefined), zeros);
        assert.deepEqual(normalizeCaseUsage({}), zeros);
    });

    it("turns negative, fractional and non-numeric counts into 0", () => {
        assert.deepEqual(normalizeCaseUsage({
            activityCount:     -1,
            ownDesignCount:    1.5,
            otherDesignCount:  "many",
            otherTeacherCount: Number.NaN,
        }), {
            activityCount:     0,
            ownDesignCount:    0,
            otherDesignCount:  0,
            otherTeacherCount: 0,
        });
    });
});
