// The response detail of the teacher's activity dashboard (#896, epic #892):
// the side panel a response row opens, for one student or one group of a
// semantic-differential phase. Plain functions over the dashboard's phase
// data (`{ descriptor, state }`), its table rows and the group chat's
// messages: which rows the panel moves through and in what order, which rows
// are highlighted, whether a group shows its answers and chat split or as
// tabs, how many messages the Chat tab has not shown yet, and the one-line
// digest of a group's values.

import { filterRowsByParticipant, isParticipantRow } from "./activity-dashboard.js";

// What the panel shows: one student's answers or one group's answers and chat.
export const DETAIL_KINDS = Object.freeze(["student", "group"]);

// How tall the panel must be to show a group's answers above its chat, with a
// splitter between them; below it, the two parts are tabs. About 800 px, which
// a 1080 px tall window gives and a 768 px tall one does not.
export const SPLIT_MIN_PANEL_HEIGHT = 800;

// What the panel leaves of the window's height: the app bar (68 px), the
// activity bar (56 px) and a margin above and below the panel (12 px each),
// as the style sheet places it.
export const DETAIL_PANEL_TOP_OFFSET = 148;

// The smallest height, in px, the splitter leaves to the answers or to the
// chat, and how far an arrow key moves it.
export const SPLIT_MIN_PART_HEIGHT = 140;
export const SPLIT_KEYBOARD_STEP = 24;

function isGroupSummaryRow(row) {
    return Boolean(row) && typeof row === "object" && row.groupStatistics === true;
}

function hasValue(value) {
    return value !== null && value !== undefined && value !== "";
}

// The key the panel and the table know a row by: `group:<id>` for a group's
// summary row (`group:n<number>` when it has no id), `student:<id>` for a
// student's row. Null for anything else.
export function detailRowKey(row) {
    if (isGroupSummaryRow(row)) {
        if (hasValue(row.groupId)) {
            return `group:${row.groupId}`;
        }
        return hasValue(row.groupNumber) ? `group:n${row.groupNumber}` : null;
    }
    if (isParticipantRow(row) && hasValue(row.userId)) {
        return `student:${row.userId}`;
    }
    return null;
}

// What the panel opens for a row of a phase's table: the kind, the row's key,
// the phase, and the student or the group. Null for a row that has no detail.
export function detailSelection(row, phaseData, options = {}) {
    const key = detailRowKey(row);
    const phaseId = phaseData?.descriptor?.id ?? null;
    if (!key || phaseId === null) {
        return null;
    }

    const group = isGroupSummaryRow(row);
    return {
        kind:        group ? "group" : "student",
        key,
        phaseId,
        userId:      group ? null : row.userId,
        groupId:     hasValue(row.groupId) ? row.groupId : null,
        groupNumber: hasValue(row.groupNumber) ? row.groupNumber : null,
        // The tab a group opens on when its panel has tabs: the answers,
        // unless the teacher followed a student's link to the group's chat.
        initialTab:  group && options.initialTab === "chat" ? "chat" : "answers",
    };
}

// The rows the panel moves through with ‹ › and ↑ ↓, in the table's order:
// the rows the participant search leaves, students and groups alike.
export function detailRows(phaseData, query) {
    const rows = Array.isArray(phaseData?.state) ? phaseData.state : [];
    return (filterRowsByParticipant(rows, query) || []).filter(row => detailRowKey(row) !== null);
}

// The row with this key, or null.
export function findDetailRow(rows, key) {
    return (Array.isArray(rows) ? rows : []).find(row => detailRowKey(row) === key) || null;
}

// The row before (`step` -1) or after (`step` 1) the one with this key, in
// the table's order. Null at either end, or when the row is no longer listed.
export function adjacentDetailRow(rows, key, step) {
    const list = Array.isArray(rows) ? rows : [];
    const index = list.findIndex(row => detailRowKey(row) === key);
    if (index < 0 || (step !== -1 && step !== 1)) {
        return null;
    }
    return list[index + step] || null;
}

function sameGroup(row, selection) {
    if (hasValue(selection.groupId) && hasValue(row.groupId)) {
        return Number(row.groupId) === Number(selection.groupId);
    }
    return hasValue(selection.groupNumber) && hasValue(row.groupNumber)
        && Number(row.groupNumber) === Number(selection.groupNumber);
}

// Whether a table row is highlighted while the panel shows this selection: the
// student's row, or every row of the group, its members and its summary.
export function isRowInDetail(selection, row) {
    if (!selection || !row || typeof row !== "object") {
        return false;
    }
    if (selection.kind === "group") {
        return sameGroup(row, selection);
    }
    return isParticipantRow(row) && Number(row.userId) === Number(selection.userId);
}

// The students' rows of a group, in the table's order.
export function groupMemberRows(phaseData, selection) {
    const rows = Array.isArray(phaseData?.state) ? phaseData.state : [];
    if (!selection) {
        return [];
    }
    return rows.filter(row => isParticipantRow(row) && sameGroup(row, selection));
}

// The group summary row of a student's group, for the link from a student's
// panel to the group and its chat. Null outside a group.
export function studentGroupRow(phaseData, studentRow) {
    if (!isParticipantRow(studentRow)
        || (!hasValue(studentRow.groupId) && !hasValue(studentRow.groupNumber))) {
        return null;
    }
    const rows = Array.isArray(phaseData?.state) ? phaseData.state : [];
    const selection = { groupId: studentRow.groupId, groupNumber: studentRow.groupNumber };
    return rows.find(row => isGroupSummaryRow(row) && sameGroup(row, selection)) || null;
}

// The panel's height in a window this tall.
export function detailPanelHeight(viewportHeight, topOffset = DETAIL_PANEL_TOP_OFFSET) {
    const height = Number(viewportHeight);
    return Number.isFinite(height) ? Math.max(0, height - topOffset) : 0;
}

// Whether a group's answers and chat are tabs (true) or split (false) in a
// panel this tall. An unknown height keeps the split.
export function detailUsesTabs(panelHeight) {
    const height = Number(panelHeight);
    return Number.isFinite(height) && height > 0 && height < SPLIT_MIN_PANEL_HEIGHT;
}

// The answers' height once the splitter moves to `height`, leaving at least
// `minPart` px to each part of `available` px.
export function clampSplitHeight(height, available, minPart = SPLIT_MIN_PART_HEIGHT) {
    const total = Number(available);
    const wanted = Number(height);
    if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(wanted)) {
        return null;
    }
    if (total < 2 * minPart) {
        return Math.round(total / 2);
    }
    return Math.round(Math.min(Math.max(wanted, minPart), total - minPart));
}

// How many messages the Chat tab has not shown yet: those whose id is not in
// `seenIds`, the teacher's own aside.
export function unreadMessageCount(messages, seenIds, isOwnMessage = () => false) {
    const seen = seenIds instanceof Set ? seenIds : new Set();
    return (Array.isArray(messages) ? messages : [])
        .filter(message => message && !seen.has(message.id) && !isOwnMessage(message))
        .length;
}

function questionNumber(question, index) {
    const number = Number(question?.number);
    return Number.isFinite(number) && number > 0 ? number : index + 1;
}

// The chat messages with the incoming ones added at the end, each once: a
// message the teacher sent can also arrive through the live subscription.
export function mergeChatMessages(messages, incoming) {
    const merged = Array.isArray(messages) ? [...messages] : [];
    const ids = new Set(merged.map(message => Number(message?.id)));
    (Array.isArray(incoming) ? incoming : []).forEach(message => {
        if (message && !ids.has(Number(message.id))) {
            ids.add(Number(message.id));
            merged.push(message);
        }
    });
    return merged;
}

// How the digest shows a member who has not answered.
export const DIGEST_NO_VALUE = "—";

// The one-line digest of a group's values above its chat transcript: for each
// question, every member's value in the table's order (null when a member has
// not answered it), and the same values as the text the digest shows,
// "2 · 3 · —".
export function groupValueDigest(members, questions) {
    const rows = Array.isArray(members) ? members : [];
    return (Array.isArray(questions) ? questions : []).map((question, index) => {
        const number = questionNumber(question, index);
        const values = rows.map(member =>
            (hasValue(member?.[`r${number}`]) ? member[`r${number}`] : null));
        return {
            number,
            values,
            text: values
                .map(value => (value === null ? DIGEST_NO_VALUE : String(value)))
                .join(" · "),
        };
    });
}

// A string that changes whenever a member of the group answers or changes an
// answer or a justification, so the panel reloads the group's answers then.
// The members' order does not count: hiding names (#897) reorders them by
// letter without any answer changing.
export function groupAnswerSignature(members, questions) {
    const rows = Array.isArray(members) ? members : [];
    const numbers = (Array.isArray(questions) ? questions : []).map(questionNumber);
    const answer = (member, number) =>
        `${member?.[`r${number}`] ?? ""}/${member?.[`commentR${number}`] ?? ""}`;
    return rows
        .map(member => [member?.userId, ...numbers.map(number => answer(member, number))].join(","))
        .sort()
        .join(";");
}

// Whether a key pressed on a table row opens it, as a click does: Enter or
// Space on the row itself.
export function isRowActivationKey(event) {
    return Boolean(event) && event.target === event.currentTarget
        && (event.key === "Enter" || event.key === " ");
}

const TEXT_ENTRY_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

// What a key pressed in the panel does: "close" for Escape, "previous" or
// "next" for the arrow keys (unless the focus is in a text field or on the
// splitter, which use them), null otherwise.
export function detailKeyAction(event) {
    if (!event || event.altKey || event.ctrlKey || event.metaKey) {
        return null;
    }
    if (event.key === "Escape") {
        return "close";
    }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
        return null;
    }

    const target = event.target || {};
    const role = typeof target.getAttribute === "function" ? target.getAttribute("role") : null;
    if (TEXT_ENTRY_TAGS.has(String(target.tagName || "").toUpperCase())
        || target.isContentEditable === true || role === "separator") {
        return null;
    }
    return event.key === "ArrowUp" ? "previous" : "next";
}

function normalizeQuestion(question, index) {
    const ansFormat = question?.ans_format || {};

    return {
        ...question,
        number: Number(
            question?.number
            || question?.order
            || question?.itemNumber
            || index + 1
        ),
        text: question?.text
            || question?.q_text
            || question?.qText
            || question?.question
            || question?.name
            || question?.title
            || question?.label
            || null,
        // How to read the text (#765): a missing value means text/plain.
        contentType: question?.contentType
            || question?.q_text_content_type
            || question?.titleContentType
            || null,
        leftPole: question?.leftPole
            || question?.left_pole
            || question?.l_pole
            || question?.tleft
            || ansFormat?.l_pole
            || null,
        rightPole: question?.rightPole
            || question?.right_pole
            || question?.r_pole
            || question?.tright
            || ansFormat?.r_pole
            || null,
        range: Number(
            question?.range
            || question?.num
            || question?.values
            || ansFormat?.values
            || 0
        ),
        justify: typeof question?.justify === "boolean"
            ? question.justify
            : (typeof question?.justificationRequired === "boolean"
                ? question.justificationRequired
                : Boolean(ansFormat?.just_required)),
    };
}

// A phase's questions as the detail shows them: number, text, poles, range
// and whether a justification is asked, from either the phase's descriptor or
// the design.
export function detailQuestions(phaseData) {
    return (phaseData?.descriptor?.questions || []).map(normalizeQuestion);
}

// The values of a question's scale: 1 to its range.
export function scaleOptions(question) {
    const range = Number(question?.range) || 0;
    return Array.from({ length: range }, (_, index) => index + 1);
}
