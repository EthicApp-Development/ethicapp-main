// The search and status filters of the Activities page (#1051, epic #1046):
// the search covers the name, description, design, case and code without
// accents or case and with words in any order, each chip of "En curso" lists
// exactly the rows of its status, "Sin iniciar" counts the tab, and both
// round-trip through the URL.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    ACTIVITIES_FILTER_ALL,
    ACTIVITIES_FILTER_IN_PROGRESS,
    ACTIVITIES_FILTER_NOT_STARTED,
    ACTIVITIES_FILTERS,
    ACTIVITIES_QUERY_MAX_LENGTH,
    activitySearchText,
    filterActivityRows,
    noMatchesKeys,
    ongoingFooterKeys,
    queryFromSearch,
    querySearchValue,
    rowMatchesQuery,
    statusFilterChips,
    statusFilterCounts,
    statusFilterFromSearch,
    statusFilterSearchValue,
    tabHasStatusFilter,
} from "../activities-filters.js";
import { buildActivityTables } from "../activities-table.js";

const dates = {
    label: value => (value ? { text: String(value) } : null),
    full:  value => (value ? String(value) : ""),
};

function activity(sessionId, fields = {}) {
    return {
        sessionId,
        name:             `Activity ${sessionId}`,
        description:      "",
        time:             `2026-10-${String(10 + sessionId).padStart(2, "0")}T12:00:00Z`,
        code:             `k${sessionId}`,
        archived:         false,
        status:           "in_progress",
        designId:         40 + sessionId,
        design:           { metainfo: { title: `Activity ${sessionId}` } },
        caseId:           null,
        caseTitle:        null,
        currentPhase:     { number: 1, mode: "individual" },
        phaseCount:       2,
        participantCount: 3,
        finishedAt:       null,
        ...fields,
    };
}

function makeTables() {
    return buildActivityTables([
        activity(1, {
            name:        "Privacidad en apps de salud",
            description: "Ética Profesional · Sección 3",
            design:      { metainfo: { title: "Datos de pacientes" } },
            caseId:      7,
            caseTitle:   "El caso Núñez",
            code:        "QX7RT",
        }),
        activity(2, { status: "initiated", currentPhase: null, name: "Dilema del tranvía" }),
        activity(3, { status: "initiated", currentPhase: null }),
        activity(4, { currentPhase: { number: 2, mode: "team" } }),
        activity(5, {
            status:       "finished",
            currentPhase: null,
            name:         "Conflicto de interés",
            caseId:       8,
            caseTitle:    "Auditoría",
        }),
        activity(6, { status: "finished", currentPhase: null, archived: true, code: "ARCH1" }),
    ], dates);
}

const ids = rows => rows.map(row => row.id).sort((left, right) => left - right);

describe("activities filters, search", () => {
    const tables = makeTables();
    const ongoing = tables.ongoing;
    const search = query => ids(filterActivityRows(ongoing, "ongoing", { query }));

    it("finds an activity by its name, description, design, case or code", () => {
        assert.deepEqual(search("privacidad"), [1]);
        assert.deepEqual(search("Sección 3"), [1]);
        assert.deepEqual(search("pacientes"), [1]);
        assert.deepEqual(search("Núñez"), [1]);
        assert.deepEqual(search("QX7RT"), [1]);
    });

    it("ignores case and accents, and matches the words in any order", () => {
        assert.deepEqual(search("NUNEZ"), [1]);
        assert.deepEqual(search("etica profesional"), [1]);
        assert.deepEqual(search("qx7rt salud"), [1]);
        assert.deepEqual(search("seccion   privacidad"), [1]);
        assert.deepEqual(search("tranvía dilema"), [2]);
    });

    it("needs every word, each in one of the fields", () => {
        assert.deepEqual(search("privacidad tranvía"), []);
    });

    it("lists every row of the tab without a search", () => {
        assert.deepEqual(search(""), [1, 2, 3, 4]);
        assert.deepEqual(search("   "), [1, 2, 3, 4]);
    });

    it("searches in every tab", () => {
        assert.deepEqual(ids(filterActivityRows(tables.finished, "finished",
            { query: "auditoria" })), [5]);
        assert.deepEqual(ids(filterActivityRows(tables.archived, "archived",
            { query: "arch1" })), [6]);
    });

    it("does not search a case the row does not show", () => {
        const [row] = buildActivityTables([activity(9, { caseId: null, caseTitle: "Hidden" })],
            dates).ongoing;
        assert.equal(rowMatchesQuery(row, "hidden"), false);
        assert.ok(!activitySearchText(row).includes("hidden"));
    });

    it("keeps the order of the tab", () => {
        const rows = filterActivityRows(ongoing, "ongoing", { query: "activity" });
        assert.deepEqual(rows.map(row => row.id), [4, 3, 2]);
    });

    it("tolerates a missing list", () => {
        assert.deepEqual(filterActivityRows(undefined, "ongoing"), []);
    });
});

describe("activities filters, status chips", () => {
    const { ongoing, finished } = makeTables();

    it("lists exactly the rows of each status in En curso", () => {
        const byStatus = status => ids(filterActivityRows(ongoing, "ongoing", { status }));
        assert.deepEqual(byStatus(ACTIVITIES_FILTER_ALL), [1, 2, 3, 4]);
        assert.deepEqual(byStatus(ACTIVITIES_FILTER_NOT_STARTED), [2, 3]);
        assert.deepEqual(byStatus(ACTIVITIES_FILTER_IN_PROGRESS), [1, 4]);
        for (const row of ongoing) {
            const matches = [ACTIVITIES_FILTER_NOT_STARTED, ACTIVITIES_FILTER_IN_PROGRESS]
                .filter(status => filterActivityRows([row], "ongoing", { status }).length === 1);
            assert.deepEqual(matches, [row.status.id], `activity ${row.id}`);
        }
    });

    it("combines the filter and the search", () => {
        assert.deepEqual(ids(filterActivityRows(ongoing, "ongoing",
            { status: ACTIVITIES_FILTER_NOT_STARTED, query: "tranvia" })), [2]);
        assert.deepEqual(ids(filterActivityRows(ongoing, "ongoing",
            { status: ACTIVITIES_FILTER_IN_PROGRESS, query: "tranvia" })), []);
    });

    it("applies the status filter to En curso only", () => {
        assert.equal(tabHasStatusFilter("ongoing"), true);
        assert.equal(tabHasStatusFilter("finished"), false);
        assert.equal(tabHasStatusFilter("archived"), false);
        assert.deepEqual(ids(filterActivityRows(finished, "finished",
            { status: ACTIVITIES_FILTER_NOT_STARTED })), [5]);
    });

    it("counts the activities with no phase started, before the search", () => {
        const counts = statusFilterCounts(ongoing);
        assert.deepEqual(counts, { "all": 4, "not-started": 2, "in-progress": 2 });
    });

    it("shows Todas, Sin iniciar with its count, and Con fase en curso", () => {
        assert.deepEqual(statusFilterChips(ongoing, ACTIVITIES_FILTER_NOT_STARTED), [
            { id: "all", key: "activities_filter_all", count: null, active: false },
            { id: "not-started", key: "activities_filter_not_started", count: 2, active: true },
            { id: "in-progress", key: "activities_filter_in_progress", count: null, active: false },
        ]);
        assert.equal(statusFilterChips([], ACTIVITIES_FILTER_ALL)[1].count, 0);
    });
});

describe("activities filters, URL", () => {
    it("reads the status filter, else Todas", () => {
        assert.equal(statusFilterFromSearch({ status: "not-started" }), "not-started");
        assert.equal(statusFilterFromSearch({ status: "in-progress" }), "in-progress");
        assert.equal(statusFilterFromSearch({ status: "finished" }), "all");
        assert.equal(statusFilterFromSearch({}), "all");
        assert.equal(statusFilterFromSearch(undefined), "all");
    });

    it("writes no status for Todas", () => {
        assert.equal(statusFilterSearchValue(ACTIVITIES_FILTER_ALL), null);
        assert.equal(statusFilterSearchValue("bogus"), null);
        for (const filter of ACTIVITIES_FILTERS.slice(1)) {
            assert.equal(statusFilterFromSearch({ status: statusFilterSearchValue(filter) }),
                filter);
        }
    });

    it("reads and writes the search, trimmed and bounded", () => {
        assert.equal(queryFromSearch({ q: "  ética  " }), "ética");
        assert.equal(queryFromSearch({ q: ["a", "b"] }), "");
        assert.equal(queryFromSearch({}), "");
        assert.equal(querySearchValue("   "), null);
        assert.equal(querySearchValue(null), null);
        assert.equal(querySearchValue(" tranvía "), "tranvía");
        assert.equal(querySearchValue("x".repeat(300)).length, ACTIVITIES_QUERY_MAX_LENGTH);
    });
});

describe("activities filters, footer and empty results", () => {
    it("says what the Sin iniciar activities are (frame C)", () => {
        assert.deepEqual(ongoingFooterKeys(ACTIVITIES_FILTER_NOT_STARTED), {
            showingKey: "activities_filter_showing_not_started",
            hintKey:    "activities_filter_hint_not_started",
        });
        for (const filter of [ACTIVITIES_FILTER_ALL, ACTIVITIES_FILTER_IN_PROGRESS]) {
            assert.deepEqual(ongoingFooterKeys(filter), {
                showingKey: "activities_showing",
                hintKey:    "activities_hint_ongoing",
            });
        }
    });

    it("offers to clear the filters in En curso and the search elsewhere", () => {
        assert.deepEqual(noMatchesKeys("ongoing"), {
            messageKey: "activities_filter_no_matches",
            clearKey:   "activities_filter_clear",
        });
        for (const tab of ["finished", "archived"]) {
            assert.deepEqual(noMatchesKeys(tab), {
                messageKey: "activities_search_no_matches",
                clearKey:   "activities_search_clear",
            });
        }
    });
});
