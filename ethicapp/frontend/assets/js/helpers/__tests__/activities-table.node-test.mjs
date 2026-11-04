// The Activities page's tables (#1050, epic #1046): each tab's columns, each
// row's title and case, status, participants and dates, and its visible
// action and "⋯" menu, by tab and status.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    ACTIVITIES_PAGE_SIZE,
    activityCaseOf,
    activityDesignTitle,
    activityMetaParts,
    buildActivityRow,
    buildActivityTables,
    finishedCell,
    launchedCell,
    participantsLabel,
    primaryRowAction,
    rowMenuEntries,
    statusCell,
    tabFromSearch,
    tabSearchValue,
    tableColumns,
} from "../activities-table.js";
import { createActivityDateFormatter } from "../activity-dates.js";

const NOW = new Date("2026-11-03T18:00:00Z");
const dates = createActivityDateFormatter({
    uiLanguage: "es_CL", now: NOW, timeZone: "America/Santiago",
});

const CASE = { id: 7, title: "Datos de pacientes en la nube" };

function activity(sessionId, fields = {}) {
    return {
        id:                sessionId + 100,
        sessionId,
        name:              "Privacidad en apps de salud",
        description:       "Sección 2, martes",
        time:              "2026-11-03T21:01:00Z",
        code:              `k00${sessionId}c`,
        archived:          false,
        status:            "initiated",
        designId:          40 + sessionId,
        designTitle:       "Privacidad en apps de salud",
        // The design's case, from `designs.case_id`.
        caseId:            CASE.id,
        caseTitle:         CASE.title,
        currentPhase:      null,
        phaseCount:        3,
        participantCount:  0,
        aiServicesEnabled: false,
        finishedAt:        null,
        ...fields,
    };
}

const NOT_STARTED = activity(1);
const IN_PROGRESS = activity(2, {
    status:            "in_progress",
    currentPhase:      { number: 2, mode: "team" },
    participantCount:  34,
    aiServicesEnabled: true,
    time:              "2026-11-02T12:05:00Z",
});
// Finished before `sessions.finished_at` existed (V41).
const FINISHED_BEFORE = activity(3, {
    status: "finished", participantCount: 1, time: "2026-10-12T15:00:00Z",
});
const FINISHED_AFTER = activity(4, {
    status:     "finished",
    time:       "2026-10-30T12:00:00Z",
    finishedAt: "2026-11-01T14:30:00Z",
});
const ARCHIVED = activity(5, {
    status: "finished", archived: true, finishedAt: "2026-11-03T15:40:00Z",
});

const ids = entries => entries.map(entry => entry.id);

describe("activities table, tabs", () => {
    it("reads the tab from the URL, En curso by default", () => {
        assert.equal(tabFromSearch({}), "ongoing");
        assert.equal(tabFromSearch({ tab: "finished" }), "finished");
        assert.equal(tabFromSearch({ tab: "archived" }), "archived");
        assert.equal(tabFromSearch({ tab: "other" }), "ongoing");
        assert.equal(tabFromSearch(undefined), "ongoing");
    });

    it("leaves En curso out of the URL", () => {
        assert.equal(tabSearchValue("ongoing"), null);
        assert.equal(tabSearchValue("finished"), "finished");
        assert.equal(tabSearchValue("archived"), "archived");
        assert.equal(tabSearchValue("other"), null);
    });

    it("shows 20 rows before Show more", () => {
        assert.equal(ACTIVITIES_PAGE_SIZE, 20);
    });
});

describe("activities table, columns", () => {
    it("shows the code and the launch in En curso", () => {
        assert.deepEqual(ids(tableColumns("ongoing")),
            ["activity", "status", "participants", "code", "launched"]);
    });

    it("shows the end instead of the code in Terminadas and Archivadas", () => {
        for (const tab of ["finished", "archived"]) {
            assert.deepEqual(ids(tableColumns(tab)),
                ["activity", "status", "participants", "finished"]);
        }
    });

    it("titles each column with its key", () => {
        assert.deepEqual(tableColumns("ongoing").map(column => column.key), [
            "activities_col_activity", "activities_col_status", "activities_col_participants",
            "activities_col_code", "activities_col_launched",
        ]);
        assert.equal(tableColumns("finished")[3].key, "activities_col_finished");
    });
});

describe("activities table, the Actividad column", () => {
    it("names the case, and not the design when the name is the design's title", () => {
        assert.deepEqual(activityMetaParts(NOT_STARTED),
            [{ key: "activities_meta_case", text: CASE.title }]);
    });

    it("names the design when the activity was renamed at launch", () => {
        const renamed = activity(1, { name: "Dilema del examen" });
        assert.deepEqual(activityMetaParts(renamed), [
            { key: "activities_meta_design", text: "Privacidad en apps de salud" },
            { key: "activities_meta_case", text: CASE.title },
        ]);
    });

    it("says Sin caso when the design has no case", () => {
        const noCase = activity(1, { caseId: null, caseTitle: null });
        assert.equal(activityCaseOf(noCase), null);
        assert.deepEqual(activityMetaParts(noCase),
            [{ key: "activities_meta_no_case", text: "" }]);
    });

    it("says Sin caso and disables Ver caso when case_id is NULL and the JSON is stale", () => {
        // `designs.case_id` NULL, with a leftover `caseId` in the document,
        // as the activity on design 213.
        const stale = activity(1, {
            caseId:    null,
            caseTitle: null,
            design:    { metainfo: { title: NOT_STARTED.designTitle }, caseId: "1" },
        });
        assert.equal(activityCaseOf(stale), null);
        assert.deepEqual(activityMetaParts(stale),
            [{ key: "activities_meta_no_case", text: "" }]);
        const row = buildActivityRow(stale, dates);
        assert.equal(row.caseId, null);
        assert.deepEqual(row.menu.find(entry => entry.id === "view-case"), {
            id:       "view-case",
            key:      "activities_action_view_case",
            icon:     "fa fa-book",
            disabled: true,
            reason:   { key: "activities_meta_no_case" },
        });
    });

    it("needs both the row's caseId and caseTitle", () => {
        for (const fields of [
            { caseId: 7, caseTitle: null }, { caseId: null, caseTitle: "Case" },
            { caseId: "x", caseTitle: "Case" }, { caseId: 7, caseTitle: "   " },
        ]) {
            assert.equal(activityCaseOf(activity(1, fields)), null, JSON.stringify(fields));
            assert.equal(buildActivityRow(activity(1, fields), dates).caseId, null);
        }
        assert.deepEqual(activityCaseOf(activity(1, { caseId: "7", caseTitle: " Case " })),
            { id: 7, title: "Case" });
    });

    it("does not read the case from the design document", () => {
        const fromDocument = activity(1, {
            caseId:    null,
            caseTitle: null,
            design:    {
                metainfo:       { title: NOT_STARTED.designTitle },
                caseId:         9,
                associatedCase: { id: 9, title: "Old case" },
            },
        });
        assert.equal(activityCaseOf(fromDocument), null);
        assert.equal(buildActivityRow(fromDocument, dates).caseId, null);
    });

    it("reads the design's title from the row, not from a design document (#1055)", () => {
        assert.equal(activityDesignTitle(activity(1, { designTitle: "  Datos  de pacientes " })),
            "Datos de pacientes");
        const fromDocument = activity(1, {
            name:        "Dilema del examen",
            designTitle: null,
            design:      { metainfo: { title: "Old title" } },
        });
        assert.equal(activityDesignTitle(fromDocument), "");
        assert.deepEqual(activityMetaParts(fromDocument),
            [{ key: "activities_meta_case", text: CASE.title }]);
    });

    it("links Ver caso to the row's case", () => {
        const row = buildActivityRow(activity(1, { caseId: 38, caseTitle: "Caso" }), dates);
        assert.equal(row.caseId, 38);
        assert.equal(row.menu.find(entry => entry.id === "view-case").disabled, false);
    });

    it("gives the row the name and the description apart, and the title as one line", () => {
        const row = buildActivityRow(NOT_STARTED, dates);
        assert.deepEqual(row.title,
            { name: "Privacidad en apps de salud", description: "Sección 2, martes" });
        assert.equal(row.titleText, "Privacidad en apps de salud · Sección 2, martes");
    });
});

describe("activities table, the Estado column", () => {
    it("says Sin iniciar for an activity with no phase started", () => {
        assert.deepEqual(statusCell(NOT_STARTED), {
            key:     "activities_status_not_started", params:  {}, modeKey: null,
            id:      "not-started", ai:      false,
        });
    });

    it("says the phase and its mode, with the IA mark, for one in progress", () => {
        assert.deepEqual(statusCell(IN_PROGRESS), {
            key:     "activity_bar_phase_label",
            params:  { number: 2, total: 3 },
            modeKey: "activity_bar_phase_mode_team",
            id:      "in-progress",
            ai:      true,
        });
    });

    it("says Finalizada for a finished one", () => {
        assert.equal(statusCell(FINISHED_AFTER).key, "finished");
        assert.equal(statusCell(FINISHED_AFTER).id, "finished");
    });
});

describe("activities table, the Participantes column", () => {
    it("says Nadie aún when no participant joined", () => {
        assert.deepEqual(participantsLabel(0),
            { key: "activities_participants_none", params: {}, none: true });
        assert.equal(participantsLabel(undefined).none, true);
        assert.equal(participantsLabel(-2).none, true);
    });

    it("counts one participant and many", () => {
        assert.deepEqual(participantsLabel(1),
            { key: "activities_participants_one", params: { count: 1 }, none: false });
        assert.deepEqual(participantsLabel(34),
            { key: "activities_participants_other", params: { count: 34 }, none: false });
    });
});

describe("activities table, dates", () => {
    it("says when the activity was launched, relative while recent", () => {
        assert.deepEqual(launchedCell(NOT_STARTED, dates).label,
            { key: "activity_date_today", params: { time: "18:01" } });
        assert.deepEqual(launchedCell(IN_PROGRESS, dates).label,
            { key: "activity_date_yesterday", params: { time: "09:05" } });
        assert.match(launchedCell(FINISHED_BEFORE, dates).label.text, /^12 oct/);
        assert.equal(launchedCell(NOT_STARTED, dates).hint.text,
            "martes, 3 de noviembre de 2026, 18:01");
    });

    it("says when a finished activity ended, with the time", () => {
        const cell = finishedCell(FINISHED_AFTER, dates);
        assert.match(cell.label.text, /^1 nov\.?,? 11:30$/);
        assert.equal(cell.hint.text, "domingo, 1 de noviembre de 2026, 11:30");
    });

    it("shows a dash for an activity finished before end times were recorded", () => {
        const cell = finishedCell(FINISHED_BEFORE, dates);
        assert.deepEqual(cell.label, { text: "—" });
        assert.deepEqual(cell.hint, {
            key:    "activities_finished_unknown",
            params: { date: "lunes, 12 de octubre de 2026, 12:00" },
        });
    });

    it("says only that the end is unknown without a launch date", () => {
        const cell = finishedCell(activity(6, { status: "finished", time: null }), dates);
        assert.deepEqual(cell.hint, { key: "activities_finished_unknown_no_launch", params: {} });
        assert.deepEqual(launchedCell(activity(6, { time: null }), dates).label, { text: "—" });
    });
});

describe("activities table, actions", () => {
    it("opens the dashboard in En curso, the reports in Terminadas, restores in Archivadas", () => {
        assert.deepEqual(primaryRowAction("ongoing"), {
            id: "open-dashboard", key: "activities_action_open_dashboard", icon: "fa-solid fa-play",
        });
        assert.equal(primaryRowAction("finished").id, "reports");
        assert.equal(primaryRowAction("archived").id, "restore");
    });

    it("lists the menu of each tab in order", () => {
        const row = { code: "k0051c", caseId: 7, designId: 41 };
        assert.deepEqual(ids(rowMenuEntries("ongoing", row)),
            ["copy-code", "reports", "view-design", "view-case"]);
        assert.deepEqual(ids(rowMenuEntries("finished", row)),
            ["open-dashboard", "launch-again", "view-design", "archive"]);
        assert.deepEqual(ids(rowMenuEntries("archived", row)),
            ["reports", "open-dashboard", "view-design"]);
        assert.ok(rowMenuEntries("ongoing", row).every(entry => !entry.disabled));
    });

    it("disables what the activity cannot use, with its reason", () => {
        const menu = rowMenuEntries("ongoing", { code: "", caseId: null, designId: null });
        const disabled = Object.fromEntries(menu.map(entry => [entry.id, entry.reason?.key]));
        assert.deepEqual(disabled, {
            "copy-code":   "activities_menu_no_code",
            "reports":     undefined,
            "view-design": "activities_menu_no_design",
            "view-case":   "activities_meta_no_case",
        });
        const finished = rowMenuEntries("finished", { designId: null });
        assert.equal(finished.find(entry => entry.id === "launch-again").disabled, true);
        assert.equal(finished.find(entry => entry.id === "archive").disabled, false);
    });

    it("gives each row the actions of its tab", () => {
        const tables = buildActivityTables(
            [NOT_STARTED, IN_PROGRESS, FINISHED_BEFORE, FINISHED_AFTER, ARCHIVED], dates);
        const actions = rows => rows.map(row => [row.primary.id, ...ids(row.menu)]);
        assert.deepEqual(actions(tables.ongoing), [
            ["open-dashboard", "copy-code", "reports", "view-design", "view-case"],
            ["open-dashboard", "copy-code", "reports", "view-design", "view-case"],
        ]);
        assert.deepEqual(actions(tables.finished), [
            ["reports", "open-dashboard", "launch-again", "view-design", "archive"],
            ["reports", "open-dashboard", "launch-again", "view-design", "archive"],
        ]);
        assert.deepEqual(actions(tables.archived),
            [["restore", "reports", "open-dashboard", "view-design"]]);
    });
});

describe("activities table, tables", () => {
    it("puts each activity in its tab, newest first", () => {
        const tables = buildActivityTables(
            [FINISHED_BEFORE, IN_PROGRESS, ARCHIVED, NOT_STARTED, FINISHED_AFTER], dates);
        assert.deepEqual(tables.ongoing.map(row => row.id), [1, 2]);
        assert.deepEqual(tables.finished.map(row => row.id), [4, 3]);
        assert.deepEqual(tables.archived.map(row => row.id), [5]);
    });

    it("keeps the row's ids for its actions", () => {
        const row = buildActivityRow(IN_PROGRESS, dates);
        assert.equal(row.id, 2);
        assert.equal(row.designId, 42);
        assert.equal(row.caseId, 7);
        assert.equal(row.code, "k002c");
        assert.equal(row.activity, IN_PROGRESS);
    });

    it("leaves out activities without a session id, and survives no list", () => {
        const tables = buildActivityTables([activity(null)], dates);
        assert.deepEqual(tables, { ongoing: [], finished: [], archived: [] });
        assert.deepEqual(buildActivityTables(undefined, dates),
            { ongoing: [], finished: [], archived: [] });
    });
});
