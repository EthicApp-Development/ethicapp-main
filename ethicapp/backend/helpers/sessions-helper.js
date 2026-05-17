import * as config from "../config/database.config.js";
import * as rpg2 from "../db/rest-pg-2.js";

export let getSessionIdByPhaseId = async (phaseId) => {
    try {
        const result = await rpg2.execSQL({
            sql: `
                SELECT session_id
                FROM phases
                WHERE id = $1
            `,
            dbcon: config.dbconnString,
            sqlParams: [rpg2.param('plain', phaseId)],
        });

        if (result.length === 0) {
            throw new Error(`No session found for phaseId: ${phaseId}`);
        }

        return result[0].session_id;
    } catch (err) {
        console.error("Error fetching sessionId by phaseId:", err);
        throw err;
    }
};
