import * as config from "../config/database.config.js";
import * as rpg2 from "../db/rest-pg-2.js";

// What a student may learn about the members of their group (#1199).
//
// In an anonymous phase a student sees their peers by their mask in the group
// (`teamusers.anon_mask`) and never by name, so no student-facing payload may
// carry a peer's `firstname`, `lastname` or `name`, even when the student app
// would not render it. The rule is the one helpers/chat-author-label.js
// applies to the composing notice (epic #601):
//
// - a phase shows names only when its flag is `false`; anything else (true,
//   or a flag missing from an older cached payload) hides them;
// - the student's own names are always theirs to see;
// - the activity's teacher sees every name. The teacher's routes do not call
//   these helpers.
//
// The anonymity that applies is the phase of the group the peer and the
// student share: each peer response carries its own phase's flag, and the
// previous responses of a group follow the current phase, whose masks label
// them.

/**
 * Whether a student sees a peer's names.
 *
 * @param {Object} relation
 * @param {number|string} relation.viewerId - The student reading.
 * @param {number|string} relation.peerId - The member of the group.
 * @param {boolean} [relation.phaseAnonymous] - The flag of the phase they
 *     share; only `false` shows names.
 * @returns {boolean}
 */
export function studentSeesPeerNames({ viewerId, peerId, phaseAnonymous }) {
    if (phaseAnonymous === false) {
        return true;
    }
    const viewer = Number(viewerId);
    return Number.isSafeInteger(viewer) && viewer > 0 && viewer === Number(peerId);
}

/**
 * The participants of GET /phases/:id/user_group/:user_id as a student sees
 * them: in an anonymous phase, each peer's `firstname`, `lastname` and `name`
 * are null. The keys stay, so the answer keeps its shape.
 *
 * @param {Array<{ user_id: number, anon_mask: string|null,
 *     firstname: string|null, lastname: string|null, name: string|null }>}
 *     participants
 * @param {{ viewerId: number|string, phaseAnonymous: boolean }} context
 * @returns {Array<Object>} New objects; the input is not changed.
 */
export function groupParticipantsForStudent(participants, { viewerId, phaseAnonymous }) {
    return participants.map((participant) => {
        if (studentSeesPeerNames({ viewerId, peerId: participant.user_id, phaseAnonymous })) {
            return { ...participant };
        }
        return { ...participant, firstname: null, lastname: null, name: null };
    });
}

export const GROUP_MASKS_SQL = `
    SELECT st.anon AS phase_anonymous,
           tu.uid AS user_id,
           tu.anon_mask
    FROM teams AS t
    INNER JOIN stages AS st
        ON st.id = t.stageid
    LEFT JOIN teamusers AS tu
        ON tu.tmid = t.id
    WHERE t.id = $1
`;

/**
 * Whether a group's phase is anonymous, and its members' masks.
 *
 * @param {number|string} groupId
 * @param {Function} [query=rpg2.execSQL] - Replaced in tests.
 * @returns {Promise<{ phaseAnonymous: boolean, masksByUserId: Map<number,
 *     string|null> }>} An unknown group counts as anonymous, with no masks.
 */
export async function loadGroupMasks(groupId, query = rpg2.execSQL) {
    const rows = await query({
        sql:       GROUP_MASKS_SQL,
        dbcon:     config.dbconnString,
        sqlParams: [rpg2.param("plain", Number(groupId))],
    });
    const masksByUserId = new Map();
    for (const row of rows) {
        if (row.user_id != null) {
            masksByUserId.set(Number(row.user_id), row.anon_mask ?? null);
        }
    }
    return {
        phaseAnonymous: rows.length === 0 ? true : rows[0].phase_anonymous === true,
        masksByUserId,
    };
}

function trimmedOrNull(value) {
    const text = typeof value === "string" ? value.trim() : "";
    return text || null;
}

/**
 * A group chat transcript as a student sees it. In an anonymous phase, a
 * peer's message (`author_role` `A`) carries the peer's mask in the group as
 * `author_name`, or null without one: the label chatAuthorLabel() gives them.
 * The student's own messages, the teacher's and the external agents' keep
 * their `author_name`.
 *
 * @param {Array<{ uid: number, author_role: string, author_name: string|null }>}
 *     messages
 * @param {{ viewerId: number|string, phaseAnonymous: boolean,
 *     masksByUserId: Map<number, string|null> }} context
 * @returns {Array<Object>} New objects; the input is not changed.
 */
export function chatTranscriptForStudent(messages, { viewerId, phaseAnonymous, masksByUserId }) {
    return messages.map((message) => {
        if (message.author_role !== "A"
            || studentSeesPeerNames({ viewerId, peerId: message.uid, phaseAnonymous })) {
            return { ...message };
        }
        return {
            ...message,
            author_name: trimmedOrNull(masksByUserId.get(Number(message.uid))),
        };
    });
}

/**
 * The previous responses of a group (GET
 * /phases/:id/user_group/:user_id/previous_responses) as one of its students
 * sees them. In an anonymous phase, every peer's `name` in `participants` and
 * `authorName` in the responses are null; the student's own stay.
 *
 * @param {{ phaseAnonymous?: boolean, participants?: Array<Object>,
 *     phases?: Array<Object> }} payload
 * @param {number|string} viewerId
 * @returns {Object} A new payload; the input is not changed.
 */
export function previousGroupResponsesForStudent(payload, viewerId) {
    const { phaseAnonymous } = payload;
    const sees = peerId => studentSeesPeerNames({ viewerId, peerId, phaseAnonymous });

    return {
        ...payload,
        participants: (payload.participants || []).map(participant => (
            sees(participant.userId) ? { ...participant } : { ...participant, name: null }
        )),
        phases: (payload.phases || []).map(phase => ({
            ...phase,
            tasks: (phase.tasks || []).map(task => ({
                ...task,
                responses: (task.responses || []).map(response => (
                    sees(response.userId) ? { ...response } : { ...response, authorName: null }
                )),
            })),
        })),
    };
}

/**
 * The `peer` of a peer response in a student's full state: its name only when
 * the phase of the group they shared is not anonymous. The peer is never the
 * student, so no exception applies.
 *
 * @param {{ peer_id: number, peer_name: string|null,
 *     peer_anonymity: string|null, phase_anonymous: boolean|null }} row
 * @returns {{ id: number, name: string|null, anonMask: string|null }}
 */
export function peerOfResponse(row) {
    return {
        id:       row.peer_id,
        name:     row.phase_anonymous === false ? row.peer_name : null,
        anonMask: row.peer_anonymity,
    };
}
