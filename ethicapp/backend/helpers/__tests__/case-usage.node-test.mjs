// The usage counts of a case in GET /cases (#1011, epic #1008) and the uses
// of a case in GET /cases/:id/uses (#1012): the SQL expressions' shape and
// the normalization of their values. The counts and the designs themselves
// are checked against PostgreSQL in case-usage.integration-test.mjs.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    caseOwnDesignsJsonSql,
    caseUsageJsonSql,
    normalizeCaseUsage,
    normalizeCaseUses,
} from "../case-usage.js";

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

    it("counts the activities of the teacher's own designs apart (#1012)", () => {
        const flat = sql.replace(/\s+/gu, " ");

        assert.ok(flat.includes("'ownActivityCount', COUNT(usage_activity.id) "
            + "FILTER (WHERE usage_design.creator = $1)"));
    });

    it("counts archived designs", () => {
        assert.doesNotMatch(sql, /archived/u);
    });

    it("uses the given case alias and user placeholder", () => {
        const other = caseUsageJsonSql("source_case", "$2");

        assert.match(other, /WHERE usage_design\.case_id = source_case\.id\s/u);
        assert.equal((other.match(/\$2/gu) || []).length, 4);
        assert.doesNotMatch(other, /\$1/u);
    });
});

describe("normalizeCaseUsage (#1011)", () => {
    it("leaves out the teacher's own activities, which only the case's uses return", () => {
        assert.equal("ownActivityCount" in normalizeCaseUsage({ ownActivityCount: 2 }), false);
    });

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

describe("caseOwnDesignsJsonSql (#1012)", () => {
    const sql = caseOwnDesignsJsonSql("c", "$2");
    const flat = sql.replace(/\s+/gu, " ");

    it("lists only the teacher's designs of the case, archived ones included", () => {
        assert.ok(flat.includes("FROM designs own_design "
            + "WHERE own_design.case_id = c.id AND own_design.creator = $2 )"));
        assert.doesNotMatch(flat, /WHERE[^)]*archived/u);
        assert.doesNotMatch(flat, /creator IS DISTINCT FROM|creator <>/u);
    });

    it("gives each design's id, title and archived flag, and nothing else", () => {
        const keys = [...flat.matchAll(/'([a-zA-Z]+)',/gu)].map(match => match[1]);

        assert.deepEqual(keys, ["id", "title", "archived"]);
        assert.ok(flat.includes(
            "COALESCE( own_design.design #>> '{metainfo,title}', own_design.design ->> 'title' )"));
    });

    it("lists the designs not archived first, newest first, or an empty array", () => {
        assert.ok(flat.includes(
            "ORDER BY COALESCE(own_design.archived, false), own_design.id DESC"));
        assert.match(flat, /^COALESCE\(\( SELECT json_agg\(/u);
        assert.match(flat, /\), '\[\]'::json\)$/u);
    });
});

describe("normalizeCaseUses (#1012)", () => {
    const usage = {
        activityCount:     5,
        ownActivityCount:  2,
        ownDesignCount:    2,
        otherDesignCount:  3,
        otherTeacherCount: 2,
    };
    const ownDesigns = [
        { id: 12, title: "Mine", archived: false },
        { id: 11, title: "Old one", archived: true },
    ];

    it("gives the author their designs, every activity and the other teachers' counts", () => {
        assert.deepEqual(normalizeCaseUses({
            ownDesigns, usage, isAuthor: true, designsKeepingAccess: 2,
        }), {
            ownDesigns,
            activityCount:        5,
            otherDesignCount:     3,
            otherTeacherCount:    2,
            designsKeepingAccess: 2,
        });
    });

    it("gives another teacher their designs and their activities only", () => {
        assert.deepEqual(normalizeCaseUses({
            ownDesigns, usage, isAuthor: false, designsKeepingAccess: 2,
        }), {
            ownDesigns,
            activityCount: 2,
        });
    });

    it("answers zeros and no designs without values", () => {
        assert.deepEqual(normalizeCaseUses({ isAuthor: true }), {
            ownDesigns:           [],
            activityCount:        0,
            otherDesignCount:     0,
            otherTeacherCount:    0,
            designsKeepingAccess: 0,
        });
        assert.deepEqual(normalizeCaseUses({ ownDesigns: null, usage: null, isAuthor: false }), {
            ownDesigns:    [],
            activityCount: 0,
        });
    });

    it("keeps only the id, title and archived flag of valid designs", () => {
        const { ownDesigns: designs } = normalizeCaseUses({
            ownDesigns: [
                { id: "12", title: "", archived: "yes", creator: 9 },
                { id: 13, title: null, archived: true },
                { id: null, title: "No id" },
                { id: -1, title: "Bad id" },
                null,
            ],
            usage,
            isAuthor: false,
        });

        assert.deepEqual(designs, [
            { id: 12, title: null, archived: false },
            { id: 13, title: null, archived: true },
        ]);
    });
});
