// The home's activities sections (#1098, epic #1093): the five newest
// activities in progress or not started, the three newest finished ones, none
// archived, with their totals, the count of those not started as Actividades
// counts it, and the links to Actividades.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { buildActivityTables } from "../activities-table.js";
import { createActivityDateFormatter } from "../activity-dates.js";
import { statusFilterCounts } from "../activities-filters.js";
import {
    HOME_FINISHED_ROWS,
    HOME_ONGOING_ROWS,
    countedKey,
    homeActivityLinks,
    homeActivitySections,
} from "../home-activities.js";

const LOCALES = new URL("../../../locales/", import.meta.url);
const catalog = name => JSON.parse(readFileSync(new URL(`${name}.json`, LOCALES), "utf8"));

const dates = createActivityDateFormatter({
    uiLanguage: "es_CL", now: new Date("2026-11-04T18:00:00Z"), timeZone: "America/Santiago",
});

function activity(sessionId, fields = {}) {
    return {
        sessionId,
        time:     new Date(Date.UTC(2026, 9, 1) + (Number(sessionId) || 0) * 60_000).toISOString(),
        code:     `k${sessionId}`,
        status:   "in_progress",
        archived: false,
        ...fields,
    };
}

const sectionsOf = activities => homeActivitySections(buildActivityTables(activities, dates));
const ids = rows => rows.map(row => row.id);

// 7 in progress, 3 not started, 4 finished and 2 archived; the higher the
// session id, the newer.
const MANY = [
    ...[1, 2, 3, 4, 5, 6, 7].map(id => activity(id, {
        currentPhase: { number: 1, mode: "individual" },
    })),
    ...[8, 9, 10].map(id => activity(id, { status: "initiated" })),
    ...[11, 12, 13, 14].map(id => activity(id, { status: "finished" })),
    activity(15, { status: "finished", archived: true }),
    activity(16, { archived: true }),
];

describe("homeActivitySections", () => {
    it("shows five rows in progress and three finished, the newest first", () => {
        const sections = sectionsOf(MANY);
        assert.equal(HOME_ONGOING_ROWS, 5);
        assert.equal(HOME_FINISHED_ROWS, 3);
        assert.deepEqual(ids(sections.ongoing.rows), [10, 9, 8, 7, 6]);
        assert.deepEqual(ids(sections.finished.rows), [14, 13, 12]);
    });

    it("counts every activity of each section, archived ones left out", () => {
        const sections = sectionsOf(MANY);
        assert.equal(sections.ongoing.total, 10);
        assert.equal(sections.finished.total, 4);
        const shown = [...sections.ongoing.rows, ...sections.finished.rows].map(row => row.id);
        assert.ok(!shown.includes(15) && !shown.includes(16));
    });

    it("counts the activities not started as the Sin iniciar chip of Actividades", () => {
        const tables = buildActivityTables(MANY, dates);
        const sections = homeActivitySections(tables);
        assert.equal(sections.ongoing.notStarted, 3);
        assert.equal(sections.ongoing.notStarted,
            statusFilterCounts(tables.ongoing)["not-started"]);
    });

    it("shows fewer rows when there are fewer activities", () => {
        const sections = sectionsOf([activity(1), activity(2, { status: "finished" })]);
        assert.deepEqual(ids(sections.ongoing.rows), [1]);
        assert.deepEqual(ids(sections.finished.rows), [2]);
        assert.equal(sections.hasNoActivities, false);
    });

    it("has no activities only when all three tabs of Actividades are empty", () => {
        for (const value of [[], null, undefined]) {
            const sections = sectionsOf(value);
            assert.equal(sections.hasNoActivities, true);
            assert.deepEqual(sections.ongoing.rows, []);
            assert.equal(sections.ongoing.total, 0);
            assert.equal(sections.ongoing.notStarted, 0);
            assert.equal(sections.finished.total, 0);
        }
        assert.equal(homeActivitySections({}).hasNoActivities, true);
    });

    it("counts a teacher whose only activities are archived as having activities", () => {
        const sections = sectionsOf([activity(1, { status: "finished", archived: true })]);
        assert.equal(sections.hasNoActivities, false);
        assert.equal(sections.ongoing.total, 0);
        assert.equal(sections.finished.total, 0);
    });

    it("drops rows with no session id, as Actividades does", () => {
        const sections = sectionsOf([
            activity(1),
            activity(null),
            activity("x", { status: "finished" }),
        ]);
        assert.deepEqual(ids(sections.ongoing.rows), [1]);
        assert.equal(sections.ongoing.total, 1);
        assert.equal(sections.finished.total, 0);
    });

    it("keeps the rows of one build, so a binding to them settles", () => {
        const sections = sectionsOf(MANY);
        assert.equal(sections.ongoing.rows, sections.ongoing.rows);
        assert.ok(Array.isArray(sections.finished.rows));
    });
});

describe("home activities, the keys of the counts and the footers", () => {
    it("picks the singular form for one activity and the plural form otherwise", () => {
        const base = "home_activities_view_ongoing";
        assert.equal(countedKey(base, 1), `${base}_one`);
        assert.equal(countedKey(base, 0), `${base}_other`);
        assert.equal(countedKey(base, 53), `${base}_other`);
    });

    it("names the footers' links and the count's title by the totals", () => {
        const many = sectionsOf(MANY);
        assert.equal(many.ongoing.viewAllKey, "home_activities_view_ongoing_other");
        assert.equal(many.ongoing.countTitleKey, "home_activities_ongoing_count_title");
        assert.equal(many.finished.viewAllKey, "home_activities_view_finished_other");

        const one = sectionsOf([activity(1), activity(2, { status: "finished" })]);
        assert.equal(one.ongoing.viewAllKey, "home_activities_view_ongoing_one");
        assert.equal(one.ongoing.countTitleKey, "home_activities_view_ongoing_one");
        assert.equal(one.finished.viewAllKey, "home_activities_view_finished_one");
    });

    it("gives only keys both locales have", () => {
        const one = sectionsOf([activity(1), activity(2, { status: "finished" })]);
        const keys = [sectionsOf(MANY), one].flatMap(sections => [
            sections.ongoing.viewAllKey,
            sections.ongoing.countTitleKey,
            sections.finished.viewAllKey,
        ]);
        for (const name of ["es_CL", "en_US"]) {
            const texts = catalog(name);
            for (const key of keys) {
                assert.equal(typeof texts[key], "string", `${name}: ${key}`);
            }
        }
    });
});

describe("homeActivityLinks", () => {
    it("links to En curso, its Sin iniciar filter and Terminadas", () => {
        assert.deepEqual(homeActivityLinks(), {
            ongoing:    "#!/activities",
            notStarted: "#!/activities?status=not-started",
            finished:   "#!/activities?tab=finished",
        });
    });
});
