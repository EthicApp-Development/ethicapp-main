// The search and status filters of "My designs" (#976, epic #966): each chip
// lists exactly the rows of its status, the search ignores accents and case,
// and both round-trip through the URL.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    DESIGNS_FILTER_ALL,
    DESIGNS_FILTER_ERRORS,
    DESIGNS_FILTER_IN_USE,
    DESIGNS_FILTER_READY,
    DESIGNS_FILTER_SHARED,
    DESIGNS_FILTERS,
    filterDesignRows,
    queryFromSearch,
    querySearchValue,
    statusFilterChips,
    statusFilterCounts,
    statusFilterFromSearch,
    statusFilterSearchValue,
} from "../designs-filters.js";
import { buildDesignTables } from "../designs-table.js";

function makeRows() {
    const own = (id, title, fields) => ({
        id, userOwned: true, valid: true, visibility: "private", metainfo: { title }, ...fields,
    });
    const designs = [
        own(1, "Ética en la IA", {
            associatedCase: { title: "El ensayo de Camila" },
            tags:           [{ label: "Evaluación" }],
            visibility:     "public",
        }),
        own(2, "Prioridades en emergencias", { valid: false }),
        own(3, "Borrador sin caso", { valid: false, visibility: "public" }),
        own(4, "Privacidad en apps de salud", {
            associatedCase: { title: "Datos de pacientes" }, visibility: "public",
        }),
        own(5, "Conflicto de interés", { locked: true }),
        own(6, "Archivado", { archived: true }),
        { ...own(7, "Theirs", { visibility: "public" }), userOwned: false },
    ];
    return buildDesignTables(designs, [{ designId: 4 }, { designId: 4 }]).mine;
}

const ids = rows => rows.map(row => row.id).sort((left, right) => left - right);

describe("designs filters, status chips", () => {
    const rows = makeRows();

    it("lists every design of My designs under All", () => {
        assert.deepEqual(ids(filterDesignRows(rows)), [1, 2, 3, 4, 5]);
        const all = filterDesignRows(rows, { status: DESIGNS_FILTER_ALL });
        assert.deepEqual(ids(all), [1, 2, 3, 4, 5]);
    });

    it("lists exactly the designs of each status", () => {
        assert.deepEqual(ids(filterDesignRows(rows, { status: DESIGNS_FILTER_READY })), [1]);
        assert.deepEqual(ids(filterDesignRows(rows, { status: DESIGNS_FILTER_ERRORS })), [2, 3]);
        assert.deepEqual(ids(filterDesignRows(rows, { status: DESIGNS_FILTER_IN_USE })), [4, 5]);
    });

    it("lists the designs whose sharing switch is on under Shared, whatever their status", () => {
        assert.deepEqual(ids(filterDesignRows(rows, { status: DESIGNS_FILTER_SHARED })), [1, 3, 4]);
    });

    it("agrees with each row's Status column", () => {
        for (const filter of [DESIGNS_FILTER_READY, DESIGNS_FILTER_ERRORS, DESIGNS_FILTER_IN_USE]) {
            for (const row of filterDesignRows(rows, { status: filter })) {
                assert.equal(row.statusInfo.status, filter);
            }
        }
    });

    it("counts each filter over the whole tab", () => {
        assert.deepEqual(statusFilterCounts(rows), {
            all: 5, ready: 1, errors: 2, "in-use": 2, shared: 3,
        });
    });

    it("draws the chips in order, with the count on With errors only", () => {
        const chips = statusFilterChips(rows, DESIGNS_FILTER_ERRORS);
        assert.deepEqual(chips.map(chip => chip.id), DESIGNS_FILTERS);
        assert.deepEqual(chips.map(chip => chip.key), [
            "designs_filter_all",
            "designs_filter_ready",
            "designs_filter_errors",
            "designs_filter_in_use",
            "designs_filter_shared",
        ]);
        assert.deepEqual(chips.map(chip => chip.count), [null, null, 2, null, null]);
        assert.deepEqual(chips.filter(chip => chip.active).map(chip => chip.id), ["errors"]);
    });

    it("counts no errors in an empty tab", () => {
        assert.equal(statusFilterChips([], DESIGNS_FILTER_ALL)[2].count, 0);
        assert.deepEqual(filterDesignRows(null), []);
    });

    it("offers no type filter", () => {
        assert.equal(DESIGNS_FILTERS.some(filter => /type|ranking|semantic/u.test(filter)), false);
    });
});

describe("designs filters, search", () => {
    const rows = makeRows();

    it("finds a design by title, case or tag, ignoring accents and case", () => {
        assert.deepEqual(ids(filterDesignRows(rows, { query: "etica" })), [1]);
        assert.deepEqual(ids(filterDesignRows(rows, { query: "CAMILA" })), [1]);
        assert.deepEqual(ids(filterDesignRows(rows, { query: "evaluacion" })), [1]);
        assert.deepEqual(ids(filterDesignRows(rows, { query: "pacientes" })), [4]);
        assert.deepEqual(ids(filterDesignRows(rows, { query: "interes" })), [5]);
    });

    it("needs every word to match", () => {
        assert.deepEqual(ids(filterDesignRows(rows, { query: "privacidad pacientes" })), [4]);
        assert.deepEqual(ids(filterDesignRows(rows, { query: "privacidad camila" })), []);
    });

    it("combines with the status filter", () => {
        const withErrors = filterDesignRows(rows, { query: "en", status: DESIGNS_FILTER_ERRORS });
        const shared = filterDesignRows(rows, { query: "en", status: DESIGNS_FILTER_SHARED });
        assert.deepEqual(ids(withErrors), [2]);
        assert.deepEqual(ids(shared), [1, 4]);
    });

    it("leaves the chips' counts unchanged", () => {
        assert.equal(statusFilterChips(rows, DESIGNS_FILTER_ALL)[2].count, 2);
    });
});

describe("designs filters, URL", () => {
    it("reads the status filter, falling back to All", () => {
        assert.equal(statusFilterFromSearch({ status: "errors" }), "errors");
        assert.equal(statusFilterFromSearch({ status: "in-use" }), "in-use");
        assert.equal(statusFilterFromSearch({ status: "type" }), "all");
        assert.equal(statusFilterFromSearch({ status: true }), "all");
        assert.equal(statusFilterFromSearch({}), "all");
        assert.equal(statusFilterFromSearch(undefined), "all");
    });

    it("writes no status for All", () => {
        assert.equal(statusFilterSearchValue("all"), null);
        assert.equal(statusFilterSearchValue("errors"), "errors");
        assert.equal(statusFilterSearchValue("nonsense"), null);
    });

    it("reads and writes the search, trimmed and without a blank value", () => {
        assert.equal(queryFromSearch({ q: "  ética " }), "ética");
        assert.equal(queryFromSearch({ q: true }), "");
        assert.equal(queryFromSearch({}), "");
        assert.equal(querySearchValue(" ética "), "ética");
        assert.equal(querySearchValue("   "), null);
        assert.equal(querySearchValue(undefined), null);
        assert.equal(querySearchValue("x".repeat(500)).length, 200);
    });
});
