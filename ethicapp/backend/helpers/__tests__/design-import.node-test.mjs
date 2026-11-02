import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isCaseCopyableBy, isListedDesignImportableBy } from "../design-import.js";

const TEACHER = 7;
const AUTHOR = 3;

// A row of GET /designs for another teacher's public design.
function listedRow(caseFields) {
    return {
        id:         40,
        case_id:    12,
        user_owned: false,
        case_found: true,
        ...caseFields,
    };
}

// Whether TEACHER may copy a case with these columns.
function copyable(creator, visibility, archived) {
    return isCaseCopyableBy({ creator, visibility, archived }, TEACHER);
}

describe("isCaseCopyableBy (#974)", () => {
    it("lets a teacher copy a public case that is not archived", () => {
        assert.equal(copyable(AUTHOR, "public", false), true);
        assert.equal(copyable(AUTHOR, "public", null), true);
    });

    it("refuses another teacher's case that is private", () => {
        assert.equal(copyable(AUTHOR, "private", false), false);
        assert.equal(copyable(AUTHOR, null, false), false);
    });

    it("refuses another teacher's public case that is archived", () => {
        assert.equal(copyable(AUTHOR, "public", true), false);
    });

    it("lets a teacher copy their own case whatever its visibility", () => {
        assert.equal(copyable(TEACHER, "private", true), true);
        assert.equal(copyable(String(TEACHER), "private", undefined), true);
    });

    it("refuses a case that was not found, or has no creator and is private", () => {
        assert.equal(isCaseCopyableBy(null, TEACHER), false);
        assert.equal(isCaseCopyableBy(undefined, TEACHER), false);
        assert.equal(isCaseCopyableBy({ creator: null, visibility: "private" }, 0), false);
    });
});

describe("isListedDesignImportableBy (#974)", () => {
    it("is true for a design whose case is public", () => {
        const row = listedRow({
            case_creator:    AUTHOR,
            case_visibility: "public",
            case_archived:   false,
        });
        assert.equal(isListedDesignImportableBy(row, TEACHER), true);
    });

    it("is false for a design whose case stopped being public", () => {
        const row = listedRow({
            case_creator:    AUTHOR,
            case_visibility: "private",
            case_archived:   false,
        });
        assert.equal(isListedDesignImportableBy(row, TEACHER), false);
    });

    it("is false for a design whose public case was archived", () => {
        const row = listedRow({
            case_creator:    AUTHOR,
            case_visibility: "public",
            case_archived:   true,
        });
        assert.equal(isListedDesignImportableBy(row, TEACHER), false);
    });

    it("is true when the private case belongs to the importing teacher", () => {
        const row = listedRow({
            case_creator:    TEACHER,
            case_visibility: "private",
            case_archived:   false,
        });
        assert.equal(isListedDesignImportableBy(row, TEACHER), true);
    });

    it("is true for a design without a case", () => {
        const row = { id: 40, case_id: null, user_owned: false };
        assert.equal(isListedDesignImportableBy(row, TEACHER), true);
    });

    it("is false when the case row is missing", () => {
        const row = listedRow({
            case_found:      false,
            case_creator:    null,
            case_visibility: null,
            case_archived:   null,
        });
        assert.equal(isListedDesignImportableBy(row, TEACHER), false);
    });

    it("agrees with the import's rule on every case combination", () => {
        for (const creator of [AUTHOR, TEACHER, null]) {
            for (const visibility of ["public", "private", null]) {
                for (const archived of [true, false, null]) {
                    const row = listedRow({
                        case_creator:    creator,
                        case_visibility: visibility,
                        case_archived:   archived,
                    });
                    assert.equal(
                        isListedDesignImportableBy(row, TEACHER),
                        isCaseCopyableBy({ creator, visibility, archived }, TEACHER),
                        JSON.stringify({ creator, visibility, archived }),
                    );
                }
            }
        }
    });
});
