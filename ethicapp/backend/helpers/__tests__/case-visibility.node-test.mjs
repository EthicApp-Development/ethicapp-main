// A private case keeps no public design (#934, epic #923): the shared step
// that both case endpoints run inside their transaction.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    PRIVATIZE_CASE_DESIGNS_SQL,
    applyCaseVisibilityToDesigns,
} from "../case-visibility.js";

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
