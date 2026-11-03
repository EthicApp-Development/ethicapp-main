// The cases table's status helper (#1011, epic #1008): the status from the
// usage counts and the render job, the shared and archived flags, and the
// teacher's imported copy of a shared case.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    CASE_STATUS_IN_USE,
    CASE_STATUS_PDF_ERROR,
    CASE_STATUS_PROCESSING,
    CASE_STATUS_READY,
    deriveCaseStatus,
    findImportedCopy,
    importedCopiesBySource,
} from "../case-status.js";

function usage(overrides = {}) {
    return {
        activityCount:     0,
        ownDesignCount:    0,
        otherDesignCount:  0,
        otherTeacherCount: 0,
        ...overrides,
    };
}

function renderJob(status, overrides = {}) {
    return { id: 1, status, pageCount: status === "completed" ? 3 : null, ...overrides };
}

// A case of GET /cases?scope=own.
function caseItem(id, overrides = {}) {
    return {
        id,
        title:              `Case ${id}`,
        pdfPath:            `/uploads/cases/${id}/case.pdf`,
        visibility:         "private",
        public:             false,
        archived:           false,
        originalCaseId:     null,
        importedFromCaseId: null,
        documentProcessing: renderJob("completed"),
        usage:              usage(),
        ...overrides,
    };
}

describe("deriveCaseStatus (#1011)", () => {
    it("is ready for a rendered case no design uses", () => {
        assert.deepEqual(deriveCaseStatus(caseItem(1)), {
            status:        CASE_STATUS_READY,
            activityCount: 0,
            shared:        false,
            archived:      false,
        });
    });

    it("is ready for a case that designs use without activities", () => {
        const own = caseItem(1, { usage: usage({ ownDesignCount: 2 }) });
        const others = caseItem(2, {
            usage: usage({ ownDesignCount: 1, otherDesignCount: 3, otherTeacherCount: 2 }),
        });

        assert.equal(deriveCaseStatus(own).status, CASE_STATUS_READY);
        assert.equal(deriveCaseStatus(others).status, CASE_STATUS_READY);
    });

    it("is in use, with the activity count, when an activity was launched", () => {
        const result = deriveCaseStatus(caseItem(1, {
            usage: usage({ activityCount: 4, ownDesignCount: 1, otherDesignCount: 1 }),
        }));

        assert.equal(result.status, CASE_STATUS_IN_USE);
        assert.equal(result.activityCount, 4);
    });

    it("is pdf-error when rendering failed", () => {
        const result = deriveCaseStatus(caseItem(1, {
            documentProcessing: renderJob("failed", { errorMessage: "Broken PDF" }),
        }));

        assert.equal(result.status, CASE_STATUS_PDF_ERROR);
        assert.equal(result.activityCount, 0);
    });

    it("is processing while the render job is pending or processed", () => {
        for (const status of ["pending", "processing"]) {
            const result = deriveCaseStatus(caseItem(1, { documentProcessing: renderJob(status) }));
            assert.equal(result.status, CASE_STATUS_PROCESSING, status);
        }
    });

    it("is processing for a job waiting to retry after a failed attempt", () => {
        const result = deriveCaseStatus(caseItem(1, {
            documentProcessing: renderJob("pending", { attemptCount: 1, errorMessage: "Timeout" }),
        }));

        assert.equal(result.status, CASE_STATUS_PROCESSING);
    });

    it("puts in use before a failed or pending PDF", () => {
        for (const status of ["failed", "pending", "processing"]) {
            const result = deriveCaseStatus(caseItem(1, {
                documentProcessing: renderJob(status),
                usage:              usage({ activityCount: 1, ownDesignCount: 1 }),
            }));
            assert.equal(result.status, CASE_STATUS_IN_USE, status);
            assert.equal(result.activityCount, 1);
        }
    });

    it("is ready for a case without a render job, shown with its PDF", () => {
        assert.equal(deriveCaseStatus(caseItem(1, { documentProcessing: null })).status,
            CASE_STATUS_READY);
        assert.equal(deriveCaseStatus(caseItem(1, { documentProcessing: undefined })).status,
            CASE_STATUS_READY);
    });

    it("is ready for a render status it does not know", () => {
        const result = deriveCaseStatus(caseItem(1, { documentProcessing: renderJob("other") }));

        assert.equal(result.status, CASE_STATUS_READY);
    });

    it("describes only the document of a case without usage, as shared cases come", () => {
        const shared = caseItem(1, {
            visibility:         "public",
            public:             true,
            documentProcessing: renderJob("failed"),
            usage:              undefined,
        });

        assert.deepEqual(deriveCaseStatus(shared), {
            status:        CASE_STATUS_PDF_ERROR,
            activityCount: 0,
            shared:        true,
            archived:      false,
        });
    });

    it("flags a shared case, by visibility or by the public flag", () => {
        assert.equal(deriveCaseStatus(caseItem(1, { visibility: "public" })).shared, true);
        assert.equal(deriveCaseStatus(caseItem(1, { public: true })).shared, true);
        assert.equal(deriveCaseStatus(caseItem(1)).shared, false);
    });

    it("flags an archived case and keeps its status", () => {
        const result = deriveCaseStatus(caseItem(1, {
            archived: true,
            usage:    usage({ activityCount: 2, ownDesignCount: 1 }),
        }));

        assert.equal(result.archived, true);
        assert.equal(result.status, CASE_STATUS_IN_USE);
    });

    it("ignores counts that are not positive integers", () => {
        for (const activityCount of [-1, 0.5, "x", null]) {
            const result = deriveCaseStatus(caseItem(1, { usage: usage({ activityCount }) }));
            assert.equal(result.status, CASE_STATUS_READY, String(activityCount));
            assert.equal(result.activityCount, 0);
        }
    });

    it("tolerates a missing case", () => {
        assert.deepEqual(deriveCaseStatus(undefined), {
            status:        CASE_STATUS_READY,
            activityCount: 0,
            shared:        false,
            archived:      false,
        });
    });
});

describe("importedCopiesBySource and findImportedCopy (#1011)", () => {
    const shared = caseItem(50, { visibility: "public", public: true, usage: undefined });

    it("finds the teacher's import of a shared case", () => {
        const copy = caseItem(60, { importedFromCaseId: 50, originalCaseId: 50 });
        const copies = importedCopiesBySource([copy, caseItem(61)]);

        assert.equal(findImportedCopy(shared, copies), copy);
    });

    it("finds an archived import", () => {
        const archivedCopy = caseItem(60, { importedFromCaseId: 50, archived: true });
        const copies = importedCopiesBySource([caseItem(61), archivedCopy]);

        assert.equal(findImportedCopy(shared, copies), archivedCopy);
    });

    it("prefers an active copy, then the newest", () => {
        const archivedNewer = caseItem(70, { importedFromCaseId: 50, archived: true });
        const activeOlder = caseItem(60, { importedFromCaseId: 50 });
        const activeNewer = caseItem(65, { importedFromCaseId: 50 });

        assert.equal(
            findImportedCopy(shared, importedCopiesBySource([archivedNewer, activeOlder])),
            activeOlder,
        );
        const copies = importedCopiesBySource([activeOlder, activeNewer, archivedNewer]);
        assert.equal(findImportedCopy(shared, copies), activeNewer);
    });

    it("does not count a copy that only shares the root case", () => {
        // The teacher imported 55, another teacher's copy of 50.
        const copyOfCopy = caseItem(60, { importedFromCaseId: 55, originalCaseId: 50 });
        const copies = importedCopiesBySource([copyOfCopy]);

        assert.equal(findImportedCopy(shared, copies), null);
        assert.equal(findImportedCopy(caseItem(55, { public: true }), copies), copyOfCopy);
    });

    it("matches nothing for a copy whose source was deleted, or a case linked to itself", () => {
        const orphan = caseItem(60, { importedFromCaseId: null, originalCaseId: null });
        const selfLinked = caseItem(50, { importedFromCaseId: 50 });

        assert.equal(findImportedCopy(shared, importedCopiesBySource([orphan, selfLinked])), null);
    });

    it("returns null without copies or a shared case", () => {
        assert.equal(findImportedCopy(shared, importedCopiesBySource([])), null);
        assert.equal(findImportedCopy(shared, importedCopiesBySource(null)), null);
        assert.equal(findImportedCopy(shared, undefined), null);
        assert.equal(findImportedCopy(null, importedCopiesBySource([caseItem(60)])), null);
    });
});
