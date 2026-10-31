import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
    caseAffectedDesignIds,
    caseDesignsKeepingAccess,
    caseVisibilityResultMessages,
    designsKeepingAccessMessage,
    designsMadePrivateMessage,
    isCaseMadePrivate,
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

describe("caseDesignsKeepingAccess (#939)", () => {
    it("returns the count of other teachers' designs", () => {
        assert.equal(caseDesignsKeepingAccess({ designsKeepingAccess: 0 }), 0);
        assert.equal(caseDesignsKeepingAccess({ designsKeepingAccess: 3 }), 3);
        assert.equal(caseDesignsKeepingAccess({ designsKeepingAccess: "2" }), 2);
    });

    it("returns null when the answer gives no valid count", () => {
        assert.equal(caseDesignsKeepingAccess({ id: 41 }), null);
        assert.equal(caseDesignsKeepingAccess({ designsKeepingAccess: null }), null);
        assert.equal(caseDesignsKeepingAccess({ designsKeepingAccess: "" }), null);
        assert.equal(caseDesignsKeepingAccess({ designsKeepingAccess: -1 }), null);
        assert.equal(caseDesignsKeepingAccess({ designsKeepingAccess: 1.5 }), null);
        assert.equal(caseDesignsKeepingAccess({ designsKeepingAccess: "x" }), null);
        assert.equal(caseDesignsKeepingAccess(undefined), null);
    });
});

describe("isCaseMadePrivate (#939)", () => {
    it("is true only from public to private", () => {
        assert.equal(isCaseMadePrivate("public", "private"), true);
        assert.equal(isCaseMadePrivate("private", "private"), false);
        assert.equal(isCaseMadePrivate("private", "public"), false);
        assert.equal(isCaseMadePrivate("public", "public"), false);
        assert.equal(isCaseMadePrivate(undefined, "private"), false);
    });
});

describe("designsKeepingAccessMessage (#939)", () => {
    it("says that no other teacher keeps access when none of their designs uses the case", () => {
        assert.deepEqual(designsKeepingAccessMessage({ designsKeepingAccess: 0 }), {
            key:    "ethical_cases_designs_keeping_access_none",
            values: { count: 0 },
        });
    });

    it("uses the singular key for one design", () => {
        assert.deepEqual(designsKeepingAccessMessage({ designsKeepingAccess: 1 }), {
            key:    "ethical_cases_designs_keeping_access_one",
            values: { count: 1 },
        });
    });

    it("uses the plural key with the count for several designs", () => {
        assert.deepEqual(designsKeepingAccessMessage({ designsKeepingAccess: 4 }), {
            key:    "ethical_cases_designs_keeping_access_other",
            values: { count: 4 },
        });
    });

    it("is null for an answer without a count", () => {
        assert.equal(designsKeepingAccessMessage({ affectedDesignIds: [12] }), null);
    });

    it("has the three keys translated in es_CL and en_US", () => {
        for (const name of ["es_CL", "en_US"]) {
            const catalog = locale(name);
            assert.ok(catalog.ethical_cases_designs_keeping_access_none, name);
            assert.ok(catalog.ethical_cases_designs_keeping_access_one, name);
            assert.match(
                catalog.ethical_cases_designs_keeping_access_other,
                /\{\{count\}\}/u,
                name
            );
        }
    });
});

describe("caseVisibilityResultMessages (#939)", () => {
    it("adds the designs that keep access when a public case becomes private", () => {
        const result = { visibility: "private", affectedDesignIds: [12], designsKeepingAccess: 2 };

        assert.deepEqual(caseVisibilityResultMessages(result, "public"), [
            { key: "ethical_cases_designs_made_private_one", values: { count: 1 } },
            { key: "ethical_cases_designs_keeping_access_other", values: { count: 2 } },
        ]);
    });

    it("tells the author when no other teacher keeps access", () => {
        const result = { visibility: "private", affectedDesignIds: [], designsKeepingAccess: 0 };

        assert.deepEqual(caseVisibilityResultMessages(result, "public"), [
            { key: "ethical_cases_designs_keeping_access_none", values: { count: 0 } },
        ]);
    });

    it("keeps only #934's message when the case was already private", () => {
        const result = {
            visibility:           "private",
            affectedDesignIds:    [12, 13],
            designsKeepingAccess: 1,
        };

        assert.deepEqual(caseVisibilityResultMessages(result, "private"), [
            { key: "ethical_cases_designs_made_private_other", values: { count: 2 } },
        ]);
    });

    it("says nothing when the case becomes public", () => {
        const result = { visibility: "public", affectedDesignIds: [], designsKeepingAccess: 3 };

        assert.deepEqual(caseVisibilityResultMessages(result, "private"), []);
    });

    it("says nothing about access when the server gives no count", () => {
        assert.deepEqual(caseVisibilityResultMessages({ visibility: "private" }, "public"), []);
    });
});
