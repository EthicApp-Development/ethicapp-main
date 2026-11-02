// The launch wizard's design list (#971, epic #965): which designs are
// listed, their order, the search, and what rows and the preview say.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    buildLaunchList,
    countDesignsWithErrors,
    describeDesignPhases,
    designMatchesLaunchSearch,
    formatLaunchDate,
    isLaunchableDesign,
    launchStatsByDesign,
    launchSummary,
    orderDesignsForLaunch,
} from "../launch-design-list.js";

function design(id, overrides = {}) {
    return {
        id,
        userOwned:      true,
        archived:       false,
        valid:          true,
        createdAt:      null,
        usesAiServices: false,
        metainfo:       { title: `Design ${id}` },
        phases:         [],
        tags:           [],
        associatedCase: null,
        ...overrides,
    };
}

const ids = designs => designs.map(item => item.id);

describe("launchable designs", () => {
    it("lists the teacher's own valid designs that are not archived", () => {
        assert.equal(isLaunchableDesign(design(1)), true);
        assert.equal(isLaunchableDesign(design(2, { valid: false })), false);
        assert.equal(isLaunchableDesign(design(3, { valid: undefined })), false);
        assert.equal(isLaunchableDesign(design(4, { archived: true })), false);
        assert.equal(isLaunchableDesign(design(5, { userOwned: false })), false);
        assert.equal(isLaunchableDesign(null), false);
    });

    it("counts the own, not archived designs left out for their errors", () => {
        const designs = [
            design(1),
            design(2, { valid: false }),
            design(3, { valid: undefined }),
            design(4, { valid: false, archived: true }),
            design(5, { valid: false, userOwned: false }),
        ];
        assert.equal(countDesignsWithErrors(designs), 2);
        assert.equal(countDesignsWithErrors(undefined), 0);
    });
});

describe("launch statistics", () => {
    it("counts launches per design and keeps the latest time", () => {
        const stats = launchStatsByDesign([
            { designId: 7, time: "2026-10-01T10:00:00Z" },
            { designId: 7, time: "2026-10-28T10:00:00Z" },
            { designId: 7, time: "2026-10-14T10:00:00Z" },
            { designid: 9, time: "2026-09-02T10:00:00Z" },
            { designId: null, time: "2026-09-02T10:00:00Z" },
        ]);
        assert.deepEqual(stats.get(7), { count: 3, lastLaunchedAt: "2026-10-28T10:00:00Z" });
        assert.deepEqual(stats.get(9), { count: 1, lastLaunchedAt: "2026-09-02T10:00:00Z" },
            "a just-launched activity carries `designid`");
        assert.equal(stats.size, 2);
    });

    it("counts a launch without a usable time", () => {
        const stats = launchStatsByDesign([{ designId: "4", time: null }]);
        assert.deepEqual(stats.get(4), { count: 1, lastLaunchedAt: null });
    });
});

describe("launch order", () => {
    it("puts the last launched first, and a never-launched design by its creation", () => {
        const designs = [
            design(1, { createdAt: "2026-01-01T00:00:00Z" }),
            design(2, { createdAt: "2026-10-31T00:00:00Z" }),
            design(3, { createdAt: "2025-05-01T00:00:00Z" }),
            design(4, { createdAt: "2026-02-01T00:00:00Z" }),
        ];
        const stats = launchStatsByDesign([
            { designId: 3, time: "2026-10-01T00:00:00Z" },
            { designId: 1, time: "2026-10-28T00:00:00Z" },
        ]);
        assert.deepEqual(ids(orderDesignsForLaunch(designs, stats)), [2, 1, 3, 4],
            "created yesterday sits above a design last launched a month ago");
    });

    it("places designs with neither date after every dated one, newest id first", () => {
        const designs = [design(10), design(30), design(20, { createdAt: "2020-01-01T00:00:00Z" }), design(40)];
        assert.deepEqual(ids(orderDesignsForLaunch(designs, new Map())), [20, 40, 30, 10]);
    });

    it("breaks ties by id, newest first", () => {
        const sameTime = "2026-10-01T00:00:00Z";
        const designs = [design(1, { createdAt: sameTime }), design(3, { createdAt: sameTime }), design(2)];
        const stats = launchStatsByDesign([{ designId: 2, time: sameTime }]);
        assert.deepEqual(ids(orderDesignsForLaunch(designs, stats)), [3, 2, 1]);
    });

    it("does not change the input", () => {
        const designs = [design(1), design(2)];
        orderDesignsForLaunch(designs, new Map());
        assert.deepEqual(ids(designs), [1, 2]);
    });
});

describe("launch search", () => {
    const sample = design(1, {
        metainfo:       { title: "Privacidad en apps de salud" },
        associatedCase: { id: 5, title: "Datos de pacientes en la nube" },
        tags:           [{ id: 1, label: "Ética de datos" }],
    });

    it("matches the title, the case and the tags, ignoring case and accents", () => {
        assert.equal(designMatchesLaunchSearch(sample, "PRIVACIDAD"), true);
        assert.equal(designMatchesLaunchSearch(sample, "pacientes"), true);
        assert.equal(designMatchesLaunchSearch(sample, "etica"), true);
        assert.equal(designMatchesLaunchSearch(sample, "puente"), false);
    });

    it("needs every word somewhere", () => {
        assert.equal(designMatchesLaunchSearch(sample, "salud nube"), true);
        assert.equal(designMatchesLaunchSearch(sample, "salud puente"), false);
    });

    it("matches everything for an empty query", () => {
        assert.equal(designMatchesLaunchSearch(sample, "  "), true);
        assert.equal(designMatchesLaunchSearch(design(2, { metainfo: {} }), ""), true);
    });
});

describe("launch list", () => {
    it("builds the ordered, searched rows with their totals", () => {
        const designs = [
            design(1, { metainfo: { title: "Puente" }, createdAt: "2026-01-01T00:00:00Z" }),
            design(2, { metainfo: { title: "Examen" }, usesAiServices: true, phases: [{}, {}] }),
            design(3, { metainfo: { title: "Puente roto" }, valid: false }),
            design(4, { metainfo: { title: "Puente archivado" }, archived: true }),
        ];
        const activities = [{ designId: 2, time: "2026-10-28T00:00:00Z" }];
        const formatDate = value => (value ? value.slice(0, 10) : "");

        const all = buildLaunchList(designs, activities, { formatDate });
        assert.equal(all.total, 2);
        assert.equal(all.designsWithErrors, 1);
        assert.deepEqual(all.rows.map(row => row.id), [2, 1]);
        assert.deepEqual(all.rows[0], {
            id:             2,
            design:         designs[1],
            title:          "Examen",
            caseTitle:      "",
            phaseCount:     2,
            phaseCountKey:  "launch_wizard_phases_other",
            usesAiServices: true,
            summary:        { key: "launch_wizard_launched_one", params: { count: 1, date: "2026-10-28" } },
        });

        const searched = buildLaunchList(designs, activities, { query: "puente", formatDate });
        assert.equal(searched.total, 2, "the total counts before the search");
        assert.deepEqual(searched.rows.map(row => row.id), [1]);
    });
});

describe("launch summary", () => {
    const formatDate = value => (value ? `d(${value})` : "");

    it("says how many times and when it was last launched", () => {
        const stats = launchStatsByDesign([{ designId: 1, time: "t1" }, { designId: 1, time: "t2" }]);
        assert.deepEqual(launchSummary(design(1), stats, formatDate),
            { key: "launch_wizard_launched_other", params: { count: 2, date: "" } });
    });

    it("says when a never-launched design was created", () => {
        assert.deepEqual(launchSummary(design(1, { createdAt: "c" }), new Map(), formatDate),
            { key: "launch_wizard_created_never_launched", params: { date: "d(c)" } });
        assert.deepEqual(launchSummary(design(1), new Map(), formatDate),
            { key: "launch_wizard_never_launched", params: {} });
    });
});

describe("launch dates", () => {
    const now = new Date("2026-11-01T12:00:00Z");

    it("shows day and month in the UI language, with the year only when it differs", () => {
        assert.match(formatLaunchDate("2026-10-28T12:00:00Z", "es_CL", now), /^28 oct/);
        assert.match(formatLaunchDate("2026-10-28T12:00:00Z", "en_US", now), /^Oct 28$/);
        assert.match(formatLaunchDate("2025-10-28T12:00:00Z", "en_US", now), /2025/);
    });

    it("is empty for a missing or invalid date", () => {
        assert.equal(formatLaunchDate(null, "es_CL", now), "");
        assert.equal(formatLaunchDate("not a date", "es_CL", now), "");
    });
});

describe("preview phases", () => {
    it("describes mode, groups, chat, questions and services", () => {
        const phases = describeDesignPhases({
            phases: [
                { mode: "individual", questions: [{}, {}], chat: true },
                {
                    mode:             "team",
                    stdntAmount:      3,
                    chat:             true,
                    questions:        [{}],
                    externalServices: { enabledServiceIds: ["tutor", "tutor", " agent "] },
                },
                { mode: "team", stdntAmount: null, chat: false },
            ],
        }, id => (id === "tutor" ? "Tutor" : null));

        assert.deepEqual(phases, [
            {
                number:           1, isTeam:           false, groupSize:        null, chat:             false,
                questionCount:    2, questionCountKey: "launch_wizard_questions_other", services:         [],
            },
            {
                number:           2, isTeam:           true, groupSize:        3, chat:             true,
                questionCount:    1, questionCountKey: "launch_wizard_questions_one",
                services:         [{ id: "tutor", name: "Tutor" }, { id: "agent", name: null }],
            },
            {
                number:           3, isTeam:           true, groupSize:        null, chat:             false,
                questionCount:    0, questionCountKey: "launch_wizard_questions_other", services:         [],
            },
        ]);
    });

    it("is empty for a design without phases", () => {
        assert.deepEqual(describeDesignPhases({}), []);
    });
});
