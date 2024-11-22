import * as config from "../config/config.js"; 
import * as rpg2 from "../db/rest-pg-2.js";

/**
 * Fetches a design from the "designs" table by its ID.
 * @param {number} id - The ID of the design to fetch.
 * @returns {Promise<Object>} - A promise that resolves to the design object or null if not found.
 * @throws {Error} If there is an issue with the database query.
 */
export async function getDesignById(id) {
    try {
        // Execute the SQL query to fetch the design
        const result = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT id, design, creator, public, locked, case_id
                FROM designs
                WHERE id = $1
            `,
            sqlParams: [id],
        });

        // If no design is found, return null
        if (result.length === 0) {
            return null;
        }

        // Return the design (first row) as an object
        return result[0];
    } catch (error) {
        // Log and rethrow the error for handling by the caller
        console.error("Error fetching design by ID:", error);
        throw new Error("Unable to fetch design.");
    }
}

/**
 * Fetches the design type for a given stage (phase) ID.
 *
 * @param {number} phaseId - The ID of the phase (stage).
 * @returns {Promise<string>} - The design type (e.g., "semantic_differential", "ranking").
 * @throws {Error} If there is an issue with the database query or the design is not found.
 */
export async function getDesignTypeByPhaseId(phaseId) {
    try {
        // Step 1: Fetch the session ID (sesid) from the stage
        const sessionResult = await rpg2.singleSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT sesid
                FROM stages
                WHERE id = $1
            `,
            sqlParams: [phaseId],
        });

        if (!sessionResult) {
            throw new Error(`No session ID found for phase (stage) ID: ${phaseId}`);
        }

        const sessionId = sessionResult.sesid;

        // Step 2: Fetch the activity associated with the session
        const activityResult = await rpg2.singleSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT design
                FROM activity
                WHERE session = $1
            `,
            sqlParams: [sessionId],
        });

        if (!activityResult) {
            throw new Error(`No activity found for session ID: ${sessionId}`);
        }

        const designId = activityResult.design;

        // Step 3: Fetch the design details and extract the type
        const design = await getDesignById(designId);

        if (!design || !design.design || !design.design.type) {
            throw new Error(`Invalid design structure for design ID: ${designId}`);
        }

        return design.design.type;
    } catch (error) {
        console.error("Error fetching design type by stage ID:", error);
        throw new Error("Unable to fetch design type.");
    }
}
