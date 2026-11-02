// The designs table's status helper (#974, epic #966): status, error and
// activity counts, the shared and archived flags, and the imported copy of a
// shared design.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    activityCountsByDesign,
    countDesignErrors,
    deriveDesignStatus,
    deriveImportState,
    findImportedCopy,
    importedCopiesBySource,
} from "../design-status.js";

function validQuestion() {
    return {
        q_text:     "How fair was this decision?",
        ans_format: { l_pole: "Unfair", r_pole: "Fair", values: 7 },
    };
}

function validPhases() {
    return [{ mode: "individual", instructions: "Answer.", questions: [validQuestion()] }];
}

function design(id, overrides = {}) {
    return {
        id,
        type:                 "semantic_differential",
        userOwned:            true,
        archived:             false,
        valid:                true,
        locked:               false,
        public:               false,
        visibility:           "private",
        originalDesignId:     null,
        importedFromDesignId: null,
        metainfo:             { title: `Design ${id}` },
        phases:               validPhases(),
        ...overrides,
    };
}

// Two errors in phase 1's item (question text, right pole) and one in phase 2
// (missing instructions).
function designWithThreeErrors(id, overrides = {}) {
    return design(id, {
        valid:  false,
        phases: [
            {
                mode:         "individual",
                instructions: "Answer.",
                questions:    [{ q_text: "", ans_format: { l_pole: "Unfair", r_pole: "" } }],
            },
            { mode: "individual", instructions: "", questions: [validQuestion()] },
        ],
        ...overrides,
    });
}

describe("countDesignErrors (#974)", () => {
    it("counts nothing for a valid design", () => {
        assert.equal(countDesignErrors(design(1)), 0);
    });

    it("counts each message of the editor's validator", () => {
        assert.equal(countDesignErrors(designWithThreeErrors(1)), 3);
    });

    it("counts a design without phases as one error", () => {
        assert.equal(countDesignErrors(design(1, { phases: [] })), 1);
    });
});

describe("activityCountsByDesign (#974)", () => {
    it("counts the activities of each design, in either spelling", () => {
        const counts = activityCountsByDesign([
            { id: 1, designId: 10 },
            { id: 2, designId: 10 },
            { id: 3, designid: "11" },
            { id: 4, designId: null },
        ]);
        assert.equal(counts.get(10), 2);
        assert.equal(counts.get(11), 1);
        assert.equal(counts.size, 2);
    });

    it("is empty without activities", () => {
        assert.equal(activityCountsByDesign(undefined).size, 0);
    });
});

describe("deriveDesignStatus (#974)", () => {
    it("says a valid design is ready", () => {
        assert.deepEqual(deriveDesignStatus(design(1)), {
            status:        "ready",
            errorCount:    0,
            activityCount: 0,
            shared:        false,
            archived:      false,
            own:           true,
        });
    });

    it("says a design with errors has errors, with their number", () => {
        const status = deriveDesignStatus(designWithThreeErrors(1));
        assert.equal(status.status, "errors");
        assert.equal(status.errorCount, 3);
    });

    it("follows the stored valid flag, as the launch wizard does", () => {
        // Flag stale: the validator finds nothing, the design still is not launchable.
        const stale = deriveDesignStatus(design(1, { valid: false }));
        assert.equal(stale.status, "errors");
        assert.equal(stale.errorCount, 0);

        const missingFlag = deriveDesignStatus(design(1, { valid: undefined }));
        assert.equal(missingFlag.status, "errors");
    });

    it("says a design used by activities is in use, with their number", () => {
        const counts = activityCountsByDesign([{ designId: 1 }, { designId: 1 }, { designId: 2 }]);
        const status = deriveDesignStatus(design(1, { locked: true }), counts);
        assert.equal(status.status, "in-use");
        assert.equal(status.activityCount, 2);
        assert.equal(status.errorCount, 0);
    });

    it("puts in use before errors", () => {
        const counts = activityCountsByDesign([{ designId: 1 }]);
        const status = deriveDesignStatus(designWithThreeErrors(1), counts);
        assert.equal(status.status, "in-use");
        assert.equal(status.errorCount, 0);
    });

    it("says a locked design is in use even without activities of this teacher", () => {
        const status = deriveDesignStatus(design(1, { locked: true }));
        assert.equal(status.status, "in-use");
        assert.equal(status.activityCount, 0);
    });

    it("flags a shared design and keeps its status", () => {
        const status = deriveDesignStatus(design(1, { public: true, visibility: "public" }));
        assert.equal(status.shared, true);
        assert.equal(status.status, "ready");
    });

    it("flags an archived design and keeps its status", () => {
        const status = deriveDesignStatus(designWithThreeErrors(1, { archived: true }));
        assert.equal(status.archived, true);
        assert.equal(status.status, "errors");
        assert.equal(status.errorCount, 3);
    });

    it("says whether the design is the teacher's own", () => {
        assert.equal(deriveDesignStatus(design(1, { userOwned: false })).own, false);
    });
});

describe("importedCopiesBySource and findImportedCopy (#974)", () => {
    const shared = design(50, {
        userOwned: false, public: true, visibility: "public", importable: true,
    });

    it("finds the teacher's import of a shared design", () => {
        const copy = design(60, { importedFromDesignId: 50, originalDesignId: 50 });
        const copies = importedCopiesBySource([shared, copy, design(61)]);
        assert.equal(findImportedCopy(shared, copies), copy);
    });

    it("finds a copy of the teacher's copy through originalDesignId", () => {
        const copyOfCopy = design(62, { importedFromDesignId: 60, originalDesignId: 50 });
        const copies = importedCopiesBySource([shared, copyOfCopy]);
        assert.equal(findImportedCopy(shared, copies), copyOfCopy);
    });

    it("prefers the direct import, then an active copy, then the newest", () => {
        const direct = design(60, { importedFromDesignId: 50, originalDesignId: 50 });
        const copyOfCopy = design(70, { importedFromDesignId: 60, originalDesignId: 50 });
        assert.equal(
            findImportedCopy(shared, importedCopiesBySource([copyOfCopy, direct])),
            direct,
        );

        const archived = design(80, { importedFromDesignId: 50, archived: true });
        assert.equal(
            findImportedCopy(shared, importedCopiesBySource([archived, direct])),
            direct,
        );

        const newer = design(90, { importedFromDesignId: 50 });
        assert.equal(
            findImportedCopy(shared, importedCopiesBySource([direct, newer])),
            newer,
        );
    });

    it("ignores other teachers' designs and copies whose source was deleted", () => {
        const othersCopy = design(60, { userOwned: false, importedFromDesignId: 50 });
        const orphan = design(61, { importedFromDesignId: null, originalDesignId: null });
        const copies = importedCopiesBySource([shared, othersCopy, orphan]);
        assert.equal(findImportedCopy(shared, copies), null);
    });
});

describe("deriveImportState (#974)", () => {
    const shared = (overrides) => design(50, {
        userOwned: false, public: true, visibility: "public", ...overrides,
    });

    it("offers import for an importable design", () => {
        assert.deepEqual(
            deriveImportState(shared({ importable: true }), new Map()),
            { state: "importable", copy: null },
        );
    });

    it("says a design whose case stopped being public cannot be imported", () => {
        assert.deepEqual(
            deriveImportState(shared({ importable: false }), new Map()),
            { state: "not-importable", copy: null },
        );
    });

    it("shows the copy of a design already imported, even if not importable", () => {
        const copy = design(60, { importedFromDesignId: 50 });
        const copies = importedCopiesBySource([copy]);
        assert.deepEqual(
            deriveImportState(shared({ importable: false }), copies),
            { state: "imported", copy },
        );
    });
});
