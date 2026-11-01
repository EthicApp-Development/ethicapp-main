/**
 * Pseudonym numbers of an activity's students (#897), which the teacher's
 * dashboard shows in place of their names while the teacher hides them
 * ("Participante 37"). Table: activity_participant_pseudonyms (V34).
 *
 * - Every student (role A) who joined the session gets one number, stable
 *   for the whole activity and unique within it. The teacher gets none.
 * - A number is assigned the first time the owner's dashboard asks for the
 *   numbers. It is drawn at random among the free numbers of a range wider
 *   than the class: 1-99 while at most 50 students hold one, then 1-999, and
 *   so on, so that the numbers held never fill more than half of the range.
 *   Numbers are therefore not consecutive and follow neither the class list
 *   nor the join order.
 * - A student who joins late gets a new number when the numbers are read
 *   again; nobody else's changes.
 *
 * Concurrent assignments (two dashboard tabs) need no lock. Each number is
 * inserted by its own statement with ON CONFLICT DO NOTHING, outside any
 * transaction: the primary key keeps one number per student and the unique
 * key one student per number. A statement that loses a collision inserts
 * nothing, and the assignment reads the session again and draws a new number
 * among the ones still free. A statement holds at most one row's keys, so
 * two assignments can wait for each other's row but never deadlock, which a
 * multi-row insert in another order could.
 */
import { randomInt as cryptoRandomInt } from "node:crypto";
import * as config from "../config/database.config.js";
import * as rpg2 from "../db/rest-pg-2.js";

// The numbers held never fill more than half of the range: 1-99 for up to
// 50 numbers, 1-999 for up to 500, and so on.
const FIRST_RANGE_END = 99;

// Rounds of reading and inserting before an assignment gives up. Each round
// assigns at least one number across all concurrent assignments, so a round
// is only lost to another tab that assigned the same students.
const MAX_ROUNDS = 10;

// $1 session id. One row per student who joined the session, with their
// number or null (participant true), and one per number held by an account
// that is not one of them (participant false), which stays taken.
export const SESSION_PSEUDONYMS_SQL = `
    SELECT COALESCE(student.user_id, pseudonym.user_id) AS user_id,
           pseudonym.number,
           student.user_id IS NOT NULL AS participant
    FROM (
        SELECT su.uid AS user_id
        FROM sesusers AS su
        INNER JOIN users AS u
            ON u.id = su.uid
        WHERE su.sesid = $1
          AND u.role = 'A'
    ) AS student
    FULL JOIN (
        SELECT user_id, number
        FROM activity_participant_pseudonyms
        WHERE session_id = $1
    ) AS pseudonym
        ON pseudonym.user_id = student.user_id
`;

// $1 session id, $2 user id, $3 number. A row back when the number was
// assigned; none when the student already has one or the number is taken.
export const INSERT_PSEUDONYM_SQL = `
    INSERT INTO activity_participant_pseudonyms (session_id, user_id, number)
    VALUES ($1, $2, $3)
    ON CONFLICT DO NOTHING
    RETURNING user_id
`;

/**
 * The last number of the range from which numbers are drawn when `count`
 * students hold one: 99 up to 50, 999 up to 500, 9999 up to 5000.
 *
 * @param {number} count
 * @returns {number}
 */
export function pseudonymRangeEnd(count) {
    let end = FIRST_RANGE_END;
    while (count * 2 > end + 1) {
        end = end * 10 + 9;
    }
    return end;
}

/**
 * `count` distinct numbers drawn uniformly at random from 1..`rangeEnd`,
 * leaving out the `taken` ones.
 *
 * @param {Object} options
 * @param {Set<number>} options.taken
 * @param {number} options.count
 * @param {number} options.rangeEnd
 * @param {(max: number) => number} options.randomInt An integer in [0, max).
 * @returns {number[]}
 */
export function drawPseudonymNumbers({ taken, count, rangeEnd, randomInt }) {
    const free = [];
    for (let number = 1; number <= rangeEnd; number += 1) {
        if (!taken.has(number)) {
            free.push(number);
        }
    }
    if (count > free.length) {
        throw new RangeError(`Cannot draw ${count} numbers from ${free.length} free ones.`);
    }

    // The first `count` steps of a Fisher-Yates shuffle.
    for (let i = 0; i < count; i += 1) {
        const j = i + randomInt(free.length - i);
        [free[i], free[j]] = [free[j], free[i]];
    }
    return free.slice(0, count);
}

async function defaultQuery(sql, params) {
    const db = await rpg2.getDBInstance(config.dbconnString);
    return (await db.query(sql, params)).rows;
}

/**
 * @param {Object} [dependencies]
 * @param {(sql: string, params: Array) => Promise<Object[]>} [dependencies.query]
 *        Runs one statement on its own and resolves to its rows.
 * @param {(max: number) => number} [dependencies.randomInt] An integer in
 *        [0, max); crypto.randomInt by default.
 */
export function createPseudonymAssigner({
    query = defaultQuery,
    randomInt = cryptoRandomInt,
} = {}) {
    /**
     * The numbers of the session's students, assigning the missing ones.
     *
     * @param {number} sessionId An existing session, whose owner asks.
     * @returns {Promise<Array<{ userId: number, number: number }>>} Ordered
     *          by number.
     */
    async function assignParticipantPseudonyms(sessionId) {
        for (let round = 0; round <= MAX_ROUNDS; round += 1) {
            const rows = await query(SESSION_PSEUDONYMS_SQL, [sessionId]);
            const students = rows.filter((row) => row.participant);
            const missing = students
                .filter((row) => row.number === null)
                .map((row) => Number(row.user_id))
                .sort((a, b) => a - b);

            if (missing.length === 0) {
                return students
                    .map((row) => ({ userId: Number(row.user_id), number: Number(row.number) }))
                    .sort((a, b) => a.number - b.number);
            }
            if (round === MAX_ROUNDS) {
                break;
            }

            const taken = new Set(rows
                .filter((row) => row.number !== null)
                .map((row) => Number(row.number)));
            const numbers = drawPseudonymNumbers({
                taken,
                count:    missing.length,
                rangeEnd: pseudonymRangeEnd(taken.size + missing.length),
                randomInt,
            });

            // One statement per number (see the module's comment). A number
            // that collides is drawn again in the next round.
            for (const [index, userId] of missing.entries()) {
                await query(INSERT_PSEUDONYM_SQL, [sessionId, userId, numbers[index]]);
            }
        }

        throw new Error(`Could not assign pseudonym numbers in session ${sessionId}.`);
    }

    return { assignParticipantPseudonyms };
}

const defaultPseudonymAssigner = createPseudonymAssigner();

export default defaultPseudonymAssigner;
