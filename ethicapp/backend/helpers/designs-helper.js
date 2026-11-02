import * as config from "../config/database.config.js";
import * as rpg2 from "../db/rest-pg-2.js";
import { phaseExternalServices, unionEnabledServiceIds } from "./phase-external-services.js";
import { noPhaseExternalServices, sessionAiServicesEnabled } from "./session-ai-services.js";

// The design of a session's activity and the session's AI services switch
// (#970).
export const SESSION_ACTIVITY_DESIGN_SQL = `
    SELECT a.design, s.ai_services_enabled
    FROM activity AS a
    INNER JOIN sessions AS s
        ON s.id = a.session
    WHERE a.session = $1
`;

// The AI services switch of the session a phase belongs to (#970). An unknown
// phase answers no row, and the design read that follows reports it.
export const PHASE_SESSION_AI_SERVICES_SQL = `
    SELECT s.ai_services_enabled
    FROM stages AS st
    INNER JOIN sessions AS s
        ON s.id = st.sesid
    WHERE st.id = $1
`;

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
                SELECT id, design, creator, visibility, locked,
                       (visibility = 'public') AS public
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
            sqlParams: [rpg2.param('plain', phaseId)],
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
            sqlParams: [rpg2.param('plain', sessionId)],
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
            sqlParams: [rpg2.param('plain', designId)],
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

/**
 * Fetches the union of enabled external-service ids across all phases of the
 * activity design bound to a session. Used to resolve the broadcast audience for
 * the `activity-finished` cleanup hook, so any service enabled in any phase is
 * notified when the activity ends — regardless of which phase it finishes on.
 *
 * Design shape per canonical-schemas/ethicapp-v1.schema.json:
 * `design.phases[].externalServices.enabledServiceIds`.
 *
 * A session launched with its AI services turned off (#970) enables none.
 *
 * @param {number} sessionId - The session whose activity design is inspected.
 * @returns {Promise<string[]>} De-duplicated enabled service ids (empty if none).
 */
export async function getEnabledExternalServiceIdsBySessionId(sessionId) {
    const activityResult = await rpg2.singleSQL({
        dbcon:     config.dbconnString,
        sql:       SESSION_ACTIVITY_DESIGN_SQL,
        sqlParams: [rpg2.param("plain", sessionId)],
    });

    // Turned off at launch (#970): no service is in the audience, and
    // activity-finished only closes the session's room jobs.
    if (!activityResult || !sessionAiServicesEnabled(activityResult)) {
        return [];
    }

    const designResult = await rpg2.singleSQL({
        dbcon: config.dbconnString,
        sql: `
            SELECT design
            FROM designs
            WHERE id = $1
        `,
        sqlParams: [rpg2.param('plain', activityResult.design)],
    });

    return unionEnabledServiceIds(designResult?.design?.phases);
}


/**
 * The external services enabled for a phase and their stored configurations,
 * read from the activity's design when the hook is dispatched (#734). None
 * when the phase's session was launched with its AI services turned off
 * (#970): this is the gate of every phase hook dispatch and of the
 * destination check of a callback without a job.
 * @param {number} phaseId
 * @returns {Promise<{ enabledServiceIds: string[], configurations: Object<string, object> }>}
 */
export async function getPhaseExternalServices(phaseId) {
    const session = await rpg2.singleSQL({
        dbcon:     config.dbconnString,
        sql:       PHASE_SESSION_AI_SERVICES_SQL,
        sqlParams: [rpg2.param("plain", phaseId)],
    });
    if (!sessionAiServicesEnabled(session)) {
        return noPhaseExternalServices();
    }
    return phaseExternalServices(await getPhaseDesignByPhaseId(phaseId));
}
