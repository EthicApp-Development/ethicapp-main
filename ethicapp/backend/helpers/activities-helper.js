import * as config from "../api/v2/config/config.json"; 
import * as rpg2 from "../db/rest-pg-2.js";

/**
* Retrieves the list of phases (stages) for a given session.
* Each phase includes its number, ID, and whether it is active.
* 
* @param {string} sessionId - The ID of the session.
* @returns {Array<Object>} - A list of phase objects with `number`, `id`, and `active` fields.
* @throws {Error} - Throws an error if the query or processing fails.
*/
export async function getPhasesForSession(sessionId) {
   const phaseIds = await rpg2.execSQL({
       dbcon: config.dbconnString,
       sql: `
           SELECT id
           FROM stages
           WHERE sesid = $1
           ORDER BY id ASC
       `,
       sqlParams: [rpg2.param('plain', sessionId)],
   });

   if (phaseIds.length === 0) {
       return [];
   }

   const session = await rpg2.execSQL({
        dbcon: config.dbconnString,
        sql: `
            SELECT current_stage
            FROM sessions
            WHERE id = $1
            ORDER BY id ASC
        `,
        sqlParams: [rpg2.param('plain', sessionId)],
    });

    if (session.length === 0) {
        return [];
    }

    const currentPhaseId = session[0].current_stage;

    return phaseIds.map((row, index, arr) => ({
        number: index + 1,  // Assign a sequential number to each phase
        id: row.id,         // The ID of the phase (stage)
        active: row.id === currentPhaseId,  // Indicates if the phase is active
    }));
};

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
            sqlParams: [phaseId],
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
    