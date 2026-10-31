import * as config from "../config/database.config.js";
import * as rpg2 from "../db/rest-pg-2.js";

export function generateSessionCode(id) {
    let n = id*5 + 255 + ~~(Math.random()*5);
    let s = n.toString(16);
    return "k00000".substring(0, 6 - s.length) + s;
};

/**
 * Retrieve the phase number (stage number) for a given phase ID.
 *
 * @param {number} phaseId - The ID of the phase (stage).
 * @returns {Promise<number>} - The number of the phase.
 * @throws {Error} If the phase ID is invalid or the query fails.
 */
export async function getPhaseNumberByPhaseId(phaseId) {
    try {
        const result = await rpg2.singleSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT number
                FROM stages
                WHERE id = $1
            `,
            sqlParams: [rpg2.param('plain', phaseId)],
        });

        if (!result) {
            throw new Error(`No phase found for ID: ${phaseId}`);
        }

        return result.number;
    } catch (error) {
        console.error(`Error in getPhaseNumberByPhaseId for phaseId=${phaseId}:`, error);
        throw new Error(`Unable to fetch phase number for ID: ${phaseId}`);
    }
}
