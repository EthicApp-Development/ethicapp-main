// The teacher's list of activities, `GET /activities` (#1049, epic #1046):
// each activity with its session, its design's id and title, plus what the
// activities table shows about it: the current phase and its mode, the number
// of phases in the design, how many participants joined, whether its AI
// services are on, when it ended, and the design's case (#1050).
//
// The design document itself is not returned (#1055): the list reads only its
// title and its phase count, both taken in the statement. A teacher with many
// activities launched from long designs no longer downloads every document.
//
// One statement for the whole list, so a teacher with many activities still
// makes one request and one query:
// - The current phase is the session's `current_stage`, joined to `stages`
//   by its primary key. It is NULL before the first phase starts and once the
//   activity is finished (FINISH_SESSION_SQL clears it).
// - The phase count is the length of the design document's `phases`, the
//   total the dashboard's bar shows (`designObj.phases.length`).
// - The participants are counted once for all of the teacher's sessions, in a
//   grouped subquery joined by session id, instead of a subquery per row:
//   `sesusers` has no index that starts with the session id.
// - The case is the design's `case_id`, joined to `ethical_cases` by its
//   primary key. `designs.case_id` is the source of truth (ON DELETE SET
//   NULL); the design document's `caseId` and `associatedCase` can be stale
//   or missing.

import { sessionAiServicesEnabled } from "./session-ai-services.js";
import { sessionTimeMode } from "./session-time-mode.js";

// The role of students in `users.role`.
const STUDENT_ROLE = "A";

// $1 teacher id. Most recent launch first.
//
// A participant is a session user whose role is the student role or no role,
// as the dashboard's bar counts them (`connectedStudentCount` in
// frontend/assets/js/helpers/activity-bar.js). The teacher, who joins the
// session when creating it, is left out.
export const TEACHER_ACTIVITIES_SQL = `
    SELECT
        activity.id AS id,
        activity.session AS "sessionId",
        sessions.creator,
        sessions.name,
        sessions.descr AS "description",
        sessions.time,
        sessions.code,
        sessions.archived,
        sessions.status,
        sessions.type,
        designs.id AS "designId",
        designs.design -> 'metainfo' ->> 'title' AS "designTitle",
        sessions.ai_services_enabled,
        sessions.time_mode,
        sessions.finished_at AS "finishedAt",
        associated_case.id AS "caseId",
        associated_case.title AS "caseTitle",
        current_phase.number AS "currentPhaseNumber",
        current_phase.type AS "currentPhaseMode",
        CASE
            WHEN jsonb_typeof(designs.design -> 'phases') = 'array'
                THEN jsonb_array_length(designs.design -> 'phases')
            ELSE 0
        END AS "phaseCount",
        COALESCE(participants.count, 0) AS "participantCount"
    FROM activity
    INNER JOIN sessions
        ON activity.session = sessions.id
    INNER JOIN designs
        ON activity.design = designs.id
    LEFT JOIN ethical_cases AS associated_case
        ON associated_case.id = designs.case_id
    LEFT JOIN stages AS current_phase
        ON current_phase.id = sessions.current_stage
    LEFT JOIN (
        SELECT
            session_user_row.sesid,
            COUNT(*)::integer AS count
        FROM sesusers AS session_user_row
        INNER JOIN users AS participant
            ON session_user_row.uid = participant.id
        INNER JOIN sessions AS participant_session
            ON session_user_row.sesid = participant_session.id
        WHERE participant_session.creator = $1
          AND (participant.role IS NULL OR participant.role = '${STUDENT_ROLE}')
        GROUP BY session_user_row.sesid
    ) AS participants
        ON participants.sesid = sessions.id
    WHERE sessions.creator = $1
    ORDER BY sessions.time DESC, sessions.id DESC;
`;

function countOf(value) {
    const count = Number(value);
    return Number.isSafeInteger(count) && count > 0 ? count : 0;
}

/**
 * The current phase of a row: its number and its mode, "team" or
 * "individual". Any stored mode other than "team" reads as individual, as in
 * the dashboard's bar (`phaseModeKey`). Null when no phase is running.
 * @param {{ currentPhaseNumber?: unknown, currentPhaseMode?: unknown }} row
 * @returns {{ number: number, mode: "team"|"individual" }|null}
 */
export function currentPhaseOf(row) {
    const number = Number(row?.currentPhaseNumber);
    if (!Number.isInteger(number) || number < 1) {
        return null;
    }
    return {
        number,
        mode: row.currentPhaseMode === "team" ? "team" : "individual",
    };
}

/**
 * The design's title of a row, trimmed, or null when the design has none.
 * @param {{ designTitle?: unknown }} row
 * @returns {string|null}
 */
export function designTitleOf(row) {
    const title = typeof row?.designTitle === "string" ? row.designTitle.trim() : "";
    return title === "" ? null : title;
}

/**
 * The design's case of a row: its id and title, both null when the design has
 * no case or either is missing.
 * @param {{ caseId?: unknown, caseTitle?: unknown }} row
 * @returns {{ caseId: number|null, caseTitle: string|null }}
 */
export function activityCaseOf(row) {
    const caseId = countOf(row?.caseId);
    const caseTitle = typeof row?.caseTitle === "string" ? row.caseTitle.trim() : "";
    if (caseId === 0 || caseTitle === "") {
        return { caseId: null, caseTitle: null };
    }
    return { caseId, caseTitle };
}

/**
 * One activity of `GET /activities`, from a row of TEACHER_ACTIVITIES_SQL.
 * Every field the list returned before #1049 is kept as it was, except the
 * design document, replaced by `designTitle` (#1055).
 * @param {object} row
 * @returns {object}
 */
export function teacherActivityListItem(row) {
    return {
        id:                row.id,
        sessionId:         row.sessionId,
        creator:           row.creator,
        name:              row.name,
        description:       row.description,
        time:              row.time,
        code:              row.code,
        archived:          row.archived,
        status:            row.status,
        type:              row.type,
        designId:          row.designId,
        designTitle:       designTitleOf(row),
        currentPhase:      currentPhaseOf(row),
        phaseCount:        countOf(row.phaseCount),
        participantCount:  countOf(row.participantCount),
        aiServicesEnabled: sessionAiServicesEnabled(row),
        timeMode:          sessionTimeMode(row),
        finishedAt:        row.finishedAt ?? null,
        ...activityCaseOf(row),
    };
}
