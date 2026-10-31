// Hiding students' names on the teacher's activity dashboard (#897, epic
// #892), so the teacher can share or project it. While the "Hide names"
// switch is on, every student is shown by a pseudonym instead of their name,
// following one rule:
//
// - in a phase with groups, the student's letter within their group
//   ("Member B"), from `teamusers.anon_mask`; letters last one phase;
// - in a phase without groups, and for a student without a group in a group
//   phase, the student's activity-wide number ("Participant 37"), which the
//   server draws at random once per activity (GET /sessions/:id/pseudonyms);
// - the Participants tab always shows the numbers.
//
// Rows are ordered by pseudonym, never by name. The teacher's own messages
// and the AI agents keep their labels. The table, the response detail panel,
// the group chat and the participants list all name students through these
// functions. They are plain functions: the dashboard hands them the numbers
// and a `translate(key, params)` function.

// The translation keys of the three kinds of pseudonym.
export const HIDDEN_NAME_KEYS = Object.freeze({
    letter:  "dashboard_hidden_name_member",
    number:  "dashboard_hidden_name_participant",
    // A student whose number has not arrived yet.
    pending: "dashboard_hidden_name_pending",
});

// The chat's author roles that keep their label while names are hidden.
export const TEACHER_AUTHOR_ROLE = "P";
export const AGENT_AUTHOR_ROLE = "external_service";

const STUDENT_ROLE = "A";
const KIND_ORDER = Object.freeze({ letter: 0, number: 1, pending: 2 });

function hasValue(value) {
    return value !== null && value !== undefined && value !== "";
}

function positiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
}

// A table row's student id: `userId`, or `uid` in a ranking table.
export function participantId(row) {
    return positiveInteger(row?.userId ?? row?.uid);
}

function isGroupSummaryRow(row) {
    return Boolean(row) && typeof row === "object" && row.groupStatistics === true;
}

function hasGroup(row) {
    return hasValue(row?.groupId) || hasValue(row?.groupNumber);
}

// The numbers GET /sessions/:id/pseudonyms returns, as a map from student id
// to number. Entries without a valid id or number are left out.
export function pseudonymNumberMap(pseudonyms) {
    const numbers = new Map();
    (Array.isArray(pseudonyms) ? pseudonyms : []).forEach(entry => {
        const userId = positiveInteger(entry?.userId);
        const number = positiveInteger(entry?.number);
        if (userId !== null && number !== null) {
            numbers.set(userId, number);
        }
    });
    return numbers;
}

function numberOf(numbers, userId) {
    return userId !== null && numbers instanceof Map ? numbers.get(userId) ?? null : null;
}

// A student's pseudonym in a phase: `{ kind: "letter", letter }` in a group
// phase for a student with a group and a letter, `{ kind: "number", number }`
// otherwise, and `{ kind: "pending" }` while the student's number is unknown.
// `row` is the student's table row (it carries `groupLetter` in a group
// phase); `groupPhase` says whether the phase has groups.
export function participantPseudonym(row, { groupPhase = false, numbers = null } = {}) {
    const letter = typeof row?.groupLetter === "string" ? row.groupLetter.trim() : "";
    if (groupPhase && letter !== "" && hasGroup(row)) {
        return { kind: "letter", letter };
    }

    const number = numberOf(numbers, participantId(row));
    return number !== null ? { kind: "number", number } : { kind: "pending" };
}

// A number as the dashboard shows it, with at least two digits: "04", "37".
export function formatPseudonymNumber(number) {
    return String(number).padStart(2, "0");
}

// The text of a pseudonym: "Member B", "Participant 04", or "Participant …"
// while the number is unknown.
export function pseudonymLabel(pseudonym, translate) {
    const kind = pseudonym?.kind;
    if (kind === "letter") {
        return translate(HIDDEN_NAME_KEYS.letter, { letter: pseudonym.letter });
    }
    if (kind === "number") {
        return translate(HIDDEN_NAME_KEYS.number, {
            number: formatPseudonymNumber(pseudonym.number),
        });
    }
    return translate(HIDDEN_NAME_KEYS.pending);
}

// Orders two pseudonyms: letters (A, B… Z, AA…) before numbers (ascending)
// before the pending ones, which compare equal.
export function comparePseudonyms(left, right) {
    const kindDifference = (KIND_ORDER[left?.kind] ?? KIND_ORDER.pending)
        - (KIND_ORDER[right?.kind] ?? KIND_ORDER.pending);
    if (kindDifference !== 0) {
        return kindDifference;
    }
    if (left.kind === "letter") {
        return left.letter.length - right.letter.length
            || (left.letter < right.letter ? -1 : left.letter > right.letter ? 1 : 0);
    }
    if (left.kind === "number") {
        return left.number - right.number;
    }
    return 0;
}

// Two rows' pseudonyms in order, or 0 when a row has none (a group's summary
// row, the teacher).
function compareKnownPseudonyms(left, right) {
    return left && right ? comparePseudonyms(left, right) : 0;
}

// The block a row keeps while the rows are ordered by pseudonym: its group
// (members and summary row), its ranking cluster, or the rest.
function blockKey(row) {
    if (isGroupSummaryRow(row) || hasGroup(row)) {
        return hasValue(row.groupId) ? `group:${row.groupId}` : `group:n${row.groupNumber}`;
    }
    if (hasValue(row?.responseCluster)) {
        return `cluster:${row.responseCluster}`;
    }
    return "rest";
}

// A response table's rows as they show while names are hidden: each
// student's `userName` is their pseudonym, and the rows are ordered by
// pseudonym. Groups and ranking clusters keep their order and their rows; a
// group's summary row stays after its members. Summary rows and other rows
// that are not a student's come back as they are; students' rows are copies,
// so the live table keeps the names.
export function hiddenNameRows(rows, { groupPhase = false, numbers = null, translate } = {}) {
    if (!Array.isArray(rows)) {
        return rows;
    }

    const blocks = new Map();
    const decorated = rows.map((row, index) => {
        const key = blockKey(row);
        if (!blocks.has(key)) {
            blocks.set(key, blocks.size);
        }
        const student = Boolean(row) && typeof row === "object" && !isGroupSummaryRow(row);
        const pseudonym = student ? participantPseudonym(row, { groupPhase, numbers }) : null;
        const shown = student ? { ...row, userName: pseudonymLabel(pseudonym, translate) } : row;
        return { block: blocks.get(key), index, pseudonym, row: shown };
    });

    decorated.sort((left, right) => left.block - right.block
        // A block's students first, then its summary row.
        || (left.pseudonym ? 0 : 1) - (right.pseudonym ? 0 : 1)
        || compareKnownPseudonyms(left.pseudonym, right.pseudonym)
        || left.index - right.index);

    return decorated.map(item => item.row);
}

// A started phase's data (`{ descriptor, state, … }`) as it shows while names
// are hidden: the same data with its rows from `hiddenNameRows`.
export function hiddenNamePhase(phaseData, { numbers = null, translate } = {}) {
    if (!phaseData || typeof phaseData !== "object") {
        return phaseData;
    }
    return {
        ...phaseData,
        state: hiddenNameRows(phaseData.state, {
            groupPhase: phaseData.descriptor?.mode === "team",
            numbers,
            translate,
        }),
    };
}

function isStudentUser(user) {
    return !user?.role || user.role === STUDENT_ROLE;
}

// The session's users as the Participants tab shows them while names are
// hidden: each student named by their number and without their email,
// ordered by number after the users who are not students (the teacher), who
// keep their name. `hiddenOrder` is each user's place in that order.
export function hiddenNameUsers(users, { numbers = null, translate } = {}) {
    if (!Array.isArray(users)) {
        return [];
    }

    const decorated = users.map((user, index) => {
        if (!isStudentUser(user)) {
            return { index, pseudonym: null, user: { ...user } };
        }
        const pseudonym = participantPseudonym({ userId: user?.id }, { numbers });
        return {
            index,
            pseudonym,
            user: { ...user, name: pseudonymLabel(pseudonym, translate), mail: null },
        };
    });

    decorated.sort((left, right) =>
        (left.pseudonym ? 1 : 0) - (right.pseudonym ? 1 : 0)
        || compareKnownPseudonyms(left.pseudonym, right.pseudonym)
        || left.index - right.index);

    return decorated.map((item, order) => ({ ...item.user, hiddenOrder: order }));
}

// A group chat message's author while names are hidden: the teacher's
// label for the teacher's messages, the agent's own name for an AI agent's,
// and a student's pseudonym from `memberLabels` (student id to label) for
// the rest, or the pending label for a student the panel does not know.
export function hiddenChatAuthorName(message, { memberLabels = {}, teacherLabel, translate } = {}) {
    if (message?.authorRole === TEACHER_AUTHOR_ROLE) {
        return teacherLabel;
    }
    if (message?.authorRole === AGENT_AUTHOR_ROLE) {
        return message.authorName || "";
    }
    const userId = positiveInteger(message?.uid);
    return (userId !== null && memberLabels[userId])
        || pseudonymLabel({ kind: "pending" }, translate);
}
