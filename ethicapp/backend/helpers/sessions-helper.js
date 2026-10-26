import * as config from "../config/database.config.js";
import * as rpg2 from "../db/rest-pg-2.js";

export let getSessionIdByPhaseId = async (phaseId) => {
    try {
        const result = await rpg2.execSQL({
            sql: `
                SELECT sesid
                FROM stages
                WHERE id = $1
            `,
            dbcon: config.dbconnString,
            sqlParams: [rpg2.param('plain', phaseId)],
        });

        if (result.length === 0) {
            throw new Error(`No session found for phaseId: ${phaseId}`);
        }

        return result[0].sesid;
    } catch (err) {
        console.error("Error fetching sessionId by phaseId:", err);
        throw err;
    }
};

export async function getCaseIdBySessionId(sessionId) {
    const parsedSessionId = Number(sessionId);

    if (!Number.isSafeInteger(parsedSessionId) || parsedSessionId <= 0) {
        throw new Error("sessionId must be a positive integer.");
    }

    try {
        const result = await rpg2.singleSQL({
            sql: `
                SELECT d.case_id
                FROM activity a
                INNER JOIN designs d
                    ON d.id = a.design
                WHERE a.session = $1
                  AND d.case_id IS NOT NULL
                LIMIT 1;
            `,
            dbcon: config.dbconnString,
            sqlParams: [rpg2.param("plain", parsedSessionId)],
        });

        return result?.case_id ? Number(result.case_id) : null;
    } catch (err) {
        console.error("Error fetching caseId by sessionId:", err);
        throw err;
    }
}
