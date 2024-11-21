"use strict";

import express from "express";
import * as config from "../config/config.js"; 
import * as rpg2 from "../db/rest-pg-2.js";
import * as ActivitiesHelper from "../helpers/activities-helper.js"
import * as StatusCodes from "../../common/modules/session-status.js"

const router = express.Router();

const activityResponsesFetchHandlers = {
    "semantic-differential": fetchSemanticDifferentialResponses,
    ranking: fetchRankingResponses,
};

/**
 * Retrieves the descriptor object for an activity in a session.
 * The descriptor includes the design ID, the activity status, 
 * and a list of phases with their number, ID, and active state.
 * 
 * @param {string} session_id - The ID of the session (from the URL path).
 * @returns {Object} - A JSON object with the design ID, activity status, and phase information.
 */
router.get("/activities/:session_id/descriptor", async (req, res) => {
    const { session_id } = req.params;

    if (!session_id) {
        return res.status(400).json({ error: "Missing required parameter: session_id." });
    }

    try {
        // Step 1: Get the design ID and activity status for the session
        const activityResult = await rpg2.singleSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT a.design, s.status
                FROM activity AS a
                INNER JOIN sessions AS s
                    ON a.session = s.id
                WHERE a.session = $1
            `,
            sqlParams: [session_id],
        });

        if (!activityResult) {
            return res.status(404).json({ error: "No activity found for the given session." });
        }

        const { design: designId, status } = activityResult;

        // Step 2: Get the list of phases for the session
        const phases = await ActivitiesHelper.getPhasesForSession(session_id);
        const statusName = StatusCodes.getNameByCode(status);

        // Step 3: Construct and return the descriptor
        res.status(200).json({
            designId,
            statusName,
            phases,
        });
    } catch (err) {
        console.error("Error fetching activity descriptor:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

/**
 * @route GET /activities/:session_id/responses
 * @description Retrieves all responses for an activity session, grouped by phase.
 *              The logic and structure of the responses depend on the design type of the activity.
 * @param {string} session_id - The ID of the session (from the URL path).
 * @returns {Object} - A JSON object containing responses grouped by phases.
 * 
 * @example
 * // Request
 * GET /activities/123/responses
 * 
 * // Response (success)
 * {
 *   "phases": [
 *     {
 *       "phase_number": 1,
 *       "responses": [
 *         {
 *           "uid": 45,
 *           "response_detail": "Example response data"
 *         },
 *         {
 *           "uid": 67,
 *           "response_detail": "Another response"
 *         }
 *       ]
 *     },
 *     {
 *       "phase_number": 2,
 *       "responses": [
 *         {
 *           "uid": 45,
 *           "response_detail": "Example response for phase 2"
 *         }
 *       ]
 *     }
 *   ]
 * }
 * 
 * // Response (session_id missing)
 * {
 *   "error": "Missing required parameter: session_id."
 * }
 * 
 * // Response (unsupported design type)
 * {
 *   "error": "Unsupported design type: example_type."
 * }
 * 
 * // Response (no responses found)
 * {
 *   "error": "No responses found for the given activity."
 * }
 * 
 * // Response (internal server error)
 * {
 *   "error": "Internal server error."
 * }
 */
router.get("/activities/:session_id/responses", async (req, res) => {
    const { session_id } = req.params;

    if (!session_id) {
        return res.status(400).json({ error: "Missing required parameter: session_id" });
    }

    try {
        // Determine the design type
        const designType = await getDesignTypeBySessionId(session_id);

        // Fetch responses using the appropriate handler
        const handler = activityResponsesFetchHandlers[designType];
        if (!handler) {
            return res.status(400).json({ error: `Unsupported design type: ${designType}` });
        }

        const results = await handler(session_id);

        if (results.length === 0) {
            return res.status(404).json({ error: "No responses found for the given activity." });
        }

        // Group responses by stage or other relevant criteria if necessary
        const groupedResponses = results.reduce((acc, row) => {
            const { phase_number, ...response } = row;
            if (!acc[phase_number]) {
                acc[phase_number] = {
                    phase_number,
                    responses: [],
                };
            }
            acc[phase_number].responses.push(response);
            return acc;
        }, {});

        const responseArray = Object.values(groupedResponses);

        res.status(200).json({ phases: responseArray });
    } catch (err) {
        console.error("Error fetching activity responses:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

/**
 * @route POST /activities/:session_id/phase_transition
 * @description Transitions an activity session to a new phase (stage) by updating the current stage in the session.
 *              This also notifies connected clients of the state change via WebSocket.
 * @param {string} session_id - The ID of the session (from the URL path).
 * @param {number} stage_id - The ID of the new stage to transition to (from the request body).
 * @returns {Object} - A JSON object indicating the success or failure of the transition.
 * 
 * @example
 * // Request
 * POST /activities/123/phase_transition
 * {
 *   "stage_id": 456
 * }
 * 
 * // Response (success)
 * {
 *   "status": "ok",
 *   "message": "Session transitioned to the new stage."
 * }
 * 
 * // Response (missing parameters)
 * {
 *   "error": "Missing required parameters: session_id or stage_id."
 * }
 * 
 * // Response (session not found or no update performed)
 * {
 *   "error": "Session not found or no update performed."
 * }
 * 
 * // Response (internal server error)
 * {
 *   "error": "Internal server error."
 * }
 */
router.post("/activities/:session_id/phase_transition", async (req, res) => {
    const { session_id } = req.params;
    const { phase_id } = req.body;

    if (!session_id || !phase_id) {
        return res.status(400).json({ error: "Missing required parameters: session_id or phase_id." });
    }

    // Get the status code for "in progress"
    const status = StatusCodes.getStatusCode("in_progress");

    try {
        const result = await rpg.execSQL({
            sql: `
                UPDATE sessions
                SET status = $1,
                    current_stage = $2
                WHERE id = $3
            `,
            dbcon: config.dbconnString,
            sqlParams: [status, phase_id, session_id],
        });

        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Session not found or no update performed." });
        }

        const io = req.app.locals.io;
        const socket = configSocket(io);
        socket.stateChange(session_id);

        res.status(200).json({ status: "ok", message: "Session transitioned to the new phase." });
    } catch (err) {
        console.error("Error transitioning session stage:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

/**
 * @route POST /activities/:session_id/finish
 * @description Marks an activity session as finished by updating its status and clearing the current stage.
 *              Notifies connected clients of the state change via WebSocket.
 * @param {string} session_id - The ID of the session (from the URL path).
 * @returns {Object} - A JSON object indicating the success or failure of the operation.
 * 
 * @example
 * // Request
 * POST /activities/123/finish
 * 
 * // Response (success)
 * {
 *   "status": "ok",
 *   "message": "Activity session finished successfully."
 * }
 * 
 * // Response (missing session_id)
 * {
 *   "error": "Missing required parameter: session_id."
 * }
 * 
 * // Response (session not found or no update performed)
 * {
 *   "error": "Session not found or no update performed."
 * }
 * 
 * // Response (internal server error)
 * {
 *   "error": "Internal server error."
 * }
 */
router.post("/activities/:session_id/finish", async (req, res) => {
    const { session_id } = req.params;

    if (!session_id) {
        return res.status(400).json({ error: "Missing required parameter: session_id" });
    }

    // Get the status code for "finished"
    const status = StatusCodes.getStatusCode("finished");

    try {
        const result = await rpg2.execSQL({
            sql: `
                UPDATE sessions
                SET status = $1,
                    current_stage = NULL
                WHERE id = $2
            `,
            dbcon: config.dbconnString,
            sqlParams: [status, session_id],
        });

        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Session not found or no update performed." });
        }

        const io = req.app.locals.io;
        const socket = configSocket(io);
        socket.stateChange(session_id);

        res.status(200).json({ status: "ok", message: "Activity session finished successfully." });
    } catch (err) {
        console.error("Error finishing activity session:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

/**
 * @route POST /activities/:session_id/phases
 * @description Adds a new phase to an activity session by inserting it into the database.
 * @param {string} session_id - The ID of the session (from the URL path).
 * @param {number} number - The number of the phase (from the request body).
 * @param {string} type - The type of the phase (e.g., "semantic-differential") (from the request body).
 * @param {boolean} [anon=false] - Whether the phase is anonymous (from the request body, optional).
 * @param {boolean} [chat=false] - Whether chat is enabled for the phase (from the request body, optional).
 * @param {string} [prev_ans=null] - References to previous answers if applicable (from the request body, optional).
 * @param {string} [question=null] - The question associated with the phase (from the request body, optional).
 * @param {string} [grouping=null] - The grouping algorithm used for the phase (from the request body, optional).
 * @returns {Object} - A JSON object indicating the success or failure of the operation.
 * 
 * @example
 * // Request
 * POST /activities/123/phases
 * {
 *   "number": 1,
 *   "type": "semantic-differential",
 *   "anon": true,
 *   "chat": false,
 *   "prev_ans": null,
 *   "question": "What is your opinion?",
 *   "grouping": "random"
 * }
 * 
 * // Response (success)
 * {
 *   "status": "ok",
 *   "phase_id": 456,
 *   "message": "Phase added successfully."
 * }
 * 
 * // Response (missing required parameters)
 * {
 *   "error": "Missing required parameters: session_id, number, or type."
 * }
 * 
 * // Response (insertion failed)
 * {
 *   "error": "Failed to add the phase. No rows were inserted."
 * }
 * 
 * // Response (internal server error)
 * {
 *   "error": "Internal server error."
 * }
 */
router.post("/activities/:session_id/phases", async (req, res) => {
    const { session_id } = req.params; // Extract session_id from URL parameters
    const {
        number,
        type,
        anon,
        chat,
        prev_ans,
        question,
        grouping,
    } = req.body; // Extract phase details from the request body

    // Validate required parameters
    if (!session_id || !number || !type) {
        return res.status(400).json({
            error: "Missing required parameters: session_id, number, or type.",
        });
    }

    try {
        // Insert the new phase into the database
        const result = await rpg2.execSQL({
            sql: `
                INSERT INTO stages (number, type, anon, chat, sesid, prev_ans, question, grouping)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING id
            `,
            dbcon: config.dbconnString, // Database connection string
            sqlParams: [
                number,    // The phase number
                type,      // The phase type (e.g., "semantic-differential")
                anon || false, // Whether the phase is anonymous (default: false)
                chat || false, // Whether chat is enabled (default: false)
                session_id,    // The session ID
                prev_ans || null, // Previous answers (optional)
                question || null, // Question associated with the phase (optional)
                grouping || null, // Grouping algorithm (optional)
            ],
        });

        // Check if any row was inserted
        if (result.rowCount === 0) {
            return res.status(500).json({
                error: "Failed to add the phase. No rows were inserted.",
            });
        }

        // Respond with the ID of the newly created phase
        res.status(201).json({
            status: "ok",
            phase_id: result.rows[0].id,
            message: "Phase added successfully.",
        });
    } catch (err) {
        console.error("Error adding phase:", err); // Log the error for debugging
        res.status(500).json({ error: "Internal server error" });
    }
});

/**
 * Retrieves the design type for a given session ID.
 * @param {number} sessionId - The session ID.
 * @returns {Promise<string>} - The design type (e.g., "ranking" or "semantic-differential").
 * @throws {Error} If the design type is invalid or not found.
 */
async function getDesignTypeBySessionId(sessionId) {
    const result = await rpg2.execSQL({
        sql: `
            SELECT d.design->>'type' AS design_type
            FROM activity AS a
            INNER JOIN designs AS d
                ON a.design = d.id
            WHERE a.session = $1
        `,
        dbcon: config.dbconnString,
        sqlParams: [sessionId],
    });

    if (result.length === 0) {
        throw new Error(`No design found for session ID: ${sessionId}`);
    }

    const designType = result[0].design_type;

    if (!isValidDesignType(designType)) {
        throw new Error(`Unsupported design type: ${designType}`);
    }

    return designType;
}

/**
 * Fetches responses for semantic-differential activities in a given session.
 * This query retrieves data grouped by stage and includes details such as user IDs, team IDs, 
 * selections, and comments. It also associates responses with their respective phase numbers.
 * 
 * @async
 * @function fetchSemanticDifferentialResponses
 * @param {string} sessionId - The ID of the session for which to fetch responses.
 * @returns {Promise<Array>} - Resolves with an array of response objects, each containing:
 *   - `stageid`: The ID of the stage (phase).
 *   - `orden`: The order of the item.
 *   - `uid`: The user ID of the respondent.
 *   - `tmid`: The team ID of the respondent (if applicable).
 *   - `did`: The differential ID of the item.
 *   - `sel`: The user's selection.
 *   - `comment`: Any comment associated with the response.
 *   - `phase_number`: The number of the phase in the session.
 * 
 * @throws {Error} If the SQL query fails.
 * 
 * @example
 * // Usage
 * const responses = await fetchSemanticDifferentialResponses('12345');
 * console.log(responses);
 * 
 * // Example response
 * [
 *   {
 *     "stageid": 1,
 *     "orden": 1,
 *     "uid": 101,
 *     "tmid": 7,
 *     "did": 501,
 *     "sel": "Agree",
 *     "comment": "Good choice",
 *     "phase_number": 2
 *   },
 *   {
 *     "stageid": 2,
 *     "orden": 2,
 *     "uid": 102,
 *     "tmid": 8,
 *     "did": 502,
 *     "sel": "Disagree",
 *     "comment": null,
 *     "phase_number": 3
 *   }
 * ]
 */
async function fetchSemanticDifferentialResponses(sessionId) {
    const results = await rpg2.execSQL({
        sql: `
            SELECT d.stageid,
                   d.orden,
                   s.uid,
                   r.tmid,
                   s.did,
                   s.sel,
                   s.comment,
                   st.number AS phase_number
            FROM differential_selection AS s
            INNER JOIN differential AS d
                ON s.did = d.id
            INNER JOIN stages AS st
                ON d.stageid = st.id
            LEFT JOIN (
                SELECT tu.*
                FROM teamusers AS tu
                INNER JOIN teams AS t
                    ON tu.tmid = t.id
            ) AS r
                ON r.uid = s.uid
            WHERE st.sesid = $1
            ORDER BY d.stageid, s.uid, d.orden
        `,
        dbcon: config.dbconnString,
        sqlParams: [sessionId],
    });

    return results;
}

/**
 * Fetches responses for ranking activities in a given session.
 * This query retrieves data related to user rankings, including item descriptions, order, and user selections.
 * Responses are grouped by phase and include the phase number for context.
 * 
 * @async
 * @function fetchRankingResponses
 * @param {string} sessionId - The ID of the session for which to fetch ranking responses.
 * @returns {Promise<Array>} - Resolves with an array of response objects, each containing:
 *   - `id`: The ID of the ranking item.
 *   - `description`: The description of the ranking item.
 *   - `orden`: The order in which the item was ranked.
 *   - `actorid`: The ID of the actor or choice being ranked.
 *   - `uid`: The user ID of the respondent.
 *   - `phase_number`: The number of the phase in the session.
 * 
 * @throws {Error} If the SQL query fails.
 * 
 * @example
 * // Usage
 * const responses = await fetchRankingResponses('12345');
 * console.log(responses);
 * 
 * // Example response
 * [
 *   {
 *     "id": 1,
 *     "description": "Rank Item 1",
 *     "orden": 1,
 *     "actorid": 101,
 *     "uid": 201,
 *     "phase_number": 1
 *   },
 *   {
 *     "id": 2,
 *     "description": "Rank Item 2",
 *     "orden": 2,
 *     "actorid": 102,
 *     "uid": 201,
 *     "phase_number": 1
 *   }
 * ]
 */
async function fetchRankingResponses(sessionId) {
    const results = await rpg2.execSQL({
        sql: `
            SELECT a.id,
                   a.description,
                   a.orden,
                   a.actorid,
                   a.uid,
                   st.number AS phase_number
            FROM actor_selection AS a
            INNER JOIN stages AS st
                ON a.stageid = st.id
            WHERE st.sesid = $1
            ORDER BY a.uid, a.orden
        `,
        dbcon: config.dbconnString,
        sqlParams: [sessionId],
    });

    return results;
}

export default router;