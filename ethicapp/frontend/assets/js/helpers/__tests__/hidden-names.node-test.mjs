// Hiding students' names on the activity dashboard (#897, epic #892): the
// display rule (group letters in a group phase, numbers otherwise and in the
// Participants tab), the order by pseudonym, and the labels in both locales.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
    HIDDEN_NAME_KEYS,
    comparePseudonyms,
    formatPseudonymNumber,
    hiddenChatAuthorName,
    hiddenNamePhase,
    hiddenNameRows,
    hiddenNameUsers,
    participantId,
    participantPseudonym,
    pseudonymLabel,
    pseudonymNumberMap,
} from "../hidden-names.js";
import { filterRowsByParticipant, participantMatchCount } from "../activity-dashboard.js";

const locale = name => JSON.parse(readFileSync(
    new URL(`../../../locales/${name}.json`, import.meta.url), "utf8"));

// A `translate(key, params)` over a real catalog, as $translate.instant does.
function translator(name) {
    const catalog = locale(name);
    return (key, params = {}) => String(catalog[key] ?? key)
        .replace(/\{\{\s*(\w+)\s*\}\}/gu, (_, param) => params[param] ?? "");
}

const es = translator("es_CL");
const en = translator("en_US");

// Ana 1 → 37, Beto 2 → 4, Carla 3 → 12, Diego 4 → 81, Elena 5 → none yet.
const NUMBERS = pseudonymNumberMap([
    { userId: 1, number: 37 },
    { userId: 2, number: 4 },
    { userId: 3, number: 12 },
    { userId: 4, number: 81 },
]);
const REAL_NAMES = ["Ana", "Beto", "Carla", "Diego", "Elena"];

function assertNoRealName(value) {
    const text = JSON.stringify(value);
    for (const name of REAL_NAMES) {
        assert.equal(text.includes(name), false, `"${name}" is not shown`);
    }
}

const INDIVIDUAL_ROWS = [
    { userId: 1, userName: "Ana", r1: 2 },
    { userId: 2, userName: "Beto", r1: 3 },
    { userId: 3, userName: "Carla", r1: null },
    { userId: 5, userName: "Elena", r1: 1 },
];

// Two groups whose members' letters do not follow their names, and a
// student without a group, as the joiners build a group phase's table.
function groupRows() {
    return [
        { userId: 1, userName: "Ana", groupId: 7, groupNumber: 1, groupLetter: "C", r1: 2 },
        { userId: 2, userName: "Beto", groupId: 7, groupNumber: 1, groupLetter: "A", r1: 3 },
        { userId: 3, userName: "Carla", groupId: 7, groupNumber: 1, groupLetter: "B", r1: 1 },
        { groupStatistics: true, groupId: 7, groupNumber: 1, groupName: "Grupo 1" },
        { userId: 4, userName: "Diego", groupId: 8, groupNumber: 2, groupLetter: "B", r1: 4 },
        { userId: 5, userName: "Elena", groupId: 8, groupNumber: 2, groupLetter: "A", r1: null },
        { groupStatistics: true, groupId: 8, groupNumber: 2, groupName: "Grupo 2" },
        { userId: 6, userName: "Fran", groupId: null, groupNumber: null, groupLetter: null, r1: 2 },
    ];
}

describe("hidden names: the display rule", () => {
    it("reads the numbers the server returns, leaving out invalid entries", () => {
        const numbers = pseudonymNumberMap([
            { userId: 1, number: 37 },
            { userId: "2", number: "4" },
            { userId: 3, number: 0 },
            { userId: null, number: 9 },
            null,
        ]);
        assert.deepEqual([...numbers], [[1, 37], [2, 4]]);
        assert.equal(pseudonymNumberMap(undefined).size, 0);
    });

    it("gives a student of a group phase their group letter, anonymous or not", () => {
        const row = { userId: 1, groupId: 7, groupNumber: 1, groupLetter: "B" };
        assert.deepEqual(participantPseudonym(row, { groupPhase: true, numbers: NUMBERS }),
            { kind: "letter", letter: "B" });
    });

    it("gives a student without a group in a group phase their number", () => {
        const row = { userId: 1, groupId: null, groupNumber: null, groupLetter: null };
        assert.deepEqual(participantPseudonym(row, { groupPhase: true, numbers: NUMBERS }),
            { kind: "number", number: 37 });
        assert.deepEqual(participantPseudonym({ userId: 1, groupId: 7, groupLetter: "" },
            { groupPhase: true, numbers: NUMBERS }), { kind: "number", number: 37 },
        "a member without a letter");
    });

    it("gives a student of a phase without groups their number, never a letter", () => {
        const row = { userId: 2, groupId: 7, groupNumber: 1, groupLetter: "A" };
        assert.deepEqual(participantPseudonym(row, { groupPhase: false, numbers: NUMBERS }),
            { kind: "number", number: 4 });
        assert.deepEqual(participantPseudonym({ uid: 3 }, { numbers: NUMBERS }),
            { kind: "number", number: 12 }, "a ranking row");
        assert.equal(participantId({ uid: 3 }), 3);
    });

    it("waits for a number it does not know yet", () => {
        assert.deepEqual(participantPseudonym({ userId: 5 }, { numbers: NUMBERS }),
            { kind: "pending" });
        assert.deepEqual(participantPseudonym({ userId: 5 }), { kind: "pending" });
    });

    it("writes the pseudonyms in both locales, numbers with two digits at least", () => {
        assert.equal(formatPseudonymNumber(4), "04");
        assert.equal(formatPseudonymNumber(37), "37");
        assert.equal(formatPseudonymNumber(123), "123");

        assert.equal(pseudonymLabel({ kind: "letter", letter: "B" }, es), "Integrante B");
        assert.equal(pseudonymLabel({ kind: "number", number: 4 }, es), "Participante 04");
        assert.equal(pseudonymLabel({ kind: "pending" }, es), "Participante …");
        assert.equal(pseudonymLabel({ kind: "letter", letter: "B" }, en), "Member B");
        assert.equal(pseudonymLabel({ kind: "number", number: 37 }, en), "Participant 37");
        assert.equal(pseudonymLabel(null, en), "Participant …");

        for (const name of ["es_CL", "en_US"]) {
            for (const key of Object.values(HIDDEN_NAME_KEYS)) {
                assert.equal(typeof locale(name)[key], "string", `${name} has ${key}`);
            }
        }
    });

    it("orders letters, then numbers, then the pending ones", () => {
        const pseudonyms = [
            { kind: "pending" },
            { kind: "number", number: 12 },
            { kind: "letter", letter: "AA" },
            { kind: "number", number: 4 },
            { kind: "letter", letter: "B" },
            { kind: "letter", letter: "A" },
        ];
        assert.deepEqual([...pseudonyms].sort(comparePseudonyms), [
            { kind: "letter", letter: "A" },
            { kind: "letter", letter: "B" },
            { kind: "letter", letter: "AA" },
            { kind: "number", number: 4 },
            { kind: "number", number: 12 },
            { kind: "pending" },
        ]);
    });
});

describe("hidden names: a response table's rows", () => {
    it("names a phase without groups by number and orders it by number", () => {
        const rows = hiddenNameRows(INDIVIDUAL_ROWS, { numbers: NUMBERS, translate: es });
        assert.deepEqual(rows.map(row => [row.userId, row.userName]), [
            [2, "Participante 04"],
            [3, "Participante 12"],
            [1, "Participante 37"],
            [5, "Participante …"],
        ]);
        assertNoRealName(rows);
        assert.equal(INDIVIDUAL_ROWS[0].userName, "Ana", "the live table keeps its names");
        assert.equal(rows[2].r1, 2, "the answers stay with their student");
    });

    it("names a group phase by letter, ordered by letter within each group", () => {
        const source = groupRows();
        const rows = hiddenNameRows(source, { groupPhase: true, numbers: NUMBERS, translate: es });
        assert.deepEqual(rows.map(row => row.userName ?? row.groupName), [
            "Integrante A", "Integrante B", "Integrante C", "Grupo 1",
            "Integrante A", "Integrante B", "Grupo 2",
            "Participante …",
        ]);
        assert.deepEqual(rows.map(row => row.userId ?? `g${row.groupId}`),
            [2, 3, 1, "g7", 5, 4, "g8", 6]);
        assert.equal(rows[3], source[3], "a group's summary row is the table's own");
        assertNoRealName(rows);
    });

    it("never shows a number next to letters for a grouped student", () => {
        const rows = hiddenNameRows(groupRows(),
            { groupPhase: true, numbers: NUMBERS, translate: en });
        const grouped = rows.filter(row => !row.groupStatistics && row.groupId !== null);
        assert.ok(grouped.every(row => /^Member [A-Z]+$/u.test(row.userName)));
    });

    it("gives a student without a group in a group phase their number", () => {
        const numbers = pseudonymNumberMap([{ userId: 6, number: 23 }]);
        const rows = hiddenNameRows(groupRows(), { groupPhase: true, numbers, translate: en });
        assert.equal(rows.at(-1).userName, "Participant 23");
    });

    it("keeps a ranking table's clusters and orders each by number", () => {
        const source = [
            { uid: 1, userName: "Ana", responseCluster: 1 },
            { uid: 3, userName: "Carla", responseCluster: 1 },
            { uid: 2, userName: "Beto", responseCluster: 1 },
            { uid: 4, userName: "Diego", responseCluster: 2 },
            { uid: 5, userName: "Elena", responseCluster: 2 },
        ];
        const rows = hiddenNameRows(source, { numbers: NUMBERS, translate: en });
        assert.deepEqual(rows.map(row => [row.responseCluster, row.uid]),
            [[1, 2], [1, 3], [1, 1], [2, 4], [2, 5]]);
        assertNoRealName(rows);
    });

    it("lets the participant search match the pseudonym, never the name", () => {
        const rows = hiddenNameRows(groupRows(),
            { groupPhase: true, numbers: NUMBERS, translate: es });
        assert.deepEqual(filterRowsByParticipant(rows, "ana"), []);
        assert.deepEqual(filterRowsByParticipant(rows, "integrante b")
            .map(row => row.userId ?? "g"), [3, "g", 4, "g"]);

        const individual = hiddenNamePhase(
            { descriptor: { mode: "individual" }, state: INDIVIDUAL_ROWS },
            { numbers: NUMBERS, translate: es });
        assert.equal(participantMatchCount(individual, "37"), 1);
        assert.equal(participantMatchCount(individual, "beto"), 0);
    });

    it("works out a phase's rows from its mode, as a copy", () => {
        const phase = { descriptor: { id: 41, mode: "team" }, state: groupRows(), stats: {} };
        const hidden = hiddenNamePhase(phase, { numbers: NUMBERS, translate: en });
        assert.notEqual(hidden, phase);
        assert.equal(hidden.descriptor, phase.descriptor);
        assert.equal(hidden.state[0].userName, "Member A");
        assert.equal(phase.state[0].userName, "Ana");

        const individual = hiddenNamePhase({ ...phase, descriptor: { id: 40, mode: "individual" } },
            { numbers: NUMBERS, translate: en });
        assert.ok(individual.state.filter(row => !row.groupStatistics)
            .every(row => /^Participant /u.test(row.userName)), "no letters without groups");
        assert.equal(hiddenNamePhase(null), null);
    });
});

describe("hidden names: the Participants tab", () => {
    const USERS = [
        { id: 1, name: "Ana", mail: "ana@example.org", role: "A", device: "Chrome" },
        { id: 9, name: "Prof. Rojas", mail: "rojas@example.org", role: "P" },
        { id: 2, name: "Beto", mail: "beto@example.org", role: "A" },
        { id: 5, name: "Elena", mail: "elena@example.org" },
    ];

    it("names the students by number, without email, ordered by number", () => {
        const users = hiddenNameUsers(USERS, { numbers: NUMBERS, translate: es });
        assert.deepEqual(users.map(user => [user.id, user.name, user.mail, user.hiddenOrder]), [
            [9, "Prof. Rojas", "rojas@example.org", 0],
            [2, "Participante 04", null, 1],
            [1, "Participante 37", null, 2],
            [5, "Participante …", null, 3],
        ]);
        assert.equal(users[2].device, "Chrome");
        assertNoRealName(users);
        assert.equal(USERS[0].name, "Ana");
        assert.deepEqual(hiddenNameUsers(null, { translate: es }), []);
    });
});

describe("hidden names: the group chat's authors", () => {
    const options = {
        memberLabels: { 1: "Integrante C", 2: "Integrante A" },
        teacherLabel: "Docente",
        translate:    es,
    };
    const teacher = { uid: 50, authorRole: "P", authorName: "Prof. Rojas" };
    const agent = { uid: 1, authorRole: "external_service", authorName: "Agente de discusión" };

    it("keeps the teacher's and the AI agents' labels", () => {
        assert.equal(hiddenChatAuthorName(teacher, options), "Docente");
        assert.equal(hiddenChatAuthorName(agent, options), "Agente de discusión");
    });

    it("names the students by pseudonym, never by the name the message carries", () => {
        assert.equal(hiddenChatAuthorName({ uid: 1, authorRole: "A", authorName: "Ana" }, options),
            "Integrante C");
        assert.equal(hiddenChatAuthorName({ uid: 77, authorRole: "A", authorName: "Zoe" }, options),
            "Participante …");
        assert.equal(hiddenChatAuthorName({ uid: null, authorName: "Zoe" }, options),
            "Participante …");
    });
});
