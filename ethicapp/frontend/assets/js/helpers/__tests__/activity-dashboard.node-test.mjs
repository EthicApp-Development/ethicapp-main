import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    DASHBOARD_TABS,
    DEFAULT_DASHBOARD_TAB,
    dashboardTab,
    defaultPhaseContextExpanded,
    defaultSelectedPhaseId,
    filterRowsByParticipant,
    isParticipantRow,
    matchesParticipantQuery,
    normalizeSearchText,
    participantMatchCount,
    phaseNavigatorRows,
    phaseResponseCounts,
    resolveSelectedPhaseId,
    sameNavigatorRows,
    selectedPhaseData,
} from "../activity-dashboard.js";

// A started phase as the dashboard keeps it: its descriptor and its table.
function startedPhase(id, number, mode, state = []) {
    return { descriptor: { id, number, mode }, state };
}

const INDIVIDUAL_ROWS = [
    { userId: 1, userName: "Ana Rojas", r1: 3, r2: null },
    { userId: 2, userName: "Benjamín Soto", r1: null, r2: null },
    { userId: 3, userName: "Camila Fuentes", r1: null, r2: 5 },
];

// A group phase's table: members, then their group's summary row.
const GROUP_ROWS = [
    { userId: 1, userName: "Ana Rojas", groupId: 70, groupNumber: 1, r1: 2 },
    { userId: 2, userName: "Benjamín Soto", groupId: 70, groupNumber: 1, r1: null },
    { groupStatistics: true, groupId: 70, groupNumber: 1, groupName: "Grupo 1" },
    { userId: 3, userName: "Diego Muñoz", groupId: 71, groupNumber: 2, r1: 4 },
    { groupStatistics: true, groupId: 71, groupNumber: 2, groupName: "Grupo 2" },
];

describe("dashboardTab", () => {
    it("opens on the responses", () => {
        assert.equal(DEFAULT_DASHBOARD_TAB, "responses");
        assert.deepEqual(DASHBOARD_TABS, ["responses", "case", "design", "participants"]);
    });

    it("takes a known tab and falls back to the responses", () => {
        assert.equal(dashboardTab("case"), "case");
        assert.equal(dashboardTab("participants"), "participants");
        assert.equal(dashboardTab("info"), "responses");
        assert.equal(dashboardTab(undefined), "responses");
    });
});

describe("defaultPhaseContextExpanded", () => {
    it("opens the phase card whole from 1600 px and collapses it to the questions below", () => {
        assert.equal(defaultPhaseContextExpanded(1920), true);
        assert.equal(defaultPhaseContextExpanded(1600), true);
        assert.equal(defaultPhaseContextExpanded(1599), false);
        assert.equal(defaultPhaseContextExpanded(1366), false);
        assert.equal(defaultPhaseContextExpanded(undefined), false);
    });
});

describe("phaseResponseCounts", () => {
    it("counts the participants who answered at least one question", () => {
        assert.deepEqual(phaseResponseCounts({ state: INDIVIDUAL_ROWS }), { answered: 2, participants: 3 });
    });

    it("leaves the groups' summary rows out", () => {
        assert.deepEqual(phaseResponseCounts({ state: GROUP_ROWS }), { answered: 2, participants: 3 });
        assert.equal(isParticipantRow(GROUP_ROWS[2]), false);
        assert.equal(isParticipantRow(GROUP_ROWS[0]), true);
    });

    it("counts ranking answers, kept as text", () => {
        const rows = [
            { uid: 1, userName: "Ana", r1: "Actor A", r2: "Actor B", idR1: 4 },
            { uid: 2, userName: "Beto", r1: null, r2: null, idR1: null },
        ];
        assert.deepEqual(phaseResponseCounts({ state: rows }), { answered: 1, participants: 2 });
    });

    it("does not take chat counts or comments for answers", () => {
        const rows = [{ userId: 1, userName: "Ana", r1: null, chatR1: 4, commentR1: "hola", totalChatCount: 4 }];
        assert.deepEqual(phaseResponseCounts({ state: rows }), { answered: 0, participants: 1 });
    });

    it("is zero without a table", () => {
        assert.deepEqual(phaseResponseCounts(null), { answered: 0, participants: 0 });
        assert.deepEqual(phaseResponseCounts({ state: null }), { answered: 0, participants: 0 });
    });
});

describe("phase selection", () => {
    const phases = [
        startedPhase(40, 1, "individual"),
        startedPhase(41, 2, "team"),
    ];

    it("selects the current phase on load", () => {
        assert.equal(defaultSelectedPhaseId(phases, 41), 41);
        assert.equal(defaultSelectedPhaseId(phases, "40"), 40);
    });

    it("falls back to the last phase started while the current one is not loaded", () => {
        assert.equal(defaultSelectedPhaseId([phases[1], phases[0]], 42), 41);
        assert.equal(defaultSelectedPhaseId(phases, null), 41);
    });

    it("selects nothing before the first phase starts", () => {
        assert.equal(defaultSelectedPhaseId([], null), null);
        assert.equal(defaultSelectedPhaseId(undefined, 41), null);
    });

    it("keeps a started phase the teacher selected", () => {
        assert.equal(resolveSelectedPhaseId(40, phases, 41), 40);
    });

    it("replaces a selection that is not a started phase", () => {
        assert.equal(resolveSelectedPhaseId(null, phases, 41), 41);
        assert.equal(resolveSelectedPhaseId(99, phases, 41), 41);
    });

    it("finds the selected phase's data", () => {
        assert.equal(selectedPhaseData(phases, "41"), phases[1]);
        assert.equal(selectedPhaseData(phases, 99), null);
        assert.equal(selectedPhaseData(phases, null), null);
    });
});

describe("phaseNavigatorRows", () => {
    const designPhases = [{ mode: "individual" }, { mode: "team" }, { mode: "individual" }];

    it("lists every phase of the design, the started ones with their counts", () => {
        const rows = phaseNavigatorRows(designPhases, [
            startedPhase(40, 1, "individual", INDIVIDUAL_ROWS),
            startedPhase(41, 2, "team", GROUP_ROWS),
        ], 41);

        assert.deepEqual(rows.map(row => [row.number, row.mode, row.phaseId, row.started, row.current]), [
            [1, "individual", 40, true, false],
            [2, "team", 41, true, true],
            [3, "individual", null, false, false],
        ]);
        assert.deepEqual(rows.map(row => [row.answered, row.participants]), [[2, 3], [2, 3], [null, null]]);
        assert.equal(rows[1].modeKey, "activity_bar_phase_mode_team");
        assert.equal(rows[2].modeKey, "activity_bar_phase_mode_individual");
    });

    it("gives the progress as a percentage of the participants", () => {
        const rows = phaseNavigatorRows(designPhases, [startedPhase(40, 1, "individual", INDIVIDUAL_ROWS)], 40);
        assert.equal(rows[0].progress, 67);
        assert.equal(rows[1].progress, 0);

        const empty = phaseNavigatorRows(designPhases, [startedPhase(40, 1, "individual", [])], 40);
        assert.equal(empty[0].progress, 0);
    });

    it("lists the design's phases before any starts", () => {
        const rows = phaseNavigatorRows(designPhases, [], null);
        assert.equal(rows.length, 3);
        assert.ok(rows.every(row => !row.started && !row.current && row.phaseId === null));
    });

    it("lists a started phase missing from the design", () => {
        const rows = phaseNavigatorRows([{ mode: "team" }], [startedPhase(41, 2, "team")], 41);
        assert.deepEqual(rows.map(row => [row.number, row.started]), [[1, false], [2, true]]);
    });

    it("is empty without a design or phases", () => {
        assert.deepEqual(phaseNavigatorRows(undefined, undefined, null), []);
    });

    it("tells when two lists show the same", () => {
        const phases = [startedPhase(40, 1, "individual", INDIVIDUAL_ROWS)];
        const first = phaseNavigatorRows(designPhases, phases, 40);
        assert.equal(sameNavigatorRows(first, phaseNavigatorRows(designPhases, phases, 40)), true);

        INDIVIDUAL_ROWS[1].r1 = 4;
        try {
            assert.equal(sameNavigatorRows(first, phaseNavigatorRows(designPhases, phases, 40)), false);
        } finally {
            INDIVIDUAL_ROWS[1].r1 = null;
        }
        assert.equal(sameNavigatorRows(first, first.slice(1)), false);
        assert.equal(sameNavigatorRows(first, undefined), false);
    });
});

describe("participant search", () => {
    it("ignores case and accents", () => {
        assert.equal(normalizeSearchText("  Benjamín SOTO "), "benjamin soto");
        assert.equal(matchesParticipantQuery("Diego Muñoz", "munoz"), true);
        assert.equal(matchesParticipantQuery("Ana Rojas", "ROJ"), true);
        assert.equal(matchesParticipantQuery("Ana Rojas", "soto"), false);
        assert.equal(matchesParticipantQuery(undefined, "ana"), false);
    });

    it("keeps the same rows with an empty search", () => {
        assert.equal(filterRowsByParticipant(INDIVIDUAL_ROWS, ""), INDIVIDUAL_ROWS);
        assert.equal(filterRowsByParticipant(INDIVIDUAL_ROWS, "   "), INDIVIDUAL_ROWS);
        assert.equal(filterRowsByParticipant(INDIVIDUAL_ROWS, undefined), INDIVIDUAL_ROWS);
        assert.equal(filterRowsByParticipant(undefined, "ana"), undefined);
    });

    it("filters the rows by the participant's name", () => {
        assert.deepEqual(filterRowsByParticipant(INDIVIDUAL_ROWS, "camila").map(row => row.userId), [3]);
        assert.deepEqual(filterRowsByParticipant(INDIVIDUAL_ROWS, "zz"), []);
    });

    it("keeps a matching member's group summary row", () => {
        const rows = filterRowsByParticipant(GROUP_ROWS, "diego");
        assert.deepEqual(rows, [GROUP_ROWS[3], GROUP_ROWS[4]]);
    });

    it("matches a group summary row by the group's number when it has no id", () => {
        const rows = [
            { userId: 1, userName: "Ana", groupId: 70, groupNumber: 1 },
            { groupStatistics: true, groupNumber: "1" },
            { groupStatistics: true, groupNumber: "2" },
        ];
        assert.deepEqual(filterRowsByParticipant(rows, "ana"), [rows[0], rows[1]]);
    });

    it("keeps a group's summary row when its name matches", () => {
        const rows = filterRowsByParticipant(GROUP_ROWS, "grupo 2");
        assert.deepEqual(rows, [GROUP_ROWS[4]]);
    });

    it("counts the participants the search leaves", () => {
        assert.equal(participantMatchCount({ state: GROUP_ROWS }, "o"), 3);
        assert.equal(participantMatchCount({ state: GROUP_ROWS }, "ana"), 1);
        assert.equal(participantMatchCount({ state: GROUP_ROWS }, "grupo"), 0);
        assert.equal(participantMatchCount({ state: GROUP_ROWS }, ""), 3);
        assert.equal(participantMatchCount(null, "a"), 0);
    });
});
