// A private case keeps no public design (#934, epic #923), and its author
// learns how many designs of other teachers keep it (#939): the shared step
// that both case endpoints run inside their transaction.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    COUNT_DESIGNS_KEEPING_ACCESS_SQL,
    PRIVATIZE_CASE_DESIGNS_SQL,
    applyCaseVisibility,
    applyCaseVisibilityToDesigns,
    countDesignsKeepingCaseAccess,
} from "../case-visibility.js";

// Answers each statement by its SQL: the designs update returns
// `privatizedIds`, the count returns `keepingAccess`.
function scriptedClient({ privatizedIds = [], keepingAccess = 0 } = {}) {
    const queries = [];
    return {
        queries,
        async query(sql, params) {
            queries.push({ sql, params });
            if (sql === PRIVATIZE_CASE_DESIGNS_SQL) {
                return { rows: privatizedIds.map(id => ({ id })) };
            }
            if (sql === COUNT_DESIGNS_KEEPING_ACCESS_SQL) {
                return { rows: [{ count: keepingAccess }] };
            }
            return { rows: [] };
        },
    };
}

function fakeClient(rows) {
    const queries = [];
    return {
        queries,
        async query(sql, params) {
            queries.push({ sql, params });
            return { rows };
        },
    };
}

describe("applyCaseVisibilityToDesigns", () => {
    it("turns the public designs of a private case private and returns their ids", async () => {
        const client = fakeClient([{ id: 12 }, { id: 13 }]);

        const ids = await applyCaseVisibilityToDesigns(client, 41, "private");

        assert.deepEqual(ids, [12, 13]);
        assert.deepEqual(client.queries, [{ sql: PRIVATIZE_CASE_DESIGNS_SQL, params: [41] }]);
    });

    it("returns no ids when no public design uses the private case", async () => {
        const client = fakeClient([]);

        assert.deepEqual(await applyCaseVisibilityToDesigns(client, 41, "private"), []);
        assert.equal(client.queries.length, 1);
    });

    it("leaves the designs of a public case untouched", async () => {
        const client = fakeClient([{ id: 12 }]);

        assert.deepEqual(await applyCaseVisibilityToDesigns(client, 41, "public"), []);
        assert.deepEqual(client.queries, []);
    });

    it("only touches public designs of that case, whoever created them", () => {
        assert.match(PRIVATIZE_CASE_DESIGNS_SQL, /SET visibility = 'private',\s+public = false/u);
        assert.match(
            PRIVATIZE_CASE_DESIGNS_SQL,
            /WHERE case_id = \$1\s+AND visibility = 'public'/u
        );
        assert.doesNotMatch(PRIVATIZE_CASE_DESIGNS_SQL, /creator/u);
        assert.match(PRIVATIZE_CASE_DESIGNS_SQL, /RETURNING id/u);
    });

    it("propagates a failure so the caller's transaction rolls back", async () => {
        const client = {
            async query() {
                throw new Error("designs update failed");
            },
        };

        await assert.rejects(
            applyCaseVisibilityToDesigns(client, 41, "private"),
            /designs update failed/u
        );
    });
});

describe("countDesignsKeepingCaseAccess", () => {
    it("counts the designs of other teachers that use the case", async () => {
        const client = scriptedClient({ keepingAccess: 3 });

        assert.equal(await countDesignsKeepingCaseAccess(client, 41, 7), 3);
        assert.deepEqual(client.queries, [
            { sql: COUNT_DESIGNS_KEEPING_ACCESS_SQL, params: [41, 7] },
        ]);
    });

    it("reads PostgreSQL's count whether it comes as a number or a string", async () => {
        assert.equal(await countDesignsKeepingCaseAccess(fakeClient([{ count: "2" }]), 41, 7), 2);
    });

    it("answers zero when nothing is counted", async () => {
        assert.equal(await countDesignsKeepingCaseAccess(fakeClient([{ count: 0 }]), 41, 7), 0);
        assert.equal(await countDesignsKeepingCaseAccess(fakeClient([]), 41, 7), 0);
        assert.equal(await countDesignsKeepingCaseAccess(fakeClient([{ count: null }]), 41, 7), 0);
    });

    it("counts the case's designs not created by the owner, and selects no identity", () => {
        assert.match(
            COUNT_DESIGNS_KEEPING_ACCESS_SQL,
            /SELECT COUNT\(\*\)::int AS count\s+FROM designs\s+WHERE case_id = \$1/u
        );
        assert.match(COUNT_DESIGNS_KEEPING_ACCESS_SQL, /AND creator <> \$2;/u);
        assert.doesNotMatch(COUNT_DESIGNS_KEEPING_ACCESS_SQL, /SELECT\s+(?!COUNT)/u);
        assert.doesNotMatch(COUNT_DESIGNS_KEEPING_ACCESS_SQL, /visibility/u);
    });
});

describe("applyCaseVisibility", () => {
    it("turns a private case's public designs private, then counts the designs kept", async () => {
        const client = scriptedClient({ privatizedIds: [12, 13], keepingAccess: 2 });

        const effects = await applyCaseVisibility(client, {
            caseId: 41, ownerId: 7, visibility: "private",
        });

        assert.deepEqual(effects, { affectedDesignIds: [12, 13], designsKeepingAccess: 2 });
        assert.deepEqual(client.queries, [
            { sql: PRIVATIZE_CASE_DESIGNS_SQL, params: [41] },
            { sql: COUNT_DESIGNS_KEEPING_ACCESS_SQL, params: [41, 7] },
        ]);
    });

    it("only counts for a public case", async () => {
        const client = scriptedClient({ privatizedIds: [12], keepingAccess: 1 });

        const effects = await applyCaseVisibility(client, {
            caseId: 41, ownerId: 7, visibility: "public",
        });

        assert.deepEqual(effects, { affectedDesignIds: [], designsKeepingAccess: 1 });
        assert.deepEqual(client.queries, [
            { sql: COUNT_DESIGNS_KEEPING_ACCESS_SQL, params: [41, 7] },
        ]);
    });

    it("reports zero when only the owner's designs use the case", async () => {
        const client = scriptedClient({ privatizedIds: [12], keepingAccess: 0 });

        const effects = await applyCaseVisibility(client, {
            caseId: 41, ownerId: 7, visibility: "private",
        });

        assert.deepEqual(effects, { affectedDesignIds: [12], designsKeepingAccess: 0 });
    });
});
