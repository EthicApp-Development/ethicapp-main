// The rule that decides which case a design may point at (#924), with the
// case lookup and the log replaced by fakes.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    ASSOCIABLE_CASE_SQL,
    CASE_NOT_AVAILABLE_CODE,
    DESIGN_CASE_REFUSED_EVENT,
    associableCaseSql,
    caseNotAvailableRefusal,
    checkDesignCase,
} from "../design-case-association.js";
import { summarizeSecurityRefusal } from "../log-safety.js";

const USER_ID = 7;

function fakes(associableIds = []) {
    const lookups = [];
    const warnings = [];
    return {
        lookups,
        warnings,
        dependencies: {
            isAssociable: async (caseId, userId) => {
                lookups.push([caseId, userId]);
                return associableIds.includes(caseId);
            },
            warn: (message, entry) => warnings.push({ message, entry }),
        },
    };
}

describe("associableCaseSql", () => {
    it("is the teacher's own case or a public one, not archived", () => {
        const sql = associableCaseSql("c", "$2");

        assert.equal(sql, "((c.creator = $2 OR c.visibility = 'public')"
            + " AND COALESCE(c.archived, false) = false)");
        assert.match(ASSOCIABLE_CASE_SQL, /WHERE c\.id = \$1/u);
        assert.ok(ASSOCIABLE_CASE_SQL.includes(sql));
    });
});

describe("checkDesignCase", () => {
    it("accepts no case without a lookup", async () => {
        for (const requestedCaseId of [undefined, null, ""]) {
            const { lookups, warnings, dependencies } = fakes();

            const result = await checkDesignCase({ requestedCaseId, userId: USER_ID },
                dependencies);

            assert.deepEqual(result, { caseId: null });
            assert.deepEqual(lookups, []);
            assert.deepEqual(warnings, []);
        }
    });

    it("accepts a case the teacher may pick, as a number", async () => {
        const { lookups, warnings, dependencies } = fakes([41]);

        const result = await checkDesignCase({ requestedCaseId: "41", userId: USER_ID },
            dependencies);

        assert.deepEqual(result, { caseId: 41 });
        assert.deepEqual(lookups, [[41, USER_ID]]);
        assert.deepEqual(warnings, []);
    });

    it("refuses any other case with one 404 and one warning", async () => {
        const { warnings, dependencies } = fakes([41]);

        const result = await checkDesignCase({
            requestedCaseId: 43,
            storedCaseId:    41,
            userId:          USER_ID,
            designId:        12,
        }, dependencies);

        assert.deepEqual(result, { refusal: caseNotAvailableRefusal() });
        assert.equal(result.refusal.status, 404);
        assert.equal(result.refusal.body.code, CASE_NOT_AVAILABLE_CODE);
        assert.equal(warnings.length, 1);
        assert.match(warnings[0].message, /^\[security\]/u);
        assert.deepEqual(warnings[0].entry, {
            event:    DESIGN_CASE_REFUSED_EVENT,
            userId:   USER_ID,
            designId: 12,
            caseId:   43,
        });
    });

    it("keeps the design's current case without a lookup", async () => {
        const { lookups, warnings, dependencies } = fakes();

        const result = await checkDesignCase({
            requestedCaseId: "43",
            storedCaseId:    43,
            userId:          USER_ID,
            designId:        12,
        }, dependencies);

        assert.deepEqual(result, { caseId: 43 });
        assert.deepEqual(lookups, []);
        assert.deepEqual(warnings, []);
    });

    it("refuses malformed ids before any lookup", async () => {
        for (const requestedCaseId of ["4x", " 41", 0, -1, 2.5, NaN, [41], { id: 41 }, false]) {
            const { lookups, warnings, dependencies } = fakes([41]);

            const result = await checkDesignCase({
                requestedCaseId,
                storedCaseId: 41,
                userId:       USER_ID,
            }, dependencies);

            assert.equal(result.refusal?.status, 404, String(requestedCaseId));
            assert.deepEqual(lookups, []);
            assert.equal(warnings[0].entry.caseId, null);
        }
    });
});

describe("summarizeSecurityRefusal", () => {
    it("keeps the event and positive integer ids only", () => {
        assert.deepEqual(summarizeSecurityRefusal("an_event", {
            userId:   7,
            designId: "12",
            caseId:   "<script>alert(1)</script>",
            phaseId:  { toString: () => "13" },
            groupId:  -3,
            other:    null,
        }), {
            event:    "an_event",
            userId:   7,
            designId: 12,
            caseId:   null,
            phaseId:  null,
            groupId:  null,
            other:    null,
        });
        assert.deepEqual(summarizeSecurityRefusal("an_event"), { event: "an_event" });
    });
});
