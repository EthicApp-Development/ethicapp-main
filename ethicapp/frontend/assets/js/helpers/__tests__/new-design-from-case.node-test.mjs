// "New design with this case" (#1019, epic #1008): the form's URL with the
// case, and which case the form preselects, as `associableCaseSql` decides.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    NEW_DESIGN_CASE_ARCHIVED,
    NEW_DESIGN_CASE_LOAD_FAILED,
    NEW_DESIGN_CASE_NOT_AVAILABLE,
    isCaseAssociable,
    newDesignCaseLoadErrorKey,
    newDesignCaseRefusalKey,
    newDesignFromCaseHref,
    newDesignFromCasePath,
    requestedCaseFromSearch,
} from "../new-design-from-case.js";

const TEACHER = 650;

function caseOf(fields = {}) {
    return { id: 7, creator: TEACHER, visibility: "private", archived: false, ...fields };
}

describe("new design from a case, the form's URL", () => {
    it("names the case in the form's path and link", () => {
        assert.equal(newDesignFromCasePath(7), "/designs/new?caseId=7");
        assert.equal(newDesignFromCasePath("12"), "/designs/new?caseId=12");
        assert.equal(newDesignFromCaseHref(7), "#!/designs/new?caseId=7");
    });

    it("has no URL for an invalid id", () => {
        for (const id of [null, undefined, 0, -3, 1.5, "7a", "", "../1"]) {
            assert.equal(newDesignFromCasePath(id), null, `id ${String(id)}`);
            assert.equal(newDesignFromCaseHref(id), null, `id ${String(id)}`);
        }
    });

    it("reads the requested case from the search", () => {
        assert.deepEqual(requestedCaseFromSearch({ caseId: "7" }), { requested: true, caseId: 7 });
        assert.deepEqual(requestedCaseFromSearch({ caseId: 7 }), { requested: true, caseId: 7 });
        for (const caseId of ["abc", "-2", "7.5", ["7", "8"]]) {
            assert.deepEqual(requestedCaseFromSearch({ caseId }),
                { requested: true, caseId: null });
        }
    });

    it("requests nothing without the parameter, or with an empty one", () => {
        const searches = [{}, null, undefined, { caseId: "" }, { caseId: true }, { tab: "shared" }];
        for (const search of searches) {
            assert.deepEqual(requestedCaseFromSearch(search), { requested: false, caseId: null });
        }
    });
});

describe("new design from a case, the preselection", () => {
    it("preselects the teacher's own case that is not archived, shared or not", () => {
        for (const fields of [{}, { visibility: "public" }, { creator: String(TEACHER) }]) {
            assert.equal(isCaseAssociable(caseOf(fields), TEACHER), true);
            assert.equal(newDesignCaseRefusalKey(caseOf(fields), TEACHER), null);
        }
    });

    it("preselects another teacher's public case", () => {
        const shared = caseOf({ creator: 9, visibility: "public" });
        assert.equal(isCaseAssociable(shared, TEACHER), true);
        assert.equal(newDesignCaseRefusalKey(shared, TEACHER), null);
    });

    it("refuses the teacher's archived case, naming it archived", () => {
        for (const visibility of ["private", "public"]) {
            const archived = caseOf({ archived: true, visibility });
            assert.equal(isCaseAssociable(archived, TEACHER), false);
            assert.equal(newDesignCaseRefusalKey(archived, TEACHER), NEW_DESIGN_CASE_ARCHIVED);
        }
    });

    it("refuses another teacher's private or archived case without saying which", () => {
        const privateCase = caseOf({ creator: 9 });
        const archivedPublic = caseOf({ creator: 9, visibility: "public", archived: true });
        const archivedPrivate = caseOf({ creator: 9, archived: true });
        for (const caseItem of [privateCase, archivedPublic, archivedPrivate, null]) {
            assert.equal(isCaseAssociable(caseItem, TEACHER), false);
            assert.equal(newDesignCaseRefusalKey(caseItem, TEACHER), NEW_DESIGN_CASE_NOT_AVAILABLE);
        }
    });

    it("does not take a private case as the teacher's own without their id", () => {
        assert.equal(isCaseAssociable(caseOf(), null), false);
        assert.equal(newDesignCaseRefusalKey(caseOf(), undefined), NEW_DESIGN_CASE_NOT_AVAILABLE);
        assert.equal(isCaseAssociable(caseOf({ visibility: "public" }), null), true);
    });

    it("tells a case the teacher cannot read from a failed load", () => {
        assert.equal(newDesignCaseLoadErrorKey({ status: 404 }), NEW_DESIGN_CASE_NOT_AVAILABLE);
        assert.equal(newDesignCaseLoadErrorKey({ status: 400 }), NEW_DESIGN_CASE_NOT_AVAILABLE);
        assert.equal(newDesignCaseLoadErrorKey({ status: 500 }), NEW_DESIGN_CASE_LOAD_FAILED);
        assert.equal(newDesignCaseLoadErrorKey(new Error("offline")), NEW_DESIGN_CASE_LOAD_FAILED);
    });
});
