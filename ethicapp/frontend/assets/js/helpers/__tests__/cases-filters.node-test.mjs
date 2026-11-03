// The search and status filters of "My cases" (#1015, epic #1008): each chip
// lists exactly the rows of its status, "PDF error" shows only when a case has
// one, the search covers title, authors and tags without accents or case, and
// both round-trip through the URL.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    CASES_FILTER_ALL,
    CASES_FILTER_IN_USE,
    CASES_FILTER_PDF_ERROR,
    CASES_FILTER_READY,
    CASES_FILTER_SHARED,
    CASES_FILTERS,
    caseSearchText,
    filterCaseRows,
    queryFromSearch,
    querySearchValue,
    statusFilterChips,
    statusFilterCounts,
    statusFilterFromSearch,
    statusFilterSearchValue,
} from "../cases-filters.js";
import { buildCaseTables } from "../cases-table.js";

const NO_USE = { activityCount: 0, ownDesignCount: 0, otherDesignCount: 0, otherTeacherCount: 0 };

function own(id, title, fields = {}) {
    return { id, title, visibility: "private", usage: { ...NO_USE }, ...fields };
}

function makeRows(extra = []) {
    return buildCaseTables({
        own: [
            own(1, "Ética en la IA", {
                authors: [{ authorFirstname: "Camila", authorLastname: "Núñez" }],
                tags:    [{ label: "Evaluación" }, { label: "Privacidad" }],
            }),
            own(2, "Prioridades en emergencias", { documentProcessing: { status: "processing" } }),
            own(3, "PDF roto", { documentProcessing: { status: "failed" }, visibility: "public" }),
            own(4, "Datos de pacientes", {
                usage:      { ...NO_USE, activityCount: 2 },
                visibility: "public",
                tags:       [{ label: "Salud" }],
            }),
            own(5, "Conflicto de interés", {
                documentProcessing: { status: "completed", pageCount: 3 },
                authorFirstname:    "Tomás",
                authorLastname:     "Pérez",
            }),
            ...extra,
        ],
    }).mine;
}

const ids = rows => rows.map(row => row.id).sort((left, right) => left - right);

describe("cases filters, status chips", () => {
    const rows = makeRows();

    it("lists every case of My cases under All", () => {
        assert.deepEqual(ids(filterCaseRows(rows)), [1, 2, 3, 4, 5]);
        assert.deepEqual(ids(filterCaseRows(rows, { status: CASES_FILTER_ALL })), [1, 2, 3, 4, 5]);
    });

    it("lists exactly the cases of each status, a processing case under All only", () => {
        assert.deepEqual(ids(filterCaseRows(rows, { status: CASES_FILTER_READY })), [1, 5]);
        assert.deepEqual(ids(filterCaseRows(rows, { status: CASES_FILTER_IN_USE })), [4]);
        assert.deepEqual(ids(filterCaseRows(rows, { status: CASES_FILTER_PDF_ERROR })), [3]);
        for (const row of rows) {
            const matches = CASES_FILTERS.filter(filter => filter !== CASES_FILTER_ALL &&
                filter !== CASES_FILTER_SHARED &&
                filterCaseRows([row], { status: filter }).length === 1);
            assert.equal(matches.length, row.statusInfo.status === "processing" ? 0 : 1,
                `case ${row.id} is under one status chip at most`);
        }
    });

    it("lists the shared cases whatever their status", () => {
        assert.deepEqual(ids(filterCaseRows(rows, { status: CASES_FILTER_SHARED })), [3, 4]);
    });

    it("counts each filter before the search", () => {
        assert.deepEqual(statusFilterCounts(rows), {
            [CASES_FILTER_ALL]:       5,
            [CASES_FILTER_READY]:     2,
            [CASES_FILTER_IN_USE]:    1,
            [CASES_FILTER_SHARED]:    2,
            [CASES_FILTER_PDF_ERROR]: 1,
        });
        assert.deepEqual(statusFilterCounts(null)[CASES_FILTER_ALL], 0);
    });

    it("gives the chips in order, with the PDF errors counted and the active one marked", () => {
        const chips = statusFilterChips(rows, CASES_FILTER_IN_USE);
        assert.deepEqual(chips.map(chip => chip.id), CASES_FILTERS);
        assert.deepEqual(chips.map(chip => chip.key), [
            "cases_filter_all",
            "cases_filter_ready",
            "cases_filter_in_use",
            "cases_filter_shared",
            "cases_filter_pdf_error",
        ]);
        assert.deepEqual(chips.map(chip => chip.count), [null, null, null, null, 1]);
        assert.deepEqual(chips.filter(chip => chip.active).map(chip => chip.id),
            [CASES_FILTER_IN_USE]);
    });

    it("shows PDF error only while a case has one, or while it is active", () => {
        const healthy = rows.filter(row => row.id !== 3);
        assert.deepEqual(statusFilterChips(healthy, CASES_FILTER_ALL).map(chip => chip.id),
            [CASES_FILTER_ALL, CASES_FILTER_READY, CASES_FILTER_IN_USE, CASES_FILTER_SHARED]);
        const kept = statusFilterChips(healthy, CASES_FILTER_PDF_ERROR).at(-1);
        assert.deepEqual(kept, {
            id: CASES_FILTER_PDF_ERROR, key: "cases_filter_pdf_error", count: 0, active: true,
        });
    });

    it("lists a case in use whose PDF failed under In use, as its status says", () => {
        const both = makeRows([own(6, "Usado y roto", {
            usage:              { ...NO_USE, activityCount: 1 },
            documentProcessing: { status: "failed" },
        })]);
        assert.deepEqual(ids(filterCaseRows(both, { status: CASES_FILTER_IN_USE })), [4, 6]);
        assert.deepEqual(ids(filterCaseRows(both, { status: CASES_FILTER_PDF_ERROR })), [3]);
    });
});

describe("cases filters, search", () => {
    const rows = makeRows();
    const search = query => ids(filterCaseRows(rows, { query }));

    it("matches the title without accents or case", () => {
        assert.deepEqual(search("etica"), [1]);
        assert.deepEqual(search("CONFLICTO"), [5]);
        assert.deepEqual(search("  "), [1, 2, 3, 4, 5]);
    });

    it("matches the authors' names, from the authors list or the case's own author", () => {
        assert.deepEqual(search("nunez"), [1]);
        assert.deepEqual(search("camila núñez"), [1]);
        assert.deepEqual(search("tomas"), [5]);
    });

    it("matches the tags' labels", () => {
        assert.deepEqual(search("evaluacion"), [1]);
        assert.deepEqual(search("salud"), [4]);
    });

    it("needs every word, in any of the fields", () => {
        assert.deepEqual(search("ia privacidad"), [1]);
        assert.deepEqual(search("ia salud"), []);
    });

    it("combines with the status filter", () => {
        assert.deepEqual(ids(filterCaseRows(rows, { status: CASES_FILTER_SHARED, query: "datos" })),
            [4]);
        assert.deepEqual(ids(filterCaseRows(rows, { status: CASES_FILTER_READY, query: "datos" })),
            []);
    });

    it("reads a case without authors or tags", () => {
        assert.equal(caseSearchText({ title: "Solo título" }), "solo titulo");
        assert.equal(caseSearchText(null), "");
        assert.deepEqual(filterCaseRows([{ id: 9 }], { query: "x" }), []);
    });
});

describe("cases filters, URL", () => {
    it("reads the status filter, falling back to All", () => {
        assert.equal(statusFilterFromSearch({ status: "in-use" }), CASES_FILTER_IN_USE);
        assert.equal(statusFilterFromSearch({ status: "pdf-error" }), CASES_FILTER_PDF_ERROR);
        assert.equal(statusFilterFromSearch({ status: "processing" }), CASES_FILTER_ALL);
        assert.equal(statusFilterFromSearch({}), CASES_FILTER_ALL);
        assert.equal(statusFilterFromSearch(undefined), CASES_FILTER_ALL);
    });

    it("writes no status for All", () => {
        assert.equal(statusFilterSearchValue(CASES_FILTER_ALL), null);
        assert.equal(statusFilterSearchValue("nonsense"), null);
        assert.equal(statusFilterSearchValue(CASES_FILTER_SHARED), "shared");
    });

    it("reads and writes the search trimmed, and none when blank", () => {
        assert.equal(queryFromSearch({ q: "  ética " }), "ética");
        assert.equal(queryFromSearch({ q: ["a", "b"] }), "");
        assert.equal(queryFromSearch({}), "");
        assert.equal(queryFromSearch({ q: "x".repeat(300) }).length, 200);
        assert.equal(querySearchValue(" ética "), "ética");
        assert.equal(querySearchValue("   "), null);
        assert.equal(querySearchValue(undefined), null);
    });
});
