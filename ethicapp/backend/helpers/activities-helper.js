import config from "../config/config.js"; 
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
   const results = await rpg2.execSQL({
       dbcon: config.dbconnString,
       sql: `
           SELECT id
           FROM stages
           WHERE sesid = $1
           ORDER BY id ASC
       `,
       sqlParams: [sessionId],
   });

   if (results.length === 0) {
       return [];
   }

   return results.map((row, index, arr) => ({
       number: index + 1,  // Assign a sequential number to each phase
       id: row.id,         // The ID of the phase (stage)
   }));
}
