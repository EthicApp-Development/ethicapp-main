// The teacher's list of activities, `GET /activities` (#1049, epic #1046):
// each activity with its session and design, plus what the activities table
// shows about it: the current phase and its mode, the number of phases in the
// design, how many participants joined, whether its AI services are on and
// when it ended.
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

import { sessionAiServicesEnabled } from "./session-ai-services.js";

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
        designs.design,
        sessions.status,
        sessions.type,
        designs.id AS "designId",
        sessions.ai_services_enabled,
        sessions.finished_at AS "finishedAt",
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
 * One activity of `GET /activities`, from a row of TEACHER_ACTIVITIES_SQL.
 * Every field the list returned before #1049 is kept as it was; the design
 * document is trimmed later (#1055).
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
        design:            row.design,
        status:            row.status,
        type:              row.type,
        designId:          row.designId,
        currentPhase:      currentPhaseOf(row),
        phaseCount:        countOf(row.phaseCount),
        participantCount:  countOf(row.participantCount),
        aiServicesEnabled: sessionAiServicesEnabled(row),
        finishedAt:        row.finishedAt ?? null,
    };
}
