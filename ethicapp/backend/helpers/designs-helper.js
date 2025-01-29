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
            sqlParams: [rpg2.param('plain', id)],
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
            sqlParams: [rpg2.param('plain', phaseId)],
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
            sqlParams: [rpg2.param('plain', sessionId)],
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

/**
 * Fetches the specific phase design from a given phase (stage) ID.
 *
 * @param {number} phaseId - The ID of the phase (stage).
 * @returns {Promise<Object>} - The design object corresponding to the queried phase.
 * @throws {Error} If the phase, session, design, or phase index is invalid or cannot be found.
 */
export async function getPhaseDesignByPhaseId(phaseId) {
    try {
        // Step 1: Fetch the session ID (`sesid`) and stage number from the `stages` table
        const stageResult = await rpg2.singleSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT sesid, number
                FROM stages
                WHERE id = $1
            `,
            sqlParams: [phaseId],
        });

        if (!stageResult) {
            throw new Error(`No session ID or stage number found for phase (stage) ID: ${phaseId}`);
        }

        const sessionId = stageResult.sesid;
        const stageNumber = stageResult.number;

        // Step 2: Fetch the design ID associated with the session from the `activity` table
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
            throw new Error(`No design found for session ID: ${sessionId}`);
        }

        const designId = activityResult.design;

        // Step 3: Fetch the design details from the `designs` table
        const designResult = await rpg2.singleSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT design
                FROM designs
                WHERE id = $1
            `,
            sqlParams: [designId],
        });

        if (!designResult || !designResult.design) {
            throw new Error(`No design found for design ID: ${designId}`);
        }

        const design = designResult.design; // Assuming `design` is stored as JSON in the database

        // Step 4: Extract the phase from the design's `phases` array using the stage number
        const phases = design.phases;

        if (!Array.isArray(phases) || stageNumber < 1 || stageNumber > phases.length) {
            throw new Error(
                `Invalid phase index for stage number ${stageNumber} in design ID: ${designId}`
            );
        }

        const phaseDesign = phases[stageNumber - 1];

        return phaseDesign;
    } catch (error) {
        console.error("Error in getPhaseDesignByPhaseId:", error);
        throw new Error("Unable to fetch phase design.");
    }
}


