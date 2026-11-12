import * as config from "../config/database.config.js";
import * as rpg2 from "../db/rest-pg-2.js";

// The label of a group chat author, resolved on the server (epic #601, #654):
// `{ userId, role, name }`. The composing notice (`onChatComposing`) carries
// it, so that a client never needs a peer's real name to label them, and the
// chat messages can use the same rule (#1199).
//
// `name` follows the student app's chat (`resolveDisplayName()` in
// ethicapp-student's PhaseChatOverlay.jsx):
//
// - the activity's teacher (role `P`): null, and the client shows its
//   translated teacher label;
// - a participant (role `A`) in an anonymous phase: their `anon_mask` in the
//   group, or null without one, and the client shows its translated
//   anonymous label. Never their real name;
// - a participant in a phase that is not anonymous: their first and last
//   name, or their `name` when both are empty, or null when all are empty.

export const CHAT_AUTHOR_ROLES = Object.freeze(["A", "P"]);

function trimmed(value) {
    return typeof value === "string" ? value.trim() : "";
}

function participantName(participant) {
    const fullName = `${trimmed(participant?.firstname)} ${trimmed(participant?.lastname)}`.trim();
    return fullName || trimmed(participant?.name) || null;
}

/**
 * The label of a chat author. Pure: it reads nothing.
 *
 * @param {Object} author
 * @param {number} author.userId - A positive integer.
 * @param {"A"|"P"} author.role - `A` for a participant, `P` for the activity's
 *     teacher.
 * @param {boolean} [author.phaseAnonymous] - Whether the chat's phase is
 *     anonymous. Anything other than `false` counts as anonymous, so a
 *     missing flag never reveals a name.
 * @param {{ anon_mask?: string|null, firstname?: string|null,
 *     lastname?: string|null, name?: string|null }|null} [author.participant]
 *     The participant's mask in the group and their names; ignored for the
 *     teacher.
 * @returns {Readonly<{ userId: number, role: "A"|"P", name: string|null }>}
 * @throws {TypeError} For a `userId` that is not a positive integer or a
 *     role other than `A` and `P`.
 */
export function chatAuthorLabel({ userId, role, phaseAnonymous, participant = null }) {
    if (!Number.isSafeInteger(userId) || userId <= 0) {
        throw new TypeError("A chat author label needs a positive integer userId.");
    }
    if (!CHAT_AUTHOR_ROLES.includes(role)) {
        throw new TypeError(
            `A chat author label needs a role among ${CHAT_AUTHOR_ROLES.join(", ")}.`
        );
    }

    if (role === "P") {
        return Object.freeze({ userId, role, name: null });
    }

    const name = phaseAnonymous === false
        ? participantName(participant)
        : trimmed(participant?.anon_mask) || null;
    return Object.freeze({ userId, role, name });
}

const CHAT_AUTHOR_IDENTITY_SQL = `
    SELECT tu.anon_mask,
           u.firstname,
           u.lastname,
           u.name,
           st.anon AS phase_anonymous
    FROM teamusers AS tu
    INNER JOIN users AS u ON u.id = tu.uid
    INNER JOIN teams AS t ON t.id = tu.tmid
    INNER JOIN stages AS st ON st.id = t.stageid
    WHERE tu.tmid = $1
      AND tu.uid = $2
    LIMIT 1
`;

/**
 * What chatAuthorLabel() needs about a member of a group: whether the group's
 * phase is anonymous, and the member's mask and names.
 *
 * @param {{ groupId: number, userId: number }} member
 * @param {Function} [query=rpg2.execSQL] - Replaced in tests.
 * @returns {Promise<{ phaseAnonymous: boolean, participant: { anon_mask:
 *     string|null, firstname: string|null, lastname: string|null, name:
 *     string|null } } | null>} null when the user is not a member of the
 *     group. The phase is anonymous only when its flag is true, as in the
 *     student app.
 */
export async function loadChatAuthorIdentity({ groupId, userId }, query = rpg2.execSQL) {
    const rows = await query({
        sql:       CHAT_AUTHOR_IDENTITY_SQL,
        dbcon:     config.dbconnString,
        sqlParams: [rpg2.param("plain", groupId), rpg2.param("plain", userId)],
    });
    if (rows.length === 0) {
        return null;
    }

    const row = rows[0];
    return {
        phaseAnonymous: row.phase_anonymous === true,
        participant:    {
            anon_mask: row.anon_mask ?? null,
            firstname: row.firstname ?? null,
            lastname:  row.lastname ?? null,
            name:      row.name ?? null,
        },
    };
}

/**
 * The label of an author writing in a group's chat. The teacher's needs no
 * read; a participant's reads their identity in the group.
 *
 * @param {{ groupId: number, userId: number, role: "A"|"P" }} author
 * @param {{ loadIdentity?: typeof loadChatAuthorIdentity }} [dependencies]
 * @returns {Promise<Readonly<{ userId: number, role: "A"|"P",
 *     name: string|null }> | null>} null when a participant is not a member
 *     of the group.
 */
export async function resolveChatAuthorLabel(
    { groupId, userId, role },
    { loadIdentity = loadChatAuthorIdentity } = {}
) {
    if (role === "P") {
        return chatAuthorLabel({ userId, role });
    }

    // Validates the author before reading anything.
    chatAuthorLabel({ userId, role, phaseAnonymous: true });
    const identity = await loadIdentity({ groupId, userId });
    if (!identity) {
        return null;
    }
    return chatAuthorLabel({ userId, role, ...identity });
}
