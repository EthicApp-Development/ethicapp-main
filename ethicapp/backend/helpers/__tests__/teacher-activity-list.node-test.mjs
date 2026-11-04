// The teacher's list of activities, GET /activities (#1049, epic #1046): the
// statement's shape and the mapping of its rows. The counts themselves need
// PostgreSQL and are verified on the Compose stack.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    TEACHER_ACTIVITIES_SQL,
    activityCaseOf,
    currentPhaseOf,
    designTitleOf,
    teacherActivityListItem,
} from "../teacher-activity-list.js";

const flatSql = TEACHER_ACTIVITIES_SQL.replace(/\s+/gu, " ");

function row(overrides = {}) {
    return {
        id:                  11,
        sessionId:           42,
        creator:             5,
        name:                "Privacy",
        description:         "Section 3",
        time:                "2026-11-02T18:01:00.000Z",
        code:                "ABC123",
        archived:            false,
        status:              2,
        type:                "T",
        designId:            7,
        designTitle:         "Privacy in health apps",
        ai_services_enabled: true,
        finishedAt:          null,
        currentPhaseNumber:  2,
        currentPhaseMode:    "team",
        phaseCount:          3,
        participantCount:    24,
        caseId:              31,
        caseTitle:           "Datos de pacientes",
        ...overrides,
    };
}

describe("TEACHER_ACTIVITIES_SQL (#1049)", () => {
    it("selects only the teacher's sessions, most recent launch first", () => {
        assert.match(flatSql,
            /WHERE sessions\.creator = \$1 ORDER BY sessions\.time DESC, sessions\.id DESC;/u);
    });

    it("keeps every field the list returned before, but the design document", () => {
        for (const column of [
            "activity.id AS id",
            "activity.session AS \"sessionId\"",
            "sessions.creator",
            "sessions.name",
            "sessions.descr AS \"description\"",
            "sessions.time",
            "sessions.code",
            "sessions.archived",
            "sessions.status",
            "sessions.type",
            "designs.id AS \"designId\"",
        ]) {
            assert.ok(flatSql.includes(column), column);
        }
    });

    it("reads the current phase from the session's current stage", () => {
        assert.ok(flatSql.includes(
            "LEFT JOIN stages AS current_phase ON current_phase.id = sessions.current_stage"));
        assert.ok(flatSql.includes("current_phase.number AS \"currentPhaseNumber\""));
        assert.ok(flatSql.includes("current_phase.type AS \"currentPhaseMode\""));
    });

    it("counts the design's phases, and none when phases is not an array", () => {
        assert.ok(flatSql.includes(
            "WHEN jsonb_typeof(designs.design -> 'phases') = 'array' "
            + "THEN jsonb_array_length(designs.design -> 'phases') ELSE 0 END AS \"phaseCount\""));
    });

    it("counts students and users without a role, in one grouped subquery for the teacher", () => {
        assert.ok(flatSql.includes("(participant.role IS NULL OR participant.role = 'A')"));
        assert.ok(flatSql.includes("WHERE participant_session.creator = $1"));
        assert.ok(flatSql.includes("GROUP BY session_user_row.sesid"));
        assert.ok(flatSql.includes("ON participants.sesid = sessions.id"));
        assert.ok(flatSql.includes("COALESCE(participants.count, 0) AS \"participantCount\""));
        assert.doesNotMatch(flatSql, /LATERAL/u);
    });

    it("selects the AI services switch and the end time", () => {
        assert.ok(flatSql.includes("sessions.ai_services_enabled"));
        assert.ok(flatSql.includes("sessions.finished_at AS \"finishedAt\""));
    });

    it("joins the design's case by designs.case_id, keeping designs without one (#1050)", () => {
        assert.ok(flatSql.includes(
            "LEFT JOIN ethical_cases AS associated_case ON associated_case.id = designs.case_id"));
        assert.ok(flatSql.includes("associated_case.id AS \"caseId\""));
        assert.ok(flatSql.includes("associated_case.title AS \"caseTitle\""));
    });

    it("selects the design's title, and not its document (#1055)", () => {
        assert.ok(flatSql.includes("designs.design -> 'metainfo' ->> 'title' AS \"designTitle\""));
        assert.doesNotMatch(flatSql, /designs\.design\s*,/u, "no design document column");
        assert.doesNotMatch(flatSql, /designs\.design AS/u, "no design document column");
    });

    it("uses only the teacher's id as a parameter", () => {
        assert.deepEqual([...new Set(TEACHER_ACTIVITIES_SQL.match(/\$\d+/gu))], ["$1"]);
    });
});

describe("currentPhaseOf (#1049)", () => {
    it("gives the phase number and a team mode", () => {
        assert.deepEqual(currentPhaseOf(row()), { number: 2, mode: "team" });
    });

    it("reads any mode other than team as individual, as the dashboard does", () => {
        for (const mode of ["individual", "other", null, undefined, ""]) {
            assert.deepEqual(currentPhaseOf(row({ currentPhaseMode: mode })),
                { number: 2, mode: "individual" }, String(mode));
        }
    });

    it("takes the number as a string", () => {
        assert.deepEqual(currentPhaseOf(row({ currentPhaseNumber: "3" })),
            { number: 3, mode: "team" });
    });

    it("is null when no phase is running", () => {
        for (const number of [null, undefined, 0, -1, 1.5, "x"]) {
            assert.equal(currentPhaseOf(row({ currentPhaseNumber: number })), null, String(number));
        }
    });
});

describe("teacherActivityListItem (#1049)", () => {
    it("maps an activity in progress", () => {
        assert.deepEqual(teacherActivityListItem(row()), {
            id:                11,
            sessionId:         42,
            creator:           5,
            name:              "Privacy",
            description:       "Section 3",
            time:              "2026-11-02T18:01:00.000Z",
            code:              "ABC123",
            archived:          false,
            status:            2,
            type:              "T",
            designId:          7,
            designTitle:       "Privacy in health apps",
            currentPhase:      { number: 2, mode: "team" },
            phaseCount:        3,
            participantCount:  24,
            aiServicesEnabled: true,
            finishedAt:        null,
            caseId:            31,
            caseTitle:         "Datos de pacientes",
        });
    });

    it("maps an activity not started, with no phase and nobody joined", () => {
        const item = teacherActivityListItem(row({
            status:             1,
            currentPhaseNumber: null,
            currentPhaseMode:   null,
            participantCount:   0,
        }));

        assert.equal(item.currentPhase, null);
        assert.equal(item.participantCount, 0);
        assert.equal(item.phaseCount, 3);
    });

    it("maps a finished activity with its end time and its AI services off", () => {
        const item = teacherActivityListItem(row({
            status:              3,
            currentPhaseNumber:  null,
            currentPhaseMode:    null,
            ai_services_enabled: false,
            finishedAt:          "2026-11-03T10:15:00.000Z",
        }));

        assert.equal(item.currentPhase, null);
        assert.equal(item.aiServicesEnabled, false);
        assert.equal(item.finishedAt, "2026-11-03T10:15:00.000Z");
    });

    it("gives null for the end time of an activity finished before it was recorded", () => {
        for (const finishedAt of [null, undefined]) {
            const item = teacherActivityListItem(row({ status: 3, finishedAt }));
            assert.equal(item.finishedAt, null, String(finishedAt));
        }
    });

    it("keeps the AI services on unless the row stores false", () => {
        assert.equal(teacherActivityListItem(row({ ai_services_enabled: undefined }))
            .aiServicesEnabled, true);
        assert.equal(teacherActivityListItem(row({ ai_services_enabled: null }))
            .aiServicesEnabled, true);
    });

    it("takes the counts as strings and gives 0 for missing or invalid ones", () => {
        const fromStrings = teacherActivityListItem(
            row({ phaseCount: "4", participantCount: "12" }));
        assert.equal(fromStrings.phaseCount, 4);
        assert.equal(fromStrings.participantCount, 12);

        for (const value of [null, undefined, -2, "x", 1.5]) {
            const item = teacherActivityListItem(
                row({ phaseCount: value, participantCount: value }));
            assert.equal(item.phaseCount, 0, String(value));
            assert.equal(item.participantCount, 0, String(value));
        }
    });

    it("gives a null case for a design without one", () => {
        const item = teacherActivityListItem(row({ caseId: null, caseTitle: null }));
        assert.equal(item.caseId, null);
        assert.equal(item.caseTitle, null);
    });

    it("does not return the design document, even when the row carries one (#1055)", () => {
        const item = teacherActivityListItem(row({
            design: { metainfo: { title: "Privacy" }, phases: [{}, {}], caseId: "1" },
        }));
        assert.equal(Object.hasOwn(item, "design"), false);
        assert.equal(item.designTitle, "Privacy in health apps");
    });

    it("leaves the row's internal columns out", () => {
        const item = teacherActivityListItem(row());

        for (const key of ["ai_services_enabled", "currentPhaseNumber", "currentPhaseMode"]) {
            assert.equal(Object.hasOwn(item, key), false, key);
        }
    });
});

describe("designTitleOf (#1055)", () => {
    it("gives the design's trimmed title", () => {
        assert.equal(designTitleOf({ designTitle: "  Privacy  " }), "Privacy");
    });

    it("is null for a design without a title", () => {
        for (const value of [{ designTitle: null }, { designTitle: "  " }, { designTitle: 7 }, {},
            undefined]) {
            assert.equal(designTitleOf(value), null, JSON.stringify(value));
        }
    });
});

describe("activityCaseOf (#1050)", () => {
    it("gives the case's id and trimmed title", () => {
        assert.deepEqual(activityCaseOf({ caseId: "31", caseTitle: " Datos " }),
            { caseId: 31, caseTitle: "Datos" });
    });

    it("gives no case unless both the id and the title are set", () => {
        for (const value of [
            { caseId: null, caseTitle: null },
            { caseId: 31, caseTitle: null },
            { caseId: 31, caseTitle: "   " },
            { caseId: null, caseTitle: "Datos" },
            { caseId: "x", caseTitle: "Datos" },
            {},
            undefined,
        ]) {
            assert.deepEqual(activityCaseOf(value), { caseId: null, caseTitle: null },
                JSON.stringify(value));
        }
    });
});
