"use strict";

import express from "express";
import * as config from "../config/config.js"; 
import * as rpg2 from "../db/rest-pg-2.js";
import redisClient from "../db/redis.js";
import * as DesignTypes from "../../common/modules/design-types.js";
import * as ActivitiesHelper from "../helpers/activities-helper.js"
import * as StatusCodes from "../../common/modules/session-status.js"
import { studentNotifications } from "../config/socket.config.js";

const router = express.Router();

router.get("/activities", async (req, res) => {
    try {
        // Validate session
        const userId = req.session?.uid;
        if (!userId) {
            return res.status(401).json({ status: "err", message: "Unauthorized" });
        }

        // Execute the query
        const rawActivities = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT 
                    activity.id AS id,
                    activity.session AS "sessionId",
                    sessions.creator,
                    sessions.name,
                    sessions.descr AS "description",
                    sessions.time,
                    sessions.code,
                    sessions.archived,
                    designs.design,
                    sessions.status,
                    sessions.type,
                    designs.id AS "designId"
                FROM activity
                INNER JOIN sessions
                    ON activity.session = sessions.id
                INNER JOIN designs
                    ON activity.design = designs.id
                WHERE sessions.creator = $1;
            `,
            sqlParams: [rpg2.param("plain", userId)],
        });

        // Ensure camelCase formatting for the keys
        const activities = rawActivities.map((row) => ({
            id: row.id,
            sessionId: row.sessionId,
            creator: row.creator,
            name: row.name,
            description: row.description,
            time: row.time,
            code: row.code,
            archived: row.archived,
            design: row.design,
            status: row.status,
            type: row.type,
            designId: row.designId,
        }));

        // Return the activities
        return res.status(200).json({ status: "ok", activities });
    } catch (err) {
        console.error("Error in GET /activities:", err);
        return res.status(500).json({ status: "err", error: "Error retrieving activities." });
    }
});

router.post("/activities", async (req, res) => {
    const sessionId = req.body.sessionId;
    const designId = req.body.designId;

    try {
        // Validate input
        if (!sessionId || !designId) {
            return res.status(400).json({ status: "err", message: "Missing session or design ID" });
        }

        const sessionCode = ActivitiesHelper.generateSessionCode(sessionId);

        // Generate an access code for the session if not already set
        await rpg2.singleSQL({
            dbcon: config.dbconnString,
            sql: `
                UPDATE sessions
                SET code = $1
                WHERE id = $2
                  AND code IS NULL
            `,
            sqlParams: [rpg2.param('plain', sessionCode), 
                rpg2.param('plain', sessionId)],
        });

        // Insert the new activity
        await rpg2.singleSQL({
            dbcon: config.dbconnString,
            sql: `
                INSERT INTO activity (design, session)
                VALUES ($1, $2)
            `,
            sqlParams: [rpg2.param('plain', designId), 
                rpg2.param('plain', sessionId)],
        });

        // Lock the design
        await rpg2.singleSQL({
            dbcon: config.dbconnString,
            sql: `
                UPDATE designs
                SET locked = TRUE
                WHERE id = $1
            `,
            sqlParams: [rpg2.param('plain', designId)],
        });

        // Query the newly created activity
        const activity = await rpg2.singleSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT 
                    activity.id as id,
                    activity.session as sessionId,
                    sessions.creator,
                    sessions.name,
                    sessions.descr as description,
                    sessions.time,
                    sessions.code,
                    sessions.archived,
                    designs.design,
                    sessions.status,
                    sessions.type,
                    designs.id as designId
                FROM activity
                INNER JOIN sessions
                    ON activity.session = sessions.id
                INNER JOIN designs
                    ON activity.design = designs.id
                WHERE activity.session = $1 AND activity.design = $2
                ORDER BY activity.id DESC
                LIMIT 1
            `,
            sqlParams: [rpg2.param('plain', sessionId), rpg2.param('plain', designId)],
        });

        // Return the created activity
        return res.status(200).json({ status: "ok", activity });
    } catch (error) {
        console.error("Error in POST /activities endpoint:", error);
        return res.status(500).json({ status: "err", message: "Error processing activity addition" });
    }
});

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

    // Ensure session_id is valid
    if (!session_id || isNaN(Number(session_id))) {
        return res.status(400).json({ error: "Invalid or missing required parameter: session_id." });
    }

    try {
        const pool = await rpg2.getDBInstance(config.dbconnString);

        if (!pool || typeof pool.query !== "function") {
            throw new Error("Database pool not properly initialized or invalid.");
        }

        // Get the activity matching the session id
        const queryText = `
            SELECT 
                activity.id AS id,
                activity.session AS sessionId,
                sessions.creator,
                sessions.name,
                sessions.descr AS description,
                sessions.time,
                sessions.code,
                sessions.archived,
                sessions.status,
                sessions.type,
                designs.id AS designId,
                designs.design
            FROM activity
            INNER JOIN sessions
                ON activity.session = sessions.id
            INNER JOIN designs
                ON activity.design = designs.id
            WHERE activity.session = $1
            ORDER BY activity.id DESC
            LIMIT 1;
        `;

        const result = await pool.query(queryText, [Number(session_id)]);

        if (!result.rows || result.rows.length === 0) {
            console.warn(`No activity found for session_id: ${session_id}`);
            return res.status(404).json({ error: "No activity found for the given session." });
        }

        const activityResult = result.rows[0];

        // Get the phases that have been created in the session
        const designType = activityResult.design.type;
        const phases = await getPhasesForSessionByDesignType(session_id, designType);

        // Create the activity descriptor
        const descriptor = {
            id: activityResult.id,
            sessionId: activityResult.sessionid,
            creator: activityResult.creator,
            name: activityResult.name,
            description: activityResult.description,
            time: activityResult.time,
            code: activityResult.code,
            archived: activityResult.archived,
            status: StatusCodes.getNameByCode(activityResult.status),
            type: activityResult.type,
            designId: activityResult.designid,
            design: activityResult.design,
            phases: phases || [], // Default to an empty array if no phases
            currentPhase: phases && phases.length > 0 ? phases[phases.length - 1] : null, // Last phase or null
        };

        console.info(`Successfully retrieved activity descriptor for session_id: ${session_id}.`);
        return res.status(200).json({ descriptor });
    } catch (err) {
        console.error(`Error fetching activity descriptor for session_id: ${session_id}`, err);
        return res.status(500).json({ error: "Internal server error" });
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

    if (!session_id || isNaN(Number(session_id))) {
        return res.status(400).json({ error: "Invalid or missing required parameter: session_id" });
    }

    try {
        const designType = await getDesignTypeBySessionId(session_id);

        const handler = activityResponsesFetchHandlers[designType];
        if (!handler) {
            return res.status(400).json({ error: `Unsupported design type: ${designType}` });
        }

        const results = await handler(session_id);

        if (!results || results.length === 0) {
            console.warn(`No responses found for session_id: ${session_id}`);
            return res.status(404).json({ error: "No responses found for the given activity." });
        }

        const groupedResponses = results.reduce((acc, row) => {
            const { phase_number, ...response } = row;
            acc[phase_number] = acc[phase_number] || { phase_number, responses: [] };
            acc[phase_number].responses.push(response);
            return acc;
        }, {});

        res.status(200).json({ phases: Object.values(groupedResponses) });
    } catch (err) {
        console.error(`Error fetching responses for session_id: ${session_id}`, err);
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
    const { session_id: sessionId } = req.params;
    const { phaseId } = req.body;

    if (!sessionId || !phaseId) {
        return res.status(400).json({ error: "Missing required parameters: session_id or phase_id." });
    }

    // Get the status code for "in progress"
    const status = StatusCodes.getStatusCode("in_progress");

    try {
        let result = await rpg2.execSQL({
            sql: `
                SELECT COUNT(*)::integer
                FROM stages
                WHERE id = $1
            `,
            dbcon: config.dbconnString,
            sqlParams: [rpg2.param('plain', phaseId)],
        });

        if (!(result.length > 0 && result[0].count === 1)) {
            return res.status(400).json({ error: "The phase does not exist." });
        }        

        result = await rpg2.execSQL({
            sql: `
                UPDATE sessions
                SET status = $1,
                    current_stage = $2
                WHERE id = $3
            `,
            dbcon: config.dbconnString,
            sqlParams: [rpg2.param('plain', status), 
                rpg2.param('plain', phaseId), 
                rpg2.param('plain', sessionId)],
        });

        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Session not found or no update performed." });
        }

        // Notify students the phase has changed!
        studentNotifications.phaseTransition(sessionId, phaseId);

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
    const { session_id: sessionId } = req.params;

    if (!sessionId) {
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
            sqlParams: [rpg2.param('plain', status), 
                rpg2.param('plain', sessionId)],
        });

        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Session not found or no update performed." });
        }

        // Notify students the activity has finished!
        studentNotifications.endSession(sessionId);

        res.status(200).json({ status: "ok", message: "Activity session finished successfully." });
    } catch (err) {
        console.error("Error finishing activity session:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

/**
 * @route GET /activities/:session_id/phases
 * @description Retrieves the phases created in a given session.
 * @param {string} session_id - The ID of the session (from the URL path).
 * @returns {Object} - A JSON object containing a list of phases, each with detailed information.
 */
router.get("/activities/:session_id/phases", async (req, res) => {
    const { session_id } = req.params;

    // Validate session_id
    if (!session_id || isNaN(Number(session_id))) {
        return res.status(400).json({ error: "Invalid or missing required parameter: session_id." });
    }

    try {
        // Execute the SQL query to fetch phases
        const phases = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT id,
                       number,
                       type,
                       anon,
                       chat,
                       prev_ans,
                       question,
                       grouping
                FROM stages
                WHERE sesid = $1
            `,
            sqlParams: [rpg2.param('plain', session_id)],
        });

        // Check if any phases were found
        if (!phases || phases.length === 0) {
            console.warn(`No phases found for session_id: ${session_id}`);
            return res.status(404).json({ error: "No phases found for the given session." });
        }

        // Log success and return the phases
        console.info(`Successfully retrieved ${phases.length} phases for session_id: ${session_id}.`);
        return res.status(200).json({ phases });
    } catch (err) {
        // Log error with session_id for context
        console.error(`Error fetching phases for session_id: ${session_id}`, err);
        return res.status(500).json({ error: "Internal server error" });
    }
});


/**
 * @route POST /activities/:session_id/phases
 * @description Adds a new phase to an activity session by inserting it into the database.
 * @param {string} session_id - The ID of the session (from the URL path).
 * @param {number} number - The number of the phase (from the request body).
 * @param {string} type - The type of the phase (e.g., "semantic_differential") (from the request body).
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
 *   "type": "semantic_differential",
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

    const queryParams = [
        rpg2.param('plain', number),    // The phase number
        rpg2.param('plain', type),      // The phase type (e.g., "individual"/"team")
        rpg2.param('plain', anon || false), // Whether the phase is anonymous (default: false)
        rpg2.param('plain', chat || false), // Whether chat is enabled (default: false)
        rpg2.param('plain', session_id),    // The session ID
        rpg2.param('plain', JSON.stringify(prev_ans) || null), // Previous answers (optional)
        rpg2.param('plain', question || null), // Question associated with the phase (optional)
        rpg2.param('plain', grouping || null), // Grouping algorithm (optional)
    ];

    try {
        // Insert the new phase into the database
        const result = await rpg2.execSQL({
            sql: `
                INSERT INTO stages (number, type, anon, chat, sesid, prev_ans, question, grouping)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING id
            `,
            dbcon: config.dbconnString, // Database connection string
            sqlParams: queryParams,
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
            phaseId: result[0].id,
            message: "Phase added successfully.",
        });
    } catch (err) {
        console.error("Error adding phase:", err); // Log the error for debugging
        res.status(500).json({ error: "Internal server error" });
    }
});

/**
 * @route PATCH /activities/:session_id/toggle_archived
 * @description Toggles the `archived` status of a session. This endpoint inverts the current boolean value 
 *              of the `archived` field for the specified session in the `sessions` table.
 * @param {string} :session_id - The ID of the session to toggle the `archived` status for.
 * @returns {object} - A JSON response with a success message if the operation is successful, or an error message otherwise.
 * @example
 * // Request
 * PATCH /activities/123/toggle_archived
 * 
 * // Successful Response
 * {
 *   "status": "ok",
 *   "message": "Session archived status toggled successfully"
 * }
 * 
 * // Error Response
 * {
 *   "status": "err",
 *   "message": "Internal Server Error"
 * }
 */
router.patch("/activities/:session_id/toggle_archived", async (req, res) => {
    try {
        const sessionId = req.params.session_id;

        // Validate input
        if (!sessionId) {
            return res.status(400).json({ status: "err", message: "Session ID is required" });
        }

        // Execute SQL to toggle the archived field
        await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: `
                UPDATE sessions
                SET archived = NOT archived
                WHERE id = $1;
            `,
            sqlParams: [rpg2.param('plain', sessionId)],
        });

        return res.json({ status: "ok", message: "Session archived status toggled successfully" });
    } catch (err) {
        console.error("Error in /activities/:session_id/toggle_archived:", err);
        return res.status(500).json({ status: "err", message: "Internal Server Error" });
    }
});

/**
 * Endpoint to retrieve the full state for a user in a session.
 *
 * GET /activities/:id/users/:user_id/full_state
 *
 * This endpoint generates and returns the complete activity state for a specific user (`user_id`)
 * within a given session (`id`). The state includes a descriptor for the session and detailed 
 * information about all phases, tasks, responses, group memberships, peer responses, and chat messages.
 *
 * Request Parameters:
 * - id (URL parameter): The session ID.
 * - user_id (URL parameter): The user ID for whom the state is being retrieved.
 *
 * Authorization:
 * - The requesting user must match the `user_id` in the request; otherwise, a 403 error is returned.
 *
 * Response (JSON):
 * - state (Object): The full activity state, structured as:
 *   - descriptor (Object): Details about the session, including title, design, and current phase number.
 *   - phases (Array): An array of phases, each containing:
 *     - features (Object): Phase-specific attributes such as mode, chat, and anonymity settings.
 *     - tasks (Array): Tasks/questions for the phase.
 *     - responses (Array): Responses from the user for the phase's tasks.
 *     - peerResponses (Array): Responses from group peers for the phase's tasks.
 *     - group (Object): Group details, including group ID and peers.
 *     - groupMessages (Array): Chat messages grouped by task for the phase.
 *
 * Error Handling:
 * - Returns a 400 status code for invalid session or user IDs.
 * - Returns a 403 status code if the requesting user is not authorized to access the state.
 * - Returns a 404 status code if critical session or phase data is missing.
 * - Returns a 500 status code for unexpected errors during processing.
 */
router.get('/activities/:id/users/:user_id/full_state', async (req, res) => {
    const sessionId = Number(req.params.id);
    const userId = Number(req.params.user_id);
    const invalidate = req.query.invalidate === 'true';

    if (!sessionId || !userId) {
        return res.status(400).json({ error: 'Invalid session ID or user ID.' });
    }

    if (userId !== req.session.uid) {
        return res.status(403).json({ error: 'Access forbidden to state of the user.' });
    }

    try {
        // Step 1: Get the descriptor
        const { descriptor } = await getCachedStudentActivityDescriptor(sessionId);

        if (!descriptor || !descriptor.design) {
            return res.status(404).json({ error: 'Descriptor not found for the given session.' });
        }

        // Step 2: Get the phases
        const { phases } = await getCachedStudentActivityPhases(sessionId);

        if (!phases || phases.length === 0) {
            return res.status(404).json({ error: 'No phases found for the given session.' });
        }

        // Step 3: Determine design type
        const designType = getDesignTypeBySessionId(sessionId);

        if (!designType) {
            return res.status(400).json({ error: 'Design type could not be determined.' });
        }

        // Step 4: Get tasks for each phase
        const phasesWithTasks = await getCachedStudentActivityTasks(designType, sessionId, phases);

        // Step 5: Get responses for each phase
        const phasesWithResponses = await getCachedStudentActivityResponses(designType, 
            sessionId, userId, phasesWithTasks);

        // Step 6: Get peer responses for each phase
        const phasesWithPeerResponses = await getCachedStudentActivityPeerResponses(designType, sessionId,
            userId, phasesWithResponses);

        // Step 7: Get groups and integrate into phases
        await getCachedStudentActivityGroups(sessionId, userId, phasesWithPeerResponses);

        // Step 8: Get group messages
        const phasesWithGroupMessages = await getCachedStudentActivityGroupMessages(designType,
            sessionId, userId, phasesWithPeerResponses);

        // Step 9: Assemble the state object
        const state = {
            descriptor,
            phases: phasesWithGroupMessages
        };

        return res.status(200).json({ state });
    } catch (error) {
        console.error(`Error generating full state for session ID ${sessionId}, user ID ${userId}:`, error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

/**
 * Endpoint to retrieve peer responses for a specific user in a session.
 * 
 * GET /activities/:session_id/users/:user_id/peer_responses
 * 
 * This endpoint retrieves all peer responses for the specified user (`user_id`) in a session (`session_id`)
 * across the provided phases. Each phase is identified by its `number` within the session. The responses
 * are grouped by phase and include responses from the user's group peers in group-based phases.
 * 
 * Request Parameters:
 * - session_id (URL parameter): The ID of the session.
 * - user_id (URL parameter): The ID of the user.
 * 
 * Request Body (JSON):
 * - phases (Array): An array of phase objects, each containing:
 *   - number (integer): The phase number (1-based index within the session).
 * 
 * Response (JSON):
 * - status (string): Indicates the success status of the operation ('ok' or 'error').
 * - phases (Array): An array of phase objects, each containing:
 *   - number (integer): The phase number.
 *   - peerResponses (Array): An array of peer responses, each containing:
 *     - peerId (integer): The ID of the peer who made the response.
 *     - response (string): The peer's response.
 * 
 * Error Handling:
 * - Returns a 400 status code if the request parameters or body are invalid.
 * - Returns a 404 status code if the session or design type is not found.
 * - Returns a 500 status code in case of any unexpected errors.
 */
router.get('/activities/:session_id/users/:user_id/peer_responses', async (req, res) => {
    try {
        const sessionId = Number(req.params.session_id);
        const userId = Number(req.params.user_id);

        // Validate parameters
        if (isNaN(sessionId) || isNaN(userId)) {
            return res.status(400).json({ error: 'Invalid session_id or user_id' });
        }

        // Extract the phases from the request body (phases should be provided in the body as JSON)
        const { phases } = req.body;
        if (!Array.isArray(phases) || phases.length === 0) {
            return res.status(400).json({ error: 'Phases must be a non-empty array' });
        }

        // Get the design type for the session
        const designType = await getDesignTypeBySessionId(sessionId);
        if (!designType) {
            return res.status(404).json({ error: 'Design type not found for the given session' });
        }

        // Get peer responses using the appropriate function
        const updatedPhases = await getStudentActivityPeerResponses(designType, sessionId, userId, phases);

        // Return the updated phases with peer responses
        return res.status(200).json({ status: 'ok', phases: updatedPhases });
    } catch (error) {
        console.error('Error in /activities/:session_id/users/:user_id/peer_responses:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});


/**
 * Retrieves the design type for a given session ID.
 * @param {number} sessionId - The session ID.
 * @returns {Promise<string>} - The design type (e.g., "ranking" or "semantic_differential").
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
        sqlParams: [rpg2.param('plain', sessionId)],
    });

    if (result.length === 0) {
        throw new Error(`No design found for session ID: ${sessionId}`);
    }

    const designType = result[0].design_type;

    if (!DesignTypes.isValidDesignType(designType)) {
        throw new Error(`Unsupported design type: ${designType}`);
    }

    return designType;
}

async function getPhasesForSessionByDesignType(sessionId, designType) {
    const results = await rpg2.execSQL({
        dbcon: config.dbconnString,
        sql: `
            SELECT id, type, number
            FROM stages
            WHERE sesid = $1
            ORDER BY id ASC
        `,
        sqlParams: [rpg2.param('plain', sessionId)],
    });

    if (results.length === 0) {
        return [];
    }

    return Promise.all(
        results.map(async (row, index) => {
            const questions = await getQuestionsByPhase(row.id, designType);
            return {
                id: row.id,         // The ID of the phase (stage)
                number: row.number, // The number of the phase
                mode: row.type,
                questions: questions, // Add the questions for this phase
            };
        })
    );
}

/**
 * Fetches responses for semantic_differential activities in a given session.
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
        sqlParams: [rpg2.param('plain', sessionId)],
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
        sqlParams: [rpg2.param('plain', sessionId)],
    });

    return results;
}

const activityResponsesFetchHandlers = {
    semantic_differential: fetchSemanticDifferentialResponses,
    ranking: fetchRankingResponses,
};

// Object mapping design types to their respective question-fetching functions
const questionFetchHandlers = {
    semantic_differential: async (phaseId) => {
        const results = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT id,
                justify,
                orden,
                num
                FROM differential
                WHERE stageid = $1
                ORDER BY orden ASC
            `,
            sqlParams: [rpg2.param('plain', phaseId)],
        });

        return results.map((row, index) => ({
            id: row.id,        // The ID of the question
            number: index + 1, // Assign a sequential number to each question
            justify: row.justify,
            range: row.num,
            order: row.orden,
        }));
    },
    ranking: async (phaseId) => {
        const results = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT id
                FROM actors
                WHERE stageid = $1
                ORDER BY id ASC
            `,
            sqlParams: [rpg2.param('plain', phaseId)],
        });

        return results.map((row, index) => ({
            name: row.name,
            id: row.id,        // The ID of the question
        }));
    },
};

// Main function to fetch questions based on design type
async function getQuestionsByPhase(phaseId, type) {
    const handler = questionFetchHandlers[type];
    if (!handler) {
        throw new Error(`Unsupported design type: ${type}`);
    }

    return await handler(phaseId);
}

async function getCachedStudentActivityDescriptor(sessionId, invalidate = false) {
    if (!sessionId || isNaN(Number(sessionId))) {
        throw new Error("Invalid sessionId");
    }

    const cacheKey = `descriptor:${sessionId}`;

    // Check if cache invalidation is requested
    if (invalidate) {
        await redisClient.del(cacheKey);
    } else {
        // Try to retrieve the descriptor from the cache
        const cachedDescriptor = await redisClient.get(cacheKey);
        if (cachedDescriptor) {
            return JSON.parse(cachedDescriptor);
        }
    }

    // Fetch the descriptor from the database
    const descriptor = await getStudentActivityDescriptor(sessionId);

    // Cache the descriptor with a TTL of one hour
    if (descriptor) {
        await redisClient.set(cacheKey, JSON.stringify(descriptor), 'EX', 3600); // TTL: 3600 seconds
    }

    return descriptor;
}

async function getStudentActivityDescriptor(sessionId) {
    if (!sessionId || isNaN(Number(sessionId))) {
        console.error("Invalid sessionId:", sessionId);
        return { descriptor: {} };
    }

    try {
        const descriptorQuery = `
            SELECT 
                s.descr AS description,
                a.design AS design,
                st.number AS currentphasenumber,
                st.id AS currentphaseid
            FROM 
                sessions s
            JOIN 
                activity a ON s.id = a.session
            JOIN 
                stages st ON st.id = s.current_stage
            WHERE 
                s.id = $1;
        `;

        const descriptorResult = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: descriptorQuery,
            sqlParams: [rpg2.param('plain', Number(sessionId))], // Correct usage of rpg2.param
        });

        if (descriptorResult.length === 0) {
            console.warn(`No descriptor found for sessionId ${sessionId}.`);
            return { descriptor: {} };
        }

        const {
            description, 
            design, 
            currentphasenumber: currentPhaseNumber,
            currentphaseid: currentPhaseId
         } = descriptorResult[0];

        return {
            descriptor: {
                description,
                design,
                currentPhaseNumber,
                currentPhaseId
            },
        };
    } catch (error) {
        console.error(
            `Unable to load the activity descriptor for sessionId ${sessionId}:`,
            error
        );
        return { descriptor: {} };
    }
}

/**
 * Wrapper function to get student activity phases with Redis caching.
 * @param {number} sessionId - The session ID.
 * @returns {Promise<Object>} An object containing the phases.
 */
async function getCachedStudentActivityPhases(sessionId, invalidate = false) {
    if (!sessionId || isNaN(Number(sessionId))) {
        console.error("Invalid sessionId:", sessionId);
        return { phases: [] };
    }

    const cacheKey = `session:${sessionId}:phases`;

    try {
        // Handle cache invalidation
        if (invalidate) {
            console.debug(`Invalidating cache for sessionId: ${sessionId}`);
            await redisClient.del(cacheKey);
        } else {
            // Check Redis cache
            const cachedData = await redisClient.get(cacheKey);
            if (cachedData) {
                console.debug(`Cache hit for sessionId: ${sessionId}`);
                return JSON.parse(cachedData);
            }
        }

        // Cache miss or invalidation: Fetch from database
        console.debug(`Cache miss for sessionId: ${sessionId}, querying database.`);
        const { phases } = await getStudentActivityPhases(sessionId);

        // Cache the result
        if (phases) {
            await redisClient.set(cacheKey, JSON.stringify({ phases }), 'EX', 300);
        }

        return { phases };
    } catch (error) {
        console.error(`Error in getCachedStudentActivityPhases for sessionId ${sessionId}:`, error);
        // Fallback to database if cache operation fails
        return await getStudentActivityPhases(sessionId);
    }
}

async function getStudentActivityPhases(sessionId) {
    if (!sessionId || isNaN(Number(sessionId))) {
        console.error("Invalid sessionId:", sessionId);
        return { phases: [] };
    }

    try {
        // Query to get the phases
        const phasesQuery = `
            SELECT
                st.id
                st.number, 
                st.type AS mode, 
                st.anon, 
                st.chat
            FROM 
                stages st
            WHERE 
                st.sesid = $1;
        `;

        const phasesResult = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: phasesQuery,
            sqlParams: [rpg2.param('plain', Number(sessionId))],
        });

        // Transform phases into the desired format
        const phases = phasesResult.map(phase => ({
            id: phase.id,
            number: phase.number,
            features: {
                mode: phase.mode,
                chat: phase.chat,
                anonymity: phase.anon,
            },
            tasks: [], // Placeholder: Add query to retrieve tasks
            responses: [], // Placeholder: Add query to retrieve responses
            peerResponses: [], // Placeholder: Add query to retrieve peer responses
            group: {}, // Placeholder: Add query to retrieve group info
            groupMessages: [], // Placeholder: Add query to retrieve group messages
        }));

        return { phases };
    } catch (error) {
        console.error(`Unable to load the phases for sessionId ${sessionId}:`, error);
        return { phases: [] };
    }
}

/**
 * Wrapper function to cache the result of getStudentActivityGroups.
 * @param {number} sessionId - The session ID.
 * @param {number} userId - The user ID.
 * @param {Array} phases - The phases to integrate group data into.
 * @returns {Promise<Array>} The updated phases with group data.
 */
async function getCachedStudentActivityGroups(sessionId, userId, phases, invalidate = false) {
    if (!sessionId || isNaN(Number(sessionId)) || !userId || isNaN(Number(userId))) {
        console.error("Invalid sessionId or userId:", { sessionId, userId });
        return phases;
    }

    const cacheKey = `session:${sessionId}:user:${userId}:groups`;

    try {
        // Handle cache invalidation
        if (invalidate) {
            console.debug(`Invalidating cache for groups: sessionId=${sessionId}, userId=${userId}`);
            await redisClient.del(cacheKey);
        } else {
            // Check Redis cache
            const cachedData = await redisClient.get(cacheKey);
            if (cachedData) {
                console.debug(`Cache hit for groups: sessionId=${sessionId}, userId=${userId}`);
                const cachedGroups = JSON.parse(cachedData);

                // Attach cached group data to the corresponding phases
                phases.forEach(phase => {
                    const phaseNumber = phase.number;
                    phase.group = cachedGroups[phaseNumber] || { groupId: null, peers: [] };
                });

                return phases;
            }
        }

        // Cache miss or invalidation: Call the original function
        console.debug(`Cache miss for groups: sessionId=${sessionId}, userId=${userId}`);
        const updatedPhases = await getStudentActivityGroups(sessionId, userId, phases);

        // Extract group data from updated phases and cache it
        const groupsByPhase = {};
        updatedPhases.forEach(phase => {
            if (phase.group) {
                groupsByPhase[phase.number] = phase.group;
            }
        });

        // Cache the result in Redis
        await redisClient.set(cacheKey, JSON.stringify(groupsByPhase), 'EX', 3600); // Expiration: 1 hour

        return updatedPhases;
    } catch (error) {
        console.error(`Error in getCachedStudentActivityGroups: sessionId=${sessionId}, userId=${userId}`, error);
        return phases;
    }
}

async function getStudentActivityGroups(sessionId, userId, phases) {
    if (!sessionId || isNaN(Number(sessionId)) || !userId || isNaN(Number(userId))) {
        console.error("Invalid sessionId or userId:", { sessionId, userId });
        return phases;
    }

    try {
        const groupsQuery = `
            SELECT 
                st.number AS phase_number,
                t.id AS group_id,
                u.id AS user_id,
                u.name AS user_name,
                tu.anon_mask AS anonymity_mask
            FROM 
                teamusers tu
            JOIN 
                users u ON tu.uid = u.id
            JOIN 
                teams t ON tu.tmid = t.id
            JOIN 
                stages st ON t.stageid = st.id
            WHERE 
                st.sesid = $1 AND u.id = $2
            ORDER BY 
                st.number, t.id, u.id;
        `;

        const groupsResult = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: groupsQuery,
            sqlParams: [
                rpg2.param('plain', Number(sessionId)),
                rpg2.param('plain', Number(userId))
            ],
        });

        const groupsByPhase = {};
        groupsResult.forEach(row => {
            if (!groupsByPhase[row.phase_number]) {
                groupsByPhase[row.phase_number] = [];
            }

            let group = groupsByPhase[row.phase_number].find(g => g.groupId === row.group_id);
            if (!group) {
                group = { groupId: row.group_id, peers: [] };
                groupsByPhase[row.phase_number].push(group);
            }

            group.peers.push({
                id: row.user_id,
                name: row.user_name,
                anonMask: row.anonymity_mask,
            });
        });

        // Integrate group data into phases
        phases.forEach(phase => {
            const phaseNumber = phase.number;
            phase.group = groupsByPhase[phaseNumber] || { groupId: null, peers: [] };
        });

        return phases;
    } catch (error) {
        console.error("Failed to gather groups and integrate them into the phases:", error);
        return phases;
    }
}

const studentActivityTaskGetters = {
    semantic_differential: getStudentActivityTasks_semanticDifferential,
    ranking: getStudentActivityTasks_ranking
}

async function getCachedStudentActivityTasks(sessionId, phaseNumber, designType, invalidate = false) {
    const cacheKey = `tasks:${sessionId}:${phaseNumber}`;

    try {
        // Handle cache invalidation
        if (invalidate) {
            console.debug(`Invalidating cache for tasks: sessionId=${sessionId}, phaseNumber=${phaseNumber}`);
            await redisClient.del(cacheKey);
        } else {
            // Check Redis cache
            const cachedTasks = await redisClient.get(cacheKey);
            if (cachedTasks) {
                console.debug(`Cache hit for tasks: sessionId=${sessionId}, phaseNumber=${phaseNumber}`);
                return JSON.parse(cachedTasks);
            }
        }

        // Cache miss or invalidation: Fetch tasks from the database
        console.debug(`Cache miss for tasks: sessionId=${sessionId}, phaseNumber=${phaseNumber}`);
        const tasks = await studentActivityTaskGetters[designType](sessionId, [phaseNumber]);

        // Cache the result in Redis
        await redisClient.set(cacheKey, JSON.stringify(tasks), 'EX', 300); // Expiration: 5 minutes

        return tasks;
    } catch (error) {
        console.error(`Error in getCachedStudentActivityTasks: sessionId=${sessionId}, phaseNumber=${phaseNumber}`, error);
        return []; // Fallback to an empty array if there's an error
    }
}

/**
 * Get tasks for a given session and design type.
 * @param {string} designType - The type of instructional design.
 * @param {number} sessionId - The session ID.
 * @param {Array} phases - The phases to attach tasks to.
 * @returns {Promise<Array>} The updated phases with tasks.
 */
async function getStudentActivityTasks(designType, sessionId, phases) {
    const taskGetter = studentActivityTaskGetters[designType];
    if (!taskGetter) {
        console.error(`No task getter defined for design type: ${designType}`);
        return phases;
    }

    try {
        return await taskGetter(sessionId, phases);
    } catch (error) {
        console.error(`Failed to get tasks for design type ${designType}:`, error);
        return phases;
    }
}

/**
 * Retrieve tasks for "semantic_differential" design type.
 * @param {number} sessionId - The session ID.
 * @param {Array} phases - The phases to attach tasks to.
 * @returns {Promise<Array>} The updated phases with tasks.
 */
async function getStudentActivityTasks_semanticDifferential(sessionId, phases) {
    const query = `
        SELECT
            st.number as phase_number, 
            d.stageid AS phase_id,
            d.id AS task_id,
            d.title AS task_title,
            d.tleft AS left_pole,
            d.tright AS right_pole,
            d.orden AS order,
            d.justify AS requires_justification,
            d.num AS num_values,
            d.word_count AS min_word_count
        FROM 
            differential d
        JOIN
            stages st
        ON
            d.stageid = st.id
        WHERE 
            d.sesid = $1;
    `;

    try {
        const results = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: query,
            sqlParams: [rpg2.param("plain", Number(sessionId))],
        });

        const tasksByPhase = {};
        results.forEach(task => {
            if (!tasksByPhase[task.phase_number]) {
                tasksByPhase[task.phase_number] = [];
            }

            tasksByPhase[task.phase_number].push({
                id: task.task_id,
                title: task.task_title,
                leftPole: task.left_pole,
                rightPole: task.right_pole,
                order: task.order,
                requiresJustification: task.requires_justification,
                numValues: task.num_values,
                minWordCount: task.min_word_count,
            });
        });

        phases.forEach(phase => {
            phase.tasks = tasksByPhase[phase.number] || [];
        });

        return phases;
    } catch (error) {
        console.error("Failed to retrieve semantic differential tasks:", error);
        return phases;
    }
}

/**
 * Retrieve tasks for "ranking" design type.
 * @param {number} sessionId - The session ID.
 * @param {Array} phases - The phases to attach tasks to.
 * @returns {Promise<Array>} The updated phases with tasks.
 */
async function getStudentActivityTasks_ranking(sessionId, phases) {
    const query = `
                    SELECT
                        st.number AS phase_number,
                        a.stageid AS phase_id,
                        a.id AS actor_id,
                        a.name AS actor_name,
                        a.jorder AS is_ordered,
                        a.justified AS requires_justification,
                        a.word_count AS min_word_count
                    FROM 
                        actors a
                    JOIN
                        stages st
                    ON
                        st.id = a.stageid
                    WHERE 
                        st.sesid = $1;
                    `;

    try {
        const results = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: query,
            sqlParams: [rpg2.param("plain", Number(sessionId))],
        });

        const tasksByPhase = {};
        results.forEach(actor => {
            if (!tasksByPhase[actor.phase_number]) {
                tasksByPhase[actor.phase_number] = [];
            }

            tasksByPhase[actor.phase_number].push({
                id: actor.actor_id,
                name: actor.actor_name,
                isOrdered: actor.is_ordered,
                requiresJustification: actor.requires_justification,
                minWordCount: actor.min_word_count,
            });
        });

        phases.forEach(phase => {
            phase.tasks = tasksByPhase[phase.number] || [];
        });

        return phases;
    } catch (error) {
        console.error("Failed to retrieve ranking tasks:", error);
        return phases;
    }
}

const studentActivityResponseGetters = {
    semantic_differential: getStudentActivityResponses_semanticDifferential,
    ranking: getStudentActivityResponses_ranking,
};

async function getCachedStudentActivityResponses(sessionId, phaseNumber, userId, designType, invalidate = false) {
    const cacheKey = `responses:${sessionId}:${phaseNumber}:${userId}`;

    try {
        // Handle cache invalidation
        if (invalidate) {
            console.debug(`Invalidating cache for responses: sessionId=${sessionId}, phaseNumber=${phaseNumber}, userId=${userId}`);
            await redisClient.del(cacheKey);
        } else {
            // Check Redis cache
            const cachedResponses = await redisClient.get(cacheKey);
            if (cachedResponses) {
                console.debug(`Cache hit for responses: sessionId=${sessionId}, phaseNumber=${phaseNumber}, userId=${userId}`);
                return JSON.parse(cachedResponses);
            }
        }

        // Cache miss or invalidation: Fetch responses from the database
        console.debug(`Cache miss for responses: sessionId=${sessionId}, phaseNumber=${phaseNumber}, userId=${userId}`);
        const responses = await studentActivityResponseGetters[designType](sessionId, userId, [phaseNumber]);

        // Cache the result in Redis
        await redisClient.set(cacheKey, JSON.stringify(responses), 'EX', 300); // Expiration: 5 minutes

        return responses;
    } catch (error) {
        console.error(`Error in getCachedStudentActivityResponses: sessionId=${sessionId}, phaseNumber=${phaseNumber}, userId=${userId}`, error);
        return []; // Fallback to an empty array if there's an error
    }
}

/**
 * Retrieve student responses based on the design type.
 * @param {string} designType - The type of instructional design.
 * @param {number} sessionId - The session ID.
 * @param {number} userId - The user ID.
 * @param {Array} phases - The phases to attach responses to.
 * @returns {Promise<Array>} The updated phases with responses.
 */
async function getStudentActivityResponses(designType, sessionId, userId, phases) {
    const responseGetter = studentActivityResponseGetters[designType];
    if (!responseGetter) {
        console.error(`No response getter defined for design type: ${designType}`);
        return phases;
    }

    try {
        return await responseGetter(sessionId, userId, phases);
    } catch (error) {
        console.error(`Failed to get responses for design type ${designType}:`, error);
        return phases;
    }
}

/**
 * Retrieve student responses for "semantic_differential" design type.
 * @param {number} sessionId - The session ID.
 * @param {number} userId - The user ID.
 * @param {Array} phases - The phases to attach responses to.
 * @returns {Promise<Array>} The updated phases with responses.
 */
async function getStudentActivityResponses_semanticDifferential(sessionId, userId, phases) {
    const query = `
        SELECT
            st.number AS phase_number,
            ds.did AS task_id,
            ds.sel AS selection,
            ds.comment AS justification,
            ds.stime AS timestamp,
            d.stageid AS phase_id
        FROM 
            differential_selection ds
        JOIN 
            differential d ON ds.did = d.id
        JOIN
            stages st ON st.id = d.stageid
        WHERE 
            ds.uid = $1
            AND d.sesid = $2;
    `;

    try {
        const results = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: query,
            sqlParams: [
                rpg2.param("plain", Number(userId)),
                rpg2.param("plain", Number(sessionId)),
            ],
        });

        const responsesByPhase = {};
        results.forEach(response => {
            if (!responsesByPhase[response.phase_number]) {
                responsesByPhase[response.phase_number] = [];
            }

            responsesByPhase[response.phase_number].push({
                taskId: response.task_id,
                selection: response.selection,
                justification: response.justification,
                timestamp: response.timestamp,
            });
        });

        phases.forEach(phase => {
            phase.responses = responsesByPhase[phase.number] || [];
        });

        return phases;
    } catch (error) {
        console.error("Failed to retrieve semantic differential responses:", error);
        return phases;
    }
}

/**
 * Retrieve student responses for "ranking" design type.
 * @param {number} sessionId - The session ID.
 * @param {number} userId - The user ID.
 * @param {Array} phases - The phases to attach responses to.
 * @returns {Promise<Array>} The updated phases with responses.
 */
async function getStudentActivityResponses_ranking(sessionId, userId, phases) {
    const query = `
        SELECT 
            st.number AS phase_number,
            asel.actorid AS actor_id,
            asel.orden AS order,
            asel.description AS description,
            asel.stime AS timestamp,
            a.stageid AS phase_id
        FROM 
            actor_selection asel
        JOIN 
            actors a ON asel.actorid = a.id
        JOIN
            stages st ON st.id = a.stageid
        WHERE 
            asel.uid = $1
            AND a.stageid IN (
                SELECT id FROM stages WHERE sesid = $2
            );
    `;

    try {
        const results = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: query,
            sqlParams: [
                rpg2.param("plain", Number(userId)),
                rpg2.param("plain", Number(sessionId)),
            ],
        });

        const responsesByPhase = {};
        results.forEach(response => {
            if (!responsesByPhase[response.phase_number]) {
                responsesByPhase[response.phase_number] = [];
            }

            responsesByPhase[response.phase_number].push({
                actorId: response.actor_id,
                order: response.order,
                description: response.description,
                timestamp: response.timestamp,
            });
        });

        phases.forEach(phase => {
            phase.responses = responsesByPhase[phase.number] || [];
        });

        return phases;
    } catch (error) {
        console.error("Failed to retrieve ranking responses:", error);
        return phases;
    }
}

const studentActivityPeerResponseGetters = {
    semantic_differential: getStudentActivityPeerResponses_semanticDifferential,
    ranking: getStudentActivityPeerResponses_ranking,
};

/**
 * Wrapper function to get student activity peer responses with Redis caching.
 * @param {string} designType - The type of instructional design.
 * @param {number} sessionId - The session ID.
 * @param {number} userId - The user ID.
 * @param {Array} phases - The phases to attach peer responses to.
 * @returns {Promise<Array>} The updated phases with peer responses.
 */
async function getCachedStudentActivityPeerResponses(designType, sessionId, userId, phases, invalidate = false) {
    if (!sessionId || isNaN(Number(sessionId)) || !userId || isNaN(Number(userId))) {
        console.error("Invalid sessionId or userId:", { sessionId, userId });
        return phases;
    }

    const cacheKey = `session:${sessionId}:user:${userId}:peer_responses:${designType}`;

    try {
        // Handle cache invalidation
        if (invalidate) {
            console.debug(`Invalidating cache for peer responses: sessionId=${sessionId}, userId=${userId}, designType=${designType}`);
            await redisClient.del(cacheKey);
        } else {
            // Check Redis cache
            const cachedData = await redisClient.get(cacheKey);
            if (cachedData) {
                console.debug(`Cache hit for peer responses: sessionId=${sessionId}, userId=${userId}, designType=${designType}`);
                const peerResponsesByPhase = JSON.parse(cachedData);

                // Attach cached responses to the corresponding phases
                phases.forEach(phase => {
                    phase.peerResponses = peerResponsesByPhase[phase.number] || [];
                });

                return phases;
            }
        }

        // Fetch peer responses from the database
        console.debug(`Cache miss for peer responses: sessionId=${sessionId}, userId=${userId}, designType=${designType}`);
        const peerResponsesByPhase = await studentActivityPeerResponseGetters[designType](sessionId, userId);

        // Cache the result
        await redisClient.set(cacheKey, JSON.stringify(peerResponsesByPhase), {
            EX: 300,
        });

        // Attach responses to the corresponding phases
        phases.forEach(phase => {
            phase.peerResponses = peerResponsesByPhase[phase.number] || [];
        });

        return phases;
    } catch (error) {
        console.error(`Error in getCachedStudentActivityPeerResponses: sessionId=${sessionId}, userId=${userId}, designType=${designType}`, error);
        // Fallback to no peer responses if caching or database fails
        phases.forEach(phase => {
            phase.peerResponses = [];
        });
        return phases;
    }
}

/**
 * Retrieve peer responses based on the design type.
 * @param {string} designType - The type of instructional design.
 * @param {number} sessionId - The session ID.
 * @param {number} userId - The user ID.
 * @param {Array} phases - The phases to attach peer responses to.
 * @returns {Promise<Array>} The updated phases with peer responses.
 */
async function getStudentActivityPeerResponses(designType, sessionId, userId, phases) {
    const peerResponseGetter = studentActivityPeerResponseGetters[designType];
    if (!peerResponseGetter) {
        console.error(`No peer response getter defined for design type: ${designType}`);
        return phases;
    }

    try {
        const peerResponsesByPhase = await peerResponseGetter(sessionId, userId);

        // Attach peer responses to the corresponding phases
        phases.forEach(phase => {
            phase.peerResponses = peerResponsesByPhase[phase.number] || [];
        });

        return phases;
    } catch (error) {
        console.error(`Failed to get peer responses for design type ${designType}:`, error);
        return phases;
    }
}

/**
 * Retrieve peer responses for "semantic_differential" design.
 */
async function getStudentActivityPeerResponses_semanticDifferential(sessionId, userId) {
    try {
        const query = `
            SELECT 
                st.number AS phase_number,
                ds.did AS task_id,
                ds.sel AS selection,
                ds.comment AS justification,
                ds.stime AS timestamp,
                d.stageid AS phase_id,
                tu.uid AS peer_id,
                u.name AS peer_name,
                tu.anon_mask AS peer_anonymity
            FROM 
                teamusers tu
            JOIN 
                users u ON tu.uid = u.id
            JOIN 
                teams t ON tu.tmid = t.id
            JOIN 
                stages st ON t.stageid = st.id
            JOIN 
                differential_selection ds ON ds.uid = tu.uid
            JOIN 
                differential d ON ds.did = d.id
            WHERE 
                st.sesid = $1
                AND ds.uid != $2
                AND tu.tmid IN (
                    SELECT tmid 
                    FROM teamusers 
                    WHERE uid = $2
                )
            ORDER BY 
                st.number, ds.did;
        `;

        const results = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: query,
            sqlParams: [
                rpg2.param('plain', Number(sessionId)),
                rpg2.param('plain', Number(userId)),
            ],
        });

        const peerResponsesByPhase = {};
        results.forEach(row => {
            if (!peerResponsesByPhase[row.phase_number]) {
                peerResponsesByPhase[row.phase_number] = [];
            }

            peerResponsesByPhase[row.phase_number].push({
                taskId: row.task_id,
                selection: row.selection,
                justification: row.justification,
                timestamp: row.timestamp,
                peer: {
                    id: row.peer_id,
                    name: row.peer_name,
                    anonMask: row.peer_anonymity,
                },
            });
        });

        return peerResponsesByPhase;
    } catch (error) {
        console.error("Failed to retrieve peer responses for semantic_differential:", error);
        return {};
    }
}

/**
 * Retrieve peer responses for "ranking" design.
 */
async function getStudentActivityPeerResponses_ranking(sessionId, userId) {
    try {
        const query = `
            SELECT
                st.number AS phase_number,
                asel.actorid AS task_id,
                asel.orden AS rank_order,
                asel.description AS justification,
                asel.stime AS timestamp,
                asel.stageid AS phase_id,
                tu.uid AS peer_id,
                u.name AS peer_name,
                tu.anon_mask AS peer_anonymity
            FROM 
                teamusers tu
            JOIN 
                users u ON tu.uid = u.id
            JOIN 
                teams t ON tu.tmid = t.id
            JOIN 
                stages st ON t.stageid = st.id
            JOIN 
                actor_selection asel ON asel.uid = tu.uid
            WHERE 
                st.sesid = $1
                AND asel.uid != $2
                AND tu.tmid IN (
                    SELECT tmid 
                    FROM teamusers 
                    WHERE uid = $2
                )
            ORDER BY 
                st.number, asel.actorid;
        `;

        const results = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: query,
            sqlParams: [
                rpg2.param('plain', Number(sessionId)),
                rpg2.param('plain', Number(userId)),
            ],
        });

        const peerResponsesByPhase = {};
        results.forEach(row => {
            if (!peerResponsesByPhase[row.phase_number]) {
                peerResponsesByPhase[row.phase_number] = [];
            }

            peerResponsesByPhase[row.phase_number].push({
                taskId: row.task_id,
                rankOrder: row.rank_order,
                justification: row.justification,
                timestamp: row.timestamp,
                peer: {
                    id: row.peer_id,
                    name: row.peer_name,
                    anonMask: row.peer_anonymity,
                },
            });
        });

        return peerResponsesByPhase;
    } catch (error) {
        console.error("Failed to retrieve peer responses for ranking:", error);
        return {};
    }
}

const studentActivityGroupMessageGetters = {
    semantic_differential: getStudentActivityGroupMessages_semanticDifferential,
    ranking: getStudentActivityGroupMessages_ranking
};

async function getCachedStudentActivityGroupMessages(sessionId, phaseNumber, groupId, designType, invalidate = false) {
    if (!sessionId || isNaN(Number(sessionId)) || !phaseNumber || isNaN(Number(phaseNumber)) || !groupId || isNaN(Number(groupId))) {
        console.error("Invalid sessionId, phaseNumber, or groupId:", { sessionId, phaseNumber, groupId });
        return [];
    }

    const cacheKey = `chatMessages:${sessionId}:${phaseNumber}:${groupId}`;

    try {
        // Handle cache invalidation
        if (invalidate) {
            console.debug(`Invalidating cache for chat messages: sessionId=${sessionId}, phaseNumber=${phaseNumber}, groupId=${groupId}`);
            await redisClient.del(cacheKey);
        } else {
            // Check Redis cache
            const cachedMessages = await redisClient.get(cacheKey);
            if (cachedMessages) {
                console.debug(`Cache hit for chat messages: sessionId=${sessionId}, phaseNumber=${phaseNumber}, groupId=${groupId}`);
                return JSON.parse(cachedMessages);
            }
        }

        // Fetch messages from the database
        console.debug(`Cache miss for chat messages: sessionId=${sessionId}, phaseNumber=${phaseNumber}, groupId=${groupId}`);
        const messages = await studentActivityGroupMessageGetters[designType](sessionId, groupId, [phaseNumber]);

        // Cache the result
        await redisClient.set(cacheKey, JSON.stringify(messages), {
            EX: 300,
        });

        return messages;
    } catch (error) {
        console.error(`Error in getCachedStudentActivityGroupMessages: sessionId=${sessionId}, phaseNumber=${phaseNumber}, groupId=${groupId}, designType=${designType}`, error);
        return [];
    }
}

async function getStudentActivityGroupMessages(designType, sessionId, userId, phases) {
    const groupMessageGetter = studentActivityGroupMessageGetters[designType];
    if (!groupMessageGetter) {
        console.error(`No group message getter defined for design type: ${designType}`);
        return phases;
    }

    try {
        return await groupMessageGetter(sessionId, userId, phases);
    } catch (error) {
        console.error(`Failed to get group messages for design type ${designType}:`, error);
        return phases;
    }
}

/**
 * Retrieve group messages for semantic differential design based on user ID.
 * @param {number} sessionId - The session ID.
 * @param {number} userId - The user ID.
 * @param {Array} phases - The phases to attach messages to.
 * @returns {Promise<Array>} The updated phases with group messages.
 */
async function getStudentActivityGroupMessages_semanticDifferential(sessionId, userId, phases) {
    try {
        const messagesQuery = `
            SELECT
                st.number AS phase_number,
                dc.did AS task_id,
                dc.id AS message_id,
                dc.uid AS peer_id,
                dc.content AS message,
                dc.parent_id
            FROM 
                differential_chat dc
            JOIN 
                differential d ON dc.did = d.id
            JOIN 
                stages st ON d.stageid = st.id
            JOIN 
                teams t ON st.id = t.stageid
            JOIN 
                teamusers tu ON t.id = tu.tmid
            WHERE 
                st.sesid = $1
                AND tu.uid = $2
            ORDER BY 
                st.number, dc.did, dc.id;
        `;

        const messagesResult = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: messagesQuery,
            sqlParams: [
                rpg2.param('plain', Number(sessionId)),
                rpg2.param('plain', Number(userId))
            ],
        });

        // Group messages by phase and task
        const messagesByPhaseAndTask = {};
        messagesResult.forEach(row => {
            if (!messagesByPhaseAndTask[row.phase_number]) {
                messagesByPhaseAndTask[row.phase_number] = {};
            }
            if (!messagesByPhaseAndTask[row.phase_number][row.task_id]) {
                messagesByPhaseAndTask[row.phase_number][row.task_id] = [];
            }
            messagesByPhaseAndTask[row.phase_number][row.task_id].push({
                peerId: row.peer_id,
                messageId: row.message_id,
                message: row.message,
                parentId: row.parent_id
            });
        });

        // Attach messages to corresponding phases
        phases.forEach(phase => {
            phase.groupMessages = [];
            const phaseMessages = messagesByPhaseAndTask[phase.number] || {};
            phase.tasks.forEach(task => {
                const taskMessages = phaseMessages[task.id] || [];
                phase.groupMessages.push({
                    taskId: task.id,
                    messages: taskMessages
                });
            });
        });

        return phases;
    } catch (error) {
        console.error("Failed to retrieve semantic differential group messages:", error);
        return phases;
    }
}

/**
 * Retrieve group messages for ranking design based on user ID.
 * @param {number} sessionId - The session ID.
 * @param {number} userId - The user ID.
 * @param {Array} phases - The phases to attach messages to.
 * @returns {Promise<Array>} The updated phases with group messages.
 */
async function getStudentActivityGroupMessages_ranking(sessionId, userId, phases) {
    try {
        const messagesQuery = `
            SELECT 
                st.number AS phase_number,
                c.stageid AS phase_id,
                c.id AS message_id,
                c.uid AS peer_id,
                c.content AS message,
                c.parent_id
            FROM 
                chat c
            JOIN 
                stages st ON c.stageid = st.id
            JOIN 
                teams t ON st.id = t.stageid
            JOIN 
                teamusers tu ON t.id = tu.tmid
            WHERE 
                st.sesid = $1
                AND tu.uid = $2
            ORDER BY 
                st.number, c.stageid, c.id;
        `;

        const messagesResult = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: messagesQuery,
            sqlParams: [
                rpg2.param('plain', Number(sessionId)),
                rpg2.param('plain', Number(userId))
            ],
        });

        // Group messages by phase and task
        const messagesByPhaseAndTask = {};
        messagesResult.forEach(row => {
            if (!messagesByPhaseAndTask[row.phase_number]) {
                messagesByPhaseAndTask[row.phase_number] = {};
            }
            if (!messagesByPhaseAndTask[row.phase_number][row.phase_id]) {
                messagesByPhaseAndTask[row.phase_number][row.phase_id] = [];
            }
            messagesByPhaseAndTask[row.phase_number][row.phase_id].push({
                peerId: row.peer_id,
                messageId: row.message_id,
                message: row.message,
                parentId: row.parent_id
            });
        });

        // Attach messages to corresponding phases
        phases.forEach(phase => {
            phase.groupMessages = [];
            const phaseMessages = messagesByPhaseAndTask[phase.number] || {};
            phase.tasks.forEach(task => {
                const taskMessages = phaseMessages[task.id] || [];
                phase.groupMessages.push({
                    taskId: task.id,
                    messages: taskMessages
                });
            });
        });

        return phases;
    } catch (error) {
        console.error("Failed to retrieve ranking group messages:", error);
        return phases;
    }
}

export default router;