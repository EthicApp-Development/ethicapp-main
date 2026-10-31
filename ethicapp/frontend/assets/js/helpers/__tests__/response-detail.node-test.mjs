// The response detail panel's logic (#896, epic #892): the rows it moves
// through and their order, the highlighted rows, split or tabs, the Chat
// tab's unread count, the group's digest and the keys it answers to.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    DIGEST_NO_VALUE,
    SPLIT_MIN_PANEL_HEIGHT,
    adjacentDetailRow,
    clampSplitHeight,
    detailKeyAction,
    detailPanelHeight,
    detailQuestions,
    detailRowKey,
    detailRows,
    detailSelection,
    detailUsesTabs,
    findDetailRow,
    groupAnswerSignature,
    groupMemberRows,
    groupValueDigest,
    isRowActivationKey,
    isRowInDetail,
    mergeChatMessages,
    scaleOptions,
    studentGroupRow,
    unreadMessageCount,
} from "../response-detail.js";

const student = (userId, userName, groupId = null, groupNumber = null, answers = {}) =>
    ({ userId, userName, groupId, groupNumber, ...answers });
const groupRow = (groupId, groupNumber) =>
    ({ groupStatistics: true, groupId, groupNumber, groupName: `Grupo ${groupNumber}` });

// A group phase's table, as the dashboard orders it: each group's members,
// then its summary row.
function groupPhase() {
    return {
        descriptor: { id: 41, number: 2, mode: "team" },
        state:      [
            student(1, "Ana", 7, 1, { r1: 2, r2: 3 }),
            student(2, "Beto", 7, 1, { r1: 4, r2: null }),
            groupRow(7, 1),
            student(3, "Carla", 8, 2, { r1: 1, r2: 1, commentR1: "Porque sí" }),
            student(4, "Diego", 8, 2),
            groupRow(8, 2),
        ],
    };
}

describe("response detail rows", () => {
    it("knows students and groups by a key", () => {
        assert.equal(detailRowKey(student(3, "Carla")), "student:3");
        assert.equal(detailRowKey(groupRow(8, 2)), "group:8");
        const withoutId = { groupStatistics: true, groupId: null, groupNumber: "2" };
        assert.equal(detailRowKey(withoutId), "group:n2");
        assert.equal(detailRowKey({ groupStatistics: true }), null);
        assert.equal(detailRowKey(null), null);
        assert.equal(detailRowKey({ userName: "No id" }), null);
    });

    it("opens a student or a group, a group on its answers unless asked for the chat", () => {
        const phase = groupPhase();
        assert.deepEqual(detailSelection(phase.state[0], phase), {
            kind:        "student",
            key:         "student:1",
            phaseId:     41,
            userId:      1,
            groupId:     7,
            groupNumber: 1,
            initialTab:  "answers",
        });
        assert.deepEqual(detailSelection(phase.state[2], phase, { initialTab: "chat" }), {
            kind:        "group",
            key:         "group:7",
            phaseId:     41,
            userId:      null,
            groupId:     7,
            groupNumber: 1,
            initialTab:  "chat",
        });
        const studentChat = detailSelection(phase.state[0], phase, { initialTab: "chat" });
        assert.equal(studentChat.initialTab, "answers");
        assert.equal(detailSelection(phase.state[0], { descriptor: {} }), null);
        assert.equal(detailSelection({}, phase), null);
    });

    it("moves through the rows in the table's order, students and groups alike", () => {
        const rows = detailRows(groupPhase(), "");
        assert.deepEqual(rows.map(detailRowKey),
            ["student:1", "student:2", "group:7", "student:3", "student:4", "group:8"]);

        assert.equal(detailRowKey(adjacentDetailRow(rows, "student:2", 1)), "group:7");
        assert.equal(detailRowKey(adjacentDetailRow(rows, "group:7", 1)), "student:3");
        assert.equal(detailRowKey(adjacentDetailRow(rows, "student:3", -1)), "group:7");
        assert.equal(adjacentDetailRow(rows, "student:1", -1), null, "nothing before the first");
        assert.equal(adjacentDetailRow(rows, "group:8", 1), null, "nothing after the last row");
        assert.equal(adjacentDetailRow(rows, "student:99", 1), null);
        assert.equal(adjacentDetailRow(rows, "student:1", 2), null);
    });

    it("moves only through the rows the participant search leaves", () => {
        const rows = detailRows(groupPhase(), "carla");
        assert.deepEqual(rows.map(detailRowKey), ["student:3", "group:8"]);
        assert.equal(detailRowKey(adjacentDetailRow(rows, "student:3", 1)), "group:8");
    });

    it("moves through an individual phase in its order", () => {
        const phase = { descriptor: { id: 40 }, state: [student(5, "Eva"), student(6, "Fede")] };
        const rows = detailRows(phase, null);
        assert.deepEqual(rows.map(detailRowKey), ["student:5", "student:6"]);
        assert.equal(findDetailRow(phase.state, "student:6"), phase.state[1]);
        assert.equal(findDetailRow(phase.state, "student:7"), null);
        assert.deepEqual(detailRows(null, ""), []);
    });

    it("highlights the student's row, or every row of the group", () => {
        const phase = groupPhase();
        const studentSelection = detailSelection(phase.state[3], phase);
        assert.deepEqual(phase.state.map(row => isRowInDetail(studentSelection, row)),
            [false, false, false, true, false, false]);

        const groupSelection = detailSelection(phase.state[5], phase);
        assert.deepEqual(phase.state.map(row => isRowInDetail(groupSelection, row)),
            [false, false, false, true, true, true]);

        assert.equal(isRowInDetail(null, phase.state[0]), false);
        assert.equal(isRowInDetail(groupSelection, null), false);
    });

    it("finds a group's members and a student's group", () => {
        const phase = groupPhase();
        const names = selection => groupMemberRows(phase, selection).map(row => row.userName);
        assert.deepEqual(names({ groupId: 8 }), ["Carla", "Diego"]);
        assert.deepEqual(names({ groupNumber: "1" }), ["Ana", "Beto"]);
        assert.deepEqual(groupMemberRows(phase, null), []);

        assert.equal(studentGroupRow(phase, phase.state[0]), phase.state[2]);
        assert.equal(studentGroupRow(phase, student(9, "Sin grupo")), null);
        assert.equal(studentGroupRow(phase, phase.state[2]), null);
    });
});

describe("response detail layout", () => {
    it("splits a group's answers and chat in a tall panel and uses tabs otherwise", () => {
        assert.equal(SPLIT_MIN_PANEL_HEIGHT, 800);
        assert.equal(detailUsesTabs(detailPanelHeight(1080)), false, "1920 x 1080 splits");
        assert.equal(detailUsesTabs(detailPanelHeight(768)), true, "1366 x 768 has tabs");
        assert.equal(detailUsesTabs(detailPanelHeight(948)), false);
        assert.equal(detailUsesTabs(detailPanelHeight(947)), true);
        assert.equal(detailUsesTabs(undefined), false, "an unknown height keeps the split");
        assert.equal(detailPanelHeight(undefined), 0);
    });

    it("keeps room for both parts when the splitter moves", () => {
        assert.equal(clampSplitHeight(300, 700), 300);
        assert.equal(clampSplitHeight(20, 700), 140);
        assert.equal(clampSplitHeight(690, 700), 560);
        assert.equal(clampSplitHeight(100, 200), 100, "half each when there is no room for more");
        assert.equal(clampSplitHeight(100, 0), null);
        assert.equal(clampSplitHeight(Number.NaN, 700), null);
    });
});

describe("response detail chat", () => {
    const isOwn = message => message.authorRole === "P";

    it("counts the messages the Chat tab has not shown, the teacher's own aside", () => {
        const messages = [
            { id: 1, authorRole: "A" },
            { id: 2, authorRole: "A" },
            { id: 3, authorRole: "P" },
            { id: 4, authorRole: "external_service" },
        ];
        assert.equal(unreadMessageCount(messages, new Set([1]), isOwn), 2);
        assert.equal(unreadMessageCount(messages, new Set([1, 2, 4]), isOwn), 0);
        assert.equal(unreadMessageCount(messages, null), 4);
        assert.equal(unreadMessageCount(null, new Set()), 0);
    });

    it("adds each incoming message once, after the others", () => {
        const first = { id: 1 };
        const merged = mergeChatMessages([first], [{ id: 2 }, { id: "1" }, { id: 2 }, null]);
        assert.deepEqual(merged.map(message => message.id), [1, 2]);
        assert.equal(merged[0], first);
        assert.deepEqual(mergeChatMessages(null, [{ id: 5 }]), [{ id: 5 }]);
    });

    it("sums up the group's values per question in the table's order", () => {
        const phase = groupPhase();
        const members = groupMemberRows(phase, { groupId: 7 });
        const digest = groupValueDigest(members, [{ number: 1 }, { number: 2 }]);

        assert.deepEqual(digest, [
            { number: 1, values: [2, 4], text: "2 · 4" },
            { number: 2, values: [3, null], text: `3 · ${DIGEST_NO_VALUE}` },
        ]);
        assert.deepEqual(groupValueDigest(members, [{}]).map(item => item.number), [1]);
        assert.deepEqual(groupValueDigest(null, null), []);
    });

    it("tells when a member's answer or justification changed", () => {
        const members = groupMemberRows(groupPhase(), { groupId: 8 });
        const questions = [{ number: 1 }, { number: 2 }];
        const before = groupAnswerSignature(members, questions);

        assert.equal(groupAnswerSignature(members, questions), before);
        members[1].r1 = 3;
        assert.notEqual(groupAnswerSignature(members, questions), before);
        const answered = groupAnswerSignature(members, questions);
        members[0].commentR1 = "Lo pensé mejor";
        assert.notEqual(groupAnswerSignature(members, questions), answered);
    });
});

describe("response detail keys", () => {
    const element = (tagName, role = null) => ({ tagName, getAttribute: () => role });

    it("closes on Escape and moves with the arrow keys", () => {
        assert.equal(detailKeyAction({ key: "Escape", target: element("INPUT") }), "close");
        assert.equal(detailKeyAction({ key: "ArrowUp", target: element("H3") }), "previous");
        assert.equal(detailKeyAction({ key: "ArrowDown", target: element("BUTTON") }), "next");
        assert.equal(detailKeyAction({ key: "Enter", target: element("H3") }), null);
        assert.equal(detailKeyAction(null), null);
    });

    it("leaves the arrow keys to text fields, the splitter and modified keys", () => {
        const editable = { tagName: "DIV", isContentEditable: true };
        assert.equal(detailKeyAction({ key: "ArrowUp", target: element("INPUT") }), null);
        assert.equal(detailKeyAction({ key: "ArrowDown", target: element("textarea") }), null);
        assert.equal(detailKeyAction({ key: "ArrowDown", target: editable }), null);
        const splitter = element("DIV", "separator");
        assert.equal(detailKeyAction({ key: "ArrowDown", target: splitter }), null);
        assert.equal(detailKeyAction({ key: "ArrowDown", altKey: true, target: element("H3") }),
            null);
    });

    it("opens a table row with Enter or Space pressed on the row itself", () => {
        const row = {};
        assert.equal(isRowActivationKey({ key: "Enter", target: row, currentTarget: row }), true);
        assert.equal(isRowActivationKey({ key: " ", target: row, currentTarget: row }), true);
        assert.equal(isRowActivationKey({ key: "Tab", target: row, currentTarget: row }), false);
        assert.equal(isRowActivationKey({ key: "Enter", target: {}, currentTarget: row }), false);
        assert.equal(isRowActivationKey(null), false);
    });
});

describe("response detail questions", () => {
    it("reads a phase's questions as the modals did", () => {
        const questions = detailQuestions({
            descriptor: {
                questions: [
                    {
                        id:         9,
                        q_text:     "¿Avisar?",
                        ans_format: { l_pole: "No", r_pole: "Sí", values: 4, just_required: true },
                    },
                    { id: 10, text: "Otra", number: 2, range: 6, justify: false },
                ],
            },
        });

        const read = question => [question.number, question.text, question.leftPole,
            question.rightPole, question.range, question.justify];
        assert.deepEqual(questions.map(read), [
            [1, "¿Avisar?", "No", "Sí", 4, true],
            [2, "Otra", null, null, 6, false],
        ]);
        assert.deepEqual(scaleOptions(questions[0]), [1, 2, 3, 4]);
        assert.deepEqual(scaleOptions({}), []);
        assert.deepEqual(detailQuestions(null), []);
    });
});
