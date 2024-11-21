import * as config from "../config/config.js"; 
import * as rpg2 from "../db/rest-pg-2.js";

export const groupingAlgorithms = { 
    random : createRandomGroups,
    preserve: preserveGroups
};

// Create random groups for the active phase
async function createRandomGroups(sessionId, phases, groupSize) {
    // Find the active phase
    const activePhase = phases.find(phase => phase.active);
    if (!activePhase) {
        throw new Error("No active phase found for this session.");
    }

    // Fetch all users in the session
    const students = await rpg2.execSQL({
        dbcon: config.dbconnString,
        sql: `
            SELECT u.id AS uid
            FROM sesusers su
            INNER JOIN users u ON su.uid = u.id
            WHERE su.sesid = $1 AND u.role = 'A'
        `,
        sqlParams: [sessionId],
    });

    if (students.length === 0) {
        throw new Error("No students available in the session to form groups.");
    }

    // Shuffle students randomly
    const shuffledStudents = students.sort(() => Math.random() - 0.5);

    // Calculate the number of full groups and remaining students
    const fullGroups = Math.floor(shuffledStudents.length / groupSize);
    const remainder = shuffledStudents.length % groupSize;

    const groups = [];

    // Create full groups
    for (let i = 0; i < fullGroups; i++) {
        groups.push(shuffledStudents.splice(0, groupSize));
    }

    // Distribute remaining students across existing groups
    if (remainder > 0) {
        for (let i = 0; i < remainder; i++) {
            groups[i % groups.length].push(shuffledStudents.pop());
        }
    }

    return groups;
}

// Preserve groups from a previous group phase
async function preserveGroups(sessionId, phases, groupSize) {
    // Find the active phase
    const activePhase = phases.find(phase => phase.active);
    if (!activePhase) {
        throw new Error("No active phase found for this session.");
    }

    // Identify the previous group phase
    const previousPhase = phases
        .slice(0, phases.findIndex(p => p.id === activePhase.id))
        .reverse()
        .find(p => p.mode === "team");

    if (!previousPhase) {
        throw new Error("No previous group phase found for preserving groups.");
    }

    // Fetch groups from the previous phase
    const previousGroups = await rpg2.execSQL({
        dbcon: config.dbconnString,
        sql: `
            SELECT t.id AS team_id, tu.uid AS user_id
            FROM teams t
            INNER JOIN teamusers tu ON t.id = tu.tmid
            WHERE t.sesid = $1 AND t.stageid = $2
        `,
        sqlParams: [sessionId, previousPhase.id],
    });

    if (previousGroups.length === 0) {
        throw new Error("No groups found in the previous phase.");
    }

    // Organize users into their respective teams
    const groupedUsers = {};
    previousGroups.forEach(row => {
        if (!groupedUsers[row.team_id]) {
            groupedUsers[row.team_id] = [];
        }
        groupedUsers[row.team_id].push(row.user_id);
    });

    return Object.values(groupedUsers);
}

/**
 * Deletes all existing groups and their members for a given phase.
 * 
 * @param {string} phaseId - The ID of the phase for which to delete groups.
 * @throws {Error} Throws an error if the operation fails.
 */
async function deleteGroupsForPhase(phaseId) {
    if (!phaseId) {
        throw new Error("Missing required parameter: phaseId.");
    }

    const dbcon = config.dbconnString;

    // Delete team users linked to the phase
    await rpg2.execSQL({
        dbcon,
        sql: `
            DELETE FROM teamusers AS tu
            USING teams AS t
            WHERE tu.tmid = t.id AND t.stageid = $1
        `,
        sqlParams: [phaseId],
    });

    // Delete teams linked to the phase
    await rpg2.execSQL({
        dbcon,
        sql: `
            DELETE FROM teams
            WHERE stageid = $1
        `,
        sqlParams: [phaseId],
    });
}