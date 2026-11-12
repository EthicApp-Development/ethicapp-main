import * as config from "../config/database.config.js";
import * as rpg2 from "../db/rest-pg-2.js";
import { getStatusCode } from "../../common/modules/session-status.js";
import { getDesignTypeByPhaseId } from "./designs-helper.js";

// Who may read and write a group's chat. The chat routes of
// controllers/group-messages.js and the composing signal handlers of the
// sockets (epic #601) apply the same rules, read on every call: nothing is
// cached, so a phase started by the deadline runner (#1105) closes the
// previous phase's chat for the very next request or signal.

export const GROUP_CHAT_ACCESS_SQL = `
    SELECT t.id AS group_id,
           t.stageid AS phase_id,
           s.id AS session_id,
           s.creator,
           s.current_stage,
           s.status,
           st.chat,
           EXISTS (
               SELECT 1
               FROM teamusers AS tu
               WHERE tu.tmid = t.id
                 AND tu.uid = $4
           ) AS is_group_member,
           EXISTS (
               SELECT 1
               FROM differential AS d
               WHERE d.id = $3
                 AND d.stageid = t.stageid
           ) AS question_belongs_to_phase
    FROM teams AS t
    INNER JOIN stages AS st
        ON st.id = t.stageid
    INNER JOIN sessions AS s
        ON s.id = st.sesid
    WHERE t.id = $1
      AND ($2::integer IS NULL OR t.stageid = $2)
    LIMIT 1
`;

/**
 * The access of a user to a group's chat.
 *
 * - `canRead`: a member of the group (role `A`) or the activity's teacher
 *   (role `P`, the session's creator).
 * - `canPost`: `canRead`, and the chat accepts messages: the phase has chat,
 *   is the session's current phase and the session is in progress.
 *
 * @param {Object} request
 * @param {number|string} request.groupId
 * @param {number|string|null} [request.phaseId] - When given, the group must
 *     belong to this phase.
 * @param {number|string} request.questionId - In a semantic differential
 *     phase, it must be one of the phase's questions.
 * @param {number|string} request.userId
 * @param {string} request.role - `A` or `P`; any other role reads nothing.
 * @param {Object} [dependencies] - Replaced in tests.
 * @param {Function} [dependencies.query=rpg2.execSQL]
 * @param {Function} [dependencies.loadDesignType=getDesignTypeByPhaseId]
 * @returns {Promise<{ phaseId: number, sessionId: number, groupId: number,
 *     designType: string, canRead: boolean, canPost: boolean } | null>} null
 *     when the group does not exist, does not belong to the phase, or the
 *     question does not belong to a semantic differential phase.
 */
export async function resolveGroupChatAccessContext(
    { groupId, phaseId = null, questionId, userId, role },
    { query = rpg2.execSQL, loadDesignType = getDesignTypeByPhaseId } = {}
) {
    const rows = await query({
        sql:       GROUP_CHAT_ACCESS_SQL,
        dbcon:     config.dbconnString,
        sqlParams: [
            Number(groupId),
            phaseId == null ? null : Number(phaseId),
            Number(questionId),
            Number(userId),
        ],
    });

    if (rows.length === 0) {
        return null;
    }

    const row = rows[0];
    const designType = await loadDesignType(row.phase_id);
    if (designType === "semantic_differential" && !row.question_belongs_to_phase) {
        return null;
    }

    const isTeacherOwner = role === "P" && Number(row.creator) === Number(userId);
    const isStudentMember = role === "A" && row.is_group_member === true;
    const activeStatus = getStatusCode("in_progress");
    const isActiveChatPhase = Boolean(row.chat)
        && Number(row.current_stage) === Number(row.phase_id)
        && Number(row.status) === Number(activeStatus);

    return {
        phaseId:   Number(row.phase_id),
        sessionId: Number(row.session_id),
        groupId:   Number(row.group_id),
        designType,
        canRead:   isTeacherOwner || isStudentMember,
        canPost:   (isTeacherOwner || isStudentMember) && isActiveChatPhase,
    };
}

/**
 * The access context of a user who may write in the group's chat right now
 * (`canPost`), or null. The composing signal handlers use it: a signal is
 * accepted only where a message would be.
 *
 * @param {{ groupId: number, phaseId: number, questionId: number,
 *     userId: number, role: "A"|"P" }} request - `phaseId` is required.
 * @param {Object} [dependencies] - As for resolveGroupChatAccessContext().
 * @returns {Promise<{ phaseId: number, sessionId: number, groupId: number,
 *     designType: string, canRead: true, canPost: true } | null>}
 */
export async function resolveOpenGroupChatContext(request, dependencies) {
    if (request?.phaseId == null) {
        return null;
    }
    const context = await resolveGroupChatAccessContext(request, dependencies);
    return context?.canPost === true ? context : null;
}
