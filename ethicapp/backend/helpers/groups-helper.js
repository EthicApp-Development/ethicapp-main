/**
 * The groups of a team phase, formed when the phase starts (#906), on the
 * client of the transaction that starts it.
 *
 * A grouping algorithm resolves to the groups as arrays of student ids:
 * - `random` shuffles the session's students into groups of the design's
 *   size (`stdntAmount`);
 * - `preserve` keeps the groups of the latest team phase already started.
 *
 * insertGroups then stores one team per group and gives each member a letter
 * within the group (`teamusers.anon_mask`): A, B, C...
 */

// $1 session id. The session's students, in id order, so that the shuffle
// alone decides the groups.
export const SESSION_STUDENTS_SQL = `
    SELECT DISTINCT u.id AS uid
    FROM sesusers AS su
    INNER JOIN users AS u
        ON su.uid = u.id
    WHERE su.sesid = $1
      AND u.role = 'A'
    ORDER BY u.id
`;

// $1 session id, $2 number of the session's current phase. The latest team
// phase started so far, the current one included.
export const LATEST_TEAM_PHASE_SQL = `
    SELECT id
    FROM stages
    WHERE sesid = $1
      AND number <= $2
      AND type = 'team'
    ORDER BY number DESC, id DESC
    LIMIT 1
`;

// $1 phase id. Its groups and their members, in the groups' order and, within
// each group, by letter.
export const PHASE_GROUP_MEMBERS_SQL = `
    SELECT t.id AS team_id,
           tu.uid
    FROM teams AS t
    INNER JOIN teamusers AS tu
        ON t.id = tu.tmid
    WHERE t.stageid = $1
      AND tu.uid IS NOT NULL
    ORDER BY t.id, tu.anon_mask NULLS LAST, tu.uid
`;

// $1 session id, $2 phase id.
export const INSERT_TEAM_SQL = `
    INSERT INTO teams (sesid, stageid)
    VALUES ($1, $2)
    RETURNING id
`;

// $1 team ids, $2 student ids, $3 letters: one element per member.
export const INSERT_TEAM_MEMBERS_SQL = `
    INSERT INTO teamusers (tmid, uid, anon_mask)
    SELECT member.tmid, member.uid, member.anon_mask
    FROM unnest($1::integer[], $2::integer[], $3::text[])
        AS member (tmid, uid, anon_mask)
`;

const FIRST_MASK = "A".charCodeAt(0);
const LAST_MASK = "Z".charCodeAt(0);

/** The letter of the member at `index` (0-based) within a group. */
export function memberMask(index) {
    const code = FIRST_MASK + index;
    if (code > LAST_MASK) {
        throw new Error("Exceeded allowed characters for anon_mask.");
    }
    return String.fromCharCode(code);
}

/** A shuffled copy of `items` (Fisher-Yates), drawing from `random`. */
export function shuffle(items, random = Math.random) {
    const shuffled = [...items];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

/**
 * Splits `ids`, in their order, into groups of `groupSize`. With fewer ids
 * than that, they form one group. Otherwise the ids left over after the full
 * groups join them one each, from the last id back, starting with the first
 * group.
 */
export function splitIntoGroups(ids, groupSize) {
    if (ids.length === 0) {
        return [];
    }
    if (ids.length < groupSize) {
        return [[...ids]];
    }

    const remaining = [...ids];
    const groups = [];
    const fullGroups = Math.floor(remaining.length / groupSize);
    for (let i = 0; i < fullGroups; i += 1) {
        groups.push(remaining.splice(0, groupSize));
    }
    for (let i = 0; remaining.length > 0; i += 1) {
        groups[i % groups.length].push(remaining.pop());
    }
    return groups;
}

async function createRandomGroups(client, { sessionId, groupSize, random = Math.random }) {
    const { rows } = await client.query(SESSION_STUDENTS_SQL, [sessionId]);
    if (rows.length === 0) {
        console.warn(`No students in session ${sessionId} to form groups.`);
        return [];
    }
    return splitIntoGroups(shuffle(rows.map(row => Number(row.uid)), random), groupSize);
}

async function preserveGroups(client, { sessionId, currentPhaseNumber }) {
    const { rows: phases } = await client.query(LATEST_TEAM_PHASE_SQL,
        [sessionId, currentPhaseNumber]);
    if (phases.length === 0) {
        throw new Error("No previous group phase found for preserving groups.");
    }

    const { rows } = await client.query(PHASE_GROUP_MEMBERS_SQL, [phases[0].id]);
    if (rows.length === 0) {
        console.warn(`No groups found in phase ${phases[0].id} of session ${sessionId}.`);
        return [];
    }

    const groups = new Map();
    for (const row of rows) {
        if (!groups.has(row.team_id)) {
            groups.set(row.team_id, []);
        }
        groups.get(row.team_id).push(Number(row.uid));
    }
    return [...groups.values()];
}

/**
 * The grouping algorithms a design's team phase can name
 * (`grouping_algorithm`). Each one takes the transaction's client and
 * `{ sessionId, groupSize, currentPhaseNumber, random }`.
 */
export const groupingAlgorithms = Object.freeze({
    random:   createRandomGroups,
    preserve: preserveGroups,
});

/**
 * Stores `groups` as the teams of phase `phaseId`, one statement per team and
 * one for all the members, with each member's letter.
 *
 * @param {{ query: Function }} client
 * @param {{ sessionId: number, phaseId: number, groups: number[][] }} formed
 * @returns {Promise<number[]>} The ids of the new teams, in the groups' order.
 */
export async function insertGroups(client, { sessionId, phaseId, groups }) {
    const teamIds = [];
    const members = { tmid: [], uid: [], mask: [] };

    for (const group of groups) {
        const { rows } = await client.query(INSERT_TEAM_SQL, [sessionId, phaseId]);
        const teamId = Number(rows[0].id);
        teamIds.push(teamId);
        group.forEach((uid, index) => {
            members.tmid.push(teamId);
            members.uid.push(uid);
            members.mask.push(memberMask(index));
        });
    }

    if (members.uid.length > 0) {
        await client.query(INSERT_TEAM_MEMBERS_SQL, [members.tmid, members.uid, members.mask]);
    }
    return teamIds;
}
