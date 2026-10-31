import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
    caseAffectedDesignIds,
    designsMadePrivateMessage,
} from "../case-visibility-result.js";

function locale(name) {
    const url = new URL(`../../../locales/${name}.json`, import.meta.url);
    return JSON.parse(readFileSync(url, "utf8"));
}

describe("caseAffectedDesignIds", () => {
    it("returns the ids as numbers", () => {
        assert.deepEqual(caseAffectedDesignIds({ affectedDesignIds: [12, "13"] }), [12, 13]);
    });

    it("returns nothing for a result without ids", () => {
        assert.deepEqual(caseAffectedDesignIds({ id: 41 }), []);
        assert.deepEqual(caseAffectedDesignIds({ affectedDesignIds: null }), []);
        assert.deepEqual(caseAffectedDesignIds(undefined), []);
    });

    it("drops values that are not design ids", () => {
        assert.deepEqual(caseAffectedDesignIds({ affectedDesignIds: [0, -1, "x", 1.5, 7] }), [7]);
    });
});

describe("designsMadePrivateMessage", () => {
    it("is null when no design became private", () => {
        assert.equal(designsMadePrivateMessage({ affectedDesignIds: [] }), null);
        assert.equal(designsMadePrivateMessage(undefined), null);
    });

    it("uses the singular key for one design", () => {
        assert.deepEqual(designsMadePrivateMessage({ affectedDesignIds: [12] }), {
            key:    "ethical_cases_designs_made_private_one",
            values: { count: 1 },
        });
    });

    it("uses the plural key with the count for several designs", () => {
        assert.deepEqual(designsMadePrivateMessage({ affectedDesignIds: [12, 13, 14] }), {
            key:    "ethical_cases_designs_made_private_other",
            values: { count: 3 },
        });
    });

    it("has both keys translated in es_CL and en_US", () => {
        for (const name of ["es_CL", "en_US"]) {
            const catalog = locale(name);
            assert.ok(catalog.ethical_cases_designs_made_private_one, name);
            assert.match(catalog.ethical_cases_designs_made_private_other, /\{\{count\}\}/u, name);
        }
    });
});
