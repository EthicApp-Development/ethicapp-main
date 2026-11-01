// The assignment of the students' pseudonym numbers (#897), with a fake
// database that keeps the rows of one session in memory and applies the two
// unique keys of activity_participant_pseudonyms (V34) the way
// ON CONFLICT DO NOTHING does. The real statements, constraints and
// concurrent requests are covered by
// participant-pseudonyms.integration-test.mjs.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    INSERT_PSEUDONYM_SQL,
    SESSION_PSEUDONYMS_SQL,
    createPseudonymAssigner,
    drawPseudonymNumbers,
    pseudonymRangeEnd,
} from "../participant-pseudonyms-helper.js";

const SESSION_ID = 10;

/**
 * One session's students (in join order) and numbers. `beforeInsert` runs
 * before each insert, as another tab's write would.
 */
function fakeDatabase({ students = [], numbers = [], beforeInsert = () => {} } = {}) {
    const numberByUser = new Map(numbers);
    const statements = [];

    async function query(sql, params) {
        statements.push(sql);
        assert.equal(params[0], SESSION_ID);

        if (sql === SESSION_PSEUDONYMS_SQL) {
            const rows = students.map((userId) => ({
                user_id:     userId,
                number:      numberByUser.get(userId) ?? null,
                participant: true,
            }));
            for (const [userId, number] of numberByUser) {
                if (!students.includes(userId)) {
                    rows.push({ user_id: userId, number, participant: false });
                }
            }
            return rows;
        }
        if (sql === INSERT_PSEUDONYM_SQL) {
            beforeInsert(numberByUser);
            const [, userId, number] = params;
            if (numberByUser.has(userId) || [...numberByUser.values()].includes(number)) {
                return [];
            }
            numberByUser.set(userId, number);
            return [{ user_id: userId }];
        }
        throw new Error(`Unexpected statement: ${sql}`);
    }

    return { query, statements, students, numberByUser };
}

// Always the first free number left: draws 1, 2, 3... while they are free.
const firstFree = () => 0;

function assertValidAssignment(result, students, rangeEnd) {
    assert.deepEqual(result.map((entry) => entry.userId).sort((a, b) => a - b),
        [...students].sort((a, b) => a - b));
    const numbers = result.map((entry) => entry.number);
    assert.equal(new Set(numbers).size, numbers.length, "numbers are unique");
    for (const number of numbers) {
        assert.ok(Number.isInteger(number) && number >= 1 && number <= rangeEnd, `${number}`);
    }
    assert.deepEqual(numbers, [...numbers].sort((a, b) => a - b), "ordered by number");
}

describe("pseudonymRangeEnd", () => {
    it("draws from 1-99 up to 50 numbers, then from 1-999, then from 1-9999", () => {
        assert.equal(pseudonymRangeEnd(0), 99);
        assert.equal(pseudonymRangeEnd(1), 99);
        assert.equal(pseudonymRangeEnd(50), 99);
        assert.equal(pseudonymRangeEnd(51), 999);
        assert.equal(pseudonymRangeEnd(500), 999);
        assert.equal(pseudonymRangeEnd(501), 9999);
    });
});

describe("drawPseudonymNumbers", () => {
    it("draws distinct numbers that are not taken", () => {
        const taken = new Set([1, 2, 3, 50]);
        const numbers = drawPseudonymNumbers({
            taken,
            count:     40,
            rangeEnd:  99,
            randomInt: firstFree,
        });

        assert.equal(numbers.length, 40);
        assert.equal(new Set(numbers).size, 40);
        assert.ok(numbers.every((number) => !taken.has(number) && number >= 1 && number <= 99));
    });

    it("draws as a partial Fisher-Yates shuffle of the free numbers", () => {
        // Swapping the last free number into each position in turn.
        const last = (max) => max - 1;
        assert.deepEqual(
            drawPseudonymNumbers({ taken: new Set([99]), count: 3, rangeEnd: 99, randomInt: last }),
            [98, 1, 2]
        );
        assert.deepEqual(
            drawPseudonymNumbers({
                taken:     new Set([1]),
                count:     3,
                rangeEnd:  99,
                randomInt: firstFree,
            }),
            [2, 3, 4]
        );
    });

    it("refuses to draw more numbers than are free", () => {
        assert.throws(
            () => drawPseudonymNumbers({
                taken:     new Set([1]),
                count:     2,
                rangeEnd:  2,
                randomInt: firstFree,
            }),
            RangeError
        );
    });
});

describe("createPseudonymAssigner", () => {
    it("gives every student a unique number within 1-99, ordered by number", async () => {
        const db = fakeDatabase({ students: [3, 1, 2, 7, 5] });
        const { assignParticipantPseudonyms } = createPseudonymAssigner({ query: db.query });

        const result = await assignParticipantPseudonyms(SESSION_ID);

        assertValidAssignment(result, db.students, 99);
        assert.equal(db.statements.filter((sql) => sql === INSERT_PSEUDONYM_SQL).length, 5,
            "one insert per student");
    });

    it("draws from 1-999 once more than 50 students hold a number", async () => {
        const students = Array.from({ length: 51 }, (_, index) => 100 + index);
        const db = fakeDatabase({ students });
        // The first draw takes the last number of the range.
        const result = await createPseudonymAssigner({
            query:     db.query,
            randomInt: (max) => max - 1,
        }).assignParticipantPseudonyms(SESSION_ID);

        assertValidAssignment(result, students, 999);
        assert.equal(result.at(-1).number, 999);
    });

    it("keeps the numbers held below 100 when the range grows for a late joiner", async () => {
        const students = Array.from({ length: 50 }, (_, index) => 100 + index);
        const numbers = students.map((userId, index) => [userId, index + 1]);
        const db = fakeDatabase({ students: [...students, 500], numbers });

        const result = await createPseudonymAssigner({
            query:     db.query,
            randomInt: (max) => max - 1,
        }).assignParticipantPseudonyms(SESSION_ID);

        assertValidAssignment(result, db.students, 999);
        for (const [userId, number] of numbers) {
            assert.equal(result.find((entry) => entry.userId === userId).number, number);
        }
        assert.equal(result.find((entry) => entry.userId === 500).number, 999);
    });

    it("gives a late joiner a new number and changes nobody else's", async () => {
        const db = fakeDatabase({ students: [1, 2, 3, 4, 5] });
        const assigner = createPseudonymAssigner({ query: db.query });

        const before = await assigner.assignParticipantPseudonyms(SESSION_ID);
        db.students.push(6);
        const after = await assigner.assignParticipantPseudonyms(SESSION_ID);

        assertValidAssignment(after, db.students, 99);
        for (const { userId, number } of before) {
            assert.equal(after.find((entry) => entry.userId === userId).number, number);
        }
        const late = after.find((entry) => entry.userId === 6).number;
        assert.ok(!before.some((entry) => entry.number === late));
    });

    it("writes nothing when every student already has a number", async () => {
        const db = fakeDatabase({ students: [1, 2], numbers: [[1, 40], [2, 7]] });

        const result = await createPseudonymAssigner({ query: db.query })
            .assignParticipantPseudonyms(SESSION_ID);

        assert.deepEqual(result, [{ userId: 2, number: 7 }, { userId: 1, number: 40 }]);
        assert.deepEqual(db.statements, [SESSION_PSEUDONYMS_SQL]);
    });

    it("never reuses a number held by an account that is no longer a student", async () => {
        const db = fakeDatabase({ students: [1, 2, 3], numbers: [[9, 2]] });

        const result = await createPseudonymAssigner({ query: db.query, randomInt: firstFree })
            .assignParticipantPseudonyms(SESSION_ID);

        assert.deepEqual(result, [
            { userId: 1, number: 1 },
            { userId: 2, number: 3 },
            { userId: 3, number: 4 },
        ]);
    });

    it("draws again after a collision with another tab's numbers", async () => {
        // The draw is 1 for student 1 and 2 for student 2. Before the first
        // insert, another tab gives student 2 the number 1: both inserts
        // collide, and the next round gives student 1 the number 2.
        let otherTabWrote = false;
        const db = fakeDatabase({
            students:     [1, 2],
            beforeInsert: (numberByUser) => {
                if (!otherTabWrote) {
                    otherTabWrote = true;
                    numberByUser.set(2, 1);
                }
            },
        });

        const result = await createPseudonymAssigner({ query: db.query, randomInt: firstFree })
            .assignParticipantPseudonyms(SESSION_ID);

        assert.deepEqual(result, [{ userId: 2, number: 1 }, { userId: 1, number: 2 }]);
        assert.deepEqual(db.statements, [
            SESSION_PSEUDONYMS_SQL,
            INSERT_PSEUDONYM_SQL,
            INSERT_PSEUDONYM_SQL,
            SESSION_PSEUDONYMS_SQL,
            INSERT_PSEUDONYM_SQL,
            SESSION_PSEUDONYMS_SQL,
        ]);
    });

    it("gives up after ten rounds without a number", async () => {
        const statements = [];
        const query = async (sql) => {
            statements.push(sql);
            return sql === SESSION_PSEUDONYMS_SQL
                ? [{ user_id: 1, number: null, participant: true }]
                : [];
        };

        await assert.rejects(
            createPseudonymAssigner({ query }).assignParticipantPseudonyms(SESSION_ID),
            /Could not assign pseudonym numbers in session 10/u
        );
        assert.equal(statements.filter((sql) => sql === SESSION_PSEUDONYMS_SQL).length, 11);
    });

    it("draws numbers that follow neither the join order nor a sequence", async () => {
        // With crypto.randomInt, the first of three students to join gets the
        // smallest number about a third of the time. The bounds fail with a
        // probability far below 1e-9.
        const runs = 300;
        let firstJoinerSmallest = 0;
        let consecutive = 0;
        for (let run = 0; run < runs; run += 1) {
            const db = fakeDatabase({ students: [1, 2, 3] });
            const result = await createPseudonymAssigner({ query: db.query })
                .assignParticipantPseudonyms(SESSION_ID);

            assertValidAssignment(result, [1, 2, 3], 99);
            if (result[0].userId === 1) {
                firstJoinerSmallest += 1;
            }
            const numbers = result.map((entry) => entry.number);
            if (numbers[1] === numbers[0] + 1 && numbers[2] === numbers[1] + 1) {
                consecutive += 1;
            }
        }

        assert.ok(firstJoinerSmallest > 40 && firstJoinerSmallest < 170, `${firstJoinerSmallest}`);
        assert.ok(consecutive < 10, `${consecutive} runs drew consecutive numbers`);
    });
});
