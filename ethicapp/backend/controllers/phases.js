"use strict";

import express from "express";
import * as config from "../config/config.js"; 
import * as rpg2 from "../db/rest-pg-2.js";
import * as SessionsHelper from "../helpers/sessions-helper.js"
import * as DesignTypes from "../../common/modules/design-types.js";

const router = express.Router();

const phaseResponsesFetchHandlers = {
    semantic_differential: fetchSemanticDifferentialResponsesByPhase,
    ranking: fetchRankingResponsesByPhase,
};

const phaseStudentResponsesFetchHandlers = {
    semantic_differential: fetchSemanticDifferentialStudentResponsesByPhase,
    ranking: fetchRankingStudentResponsesByPhase,
};

const phaseCreationHandlers = {
    semantic_differential: addSemanticDifferentialItem,
    ranking: addRankingItem,
};

const phaseResponseSubmissionHandlers = {
    handleRankingResponse: handleSemanticDifferentialResponse,
    ranking: handleRankingResponse,
};

const designStatistics = {
    semantic_differential: computeSemanticDifferentialStats,
    ranking: computeRankingStats,
};

/**
 * @route GET /phases/:id/responses
 * @description Retrieves all responses for a given phase (stage) based on its design type.
 *              The logic to fetch responses is determined dynamically based on the phase's design type.
 * @param {string} id - The ID of the phase (from the URL path).
 * @returns {Object} - A JSON object containing the responses for the phase.
 * 
 * @example
 * // Request
 * GET /phases/123/responses
 * 
 * // Response (success)
 * {
 *   "responses": [
 *     {
 *       "uid": 45,
 *       "response_detail": "Example response data"
 *     },
 *     {
 *       "uid": 67,
 *       "response_detail": "Another response"
 *     }
 *   ]
 * }
 * 
 * // Response (missing required parameter)
 * {
 *   "error": "Missing required parameter: id."
 * }
 * 
 * // Response (unsupported design type)
 * {
 *   "error": "Unsupported design type: example_type."
 * }
 * 
 * // Response (no responses found)
 * {
 *   "error": "No responses found for the given phase."
 * }
 * 
 * // Response (internal server error)
 * {
 *   "error": "Internal server error."
 * }
 */
router.get("/phases/:id/responses", async (req, res) => {
    const { id } = req.params;

    if (!id) {
        return res.status(400).json({ error: "Missing required parameter: id" });
    }

    try {
        // Determine the design type for the stage
        const designType = await getDesignTypeByPhaseId(id);

        // Fetch responses using the appropriate handler
        const handler = phaseResponsesFetchHandlers[designType];
        if (!handler) {
            return res.status(400).json({ error: `Unsupported design type: ${designType}` });
        }

        const results = await handler(id);

        if (results.length === 0) {
            return res.status(404).json({ error: "No responses found for the given phase." });
        }

        res.status(200).json({ responses: results });
    } catch (err) {
        console.error("Error fetching phase responses:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.get("/phases/:id/responses/:user_id", async (req, res) => {
    const { id, user_id } = req.params;

    if (!id || !user_id) {
        return res.status(400).json({ error: "Missing required parameter, either id or user_id." });
    }

    try {
        // Determine the design type for the stage
        const designType = await getDesignTypeByPhaseId(id);

        // Fetch responses using the appropriate handler
        const handler = phaseStudentResponsesFetchHandlers[designType];
        if (!handler) {
            return res.status(400).json({ error: `Unsupported design type: ${designType}` });
        }

        const results = await handler(id);

        if (results.length === 0) {
            return res.status(404).json({ error: "No responses found for the given phase." });
        }

        res.status(200).json({ responses: results });
    } catch (err) {
        console.error("Error fetching phase responses:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.get("/phases/:id/stats", async (req, res) => {
    const { id: phaseId } = req.params;

    try {
        // Retrieve the design associated with the phase
        const designResult = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT d.design
                FROM designs d
                INNER JOIN activity a ON d.id = a.design
                INNER JOIN stages s ON a.session = s.sesid
                WHERE s.id = $1
            `,
            sqlParams: [rpg2.param('plain', phaseId)],
        });

        if (designResult.length === 0) {
            return res.status(404).json({ error: "Design not found for the specified phase." });
        }

        const design = designResult[0].design;
        const designType = design.type;

        // Validate if the design type has a corresponding statistics function
        const computeStats = designStatistics[designType];
        if (!computeStats) {
            return res.status(400).json({ error: `Unsupported design type: ${designType}` });
        }

        // Get the number of students in the session
        const studentsResult = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT COUNT(*) AS student_count
                FROM sesusers su
                INNER JOIN users u ON su.uid = u.id
                WHERE su.sesid = (SELECT sesid FROM stages WHERE id = $1)
                AND u.role = 'A'
            `,
            sqlParams: [rpg2.param('plain', phaseId)],
        });

        const expectedResponsesPerQuestion = Number(studentsResult[0].student_count);

        // Compute response statistics for the phase
        const responseStats = await computeStats(phaseId);

        // Return the statistics as JSON
        res.status(200).json({
            expectedResponsesPerQuestion,
            responseStats,
        });
    } catch (error) {
        console.error("Error retrieving phase statistics:", error);
        res.status(500).json({ error: "An error occurred while retrieving phase statistics." });
    }
});

router.post("/phases/:id/responses", async (req, res) => {
    const { id: phaseId } = req.params; // Phase (stage) ID
    const { response } = req.body; // Array of responses (for ranking, an array of actors with their ranks)

    if (!phaseId || !response || !Array.isArray(response)) {
        return res.status(400).json({
            error: "Missing required parameters: id or responses, or responses is not an array.",
        });
    }

    try {
        // Get the session Id
        const sessionId = await SessionsHelper.getSessionIdByPhaseId(phaseId);

        // Determine the design type for the phase
        const designType = await getDesignTypeByPhaseId(phaseId);

        // Fetch the appropriate handler
        const handler = phaseResponseSubmissionHandlers[designType];
        if (!handler) {
            return res.status(400).json({ error: `Unsupported design type: ${designType}` });
        }

        const notificationEmitter = req.app.locals.toTeacherNotifications;

        // Execute the handler
        await handler(sessionId, phaseId, req.session.uid, response, notificationEmitter);

        res.status(201).json({
            status: "ok",
            message: "Responses submitted successfully.",
        });
    } catch (err) {
        console.error("Error submitting responses:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

/**
 * @route POST /phases/:id/items
 * @description Adds an item to a phase (stage). The behavior and data structure depend on the phase's design type.
 *              The appropriate handler for the design type is dynamically selected.
 * @param {string} id - The ID of the phase (stage) (from the URL path).
 * @param {Object} payload - The details of the item to be added (from the request body).
 * @returns {Object} - A JSON object indicating the success or failure of the operation.
 * 
 * @example
 * // Request (for semantic_differential phase)
 * POST /phases/123/items
 * {
 *   "name": "Semantic Differential Example",
 *   "tleft": "Strongly Disagree",
 *   "tright": "Strongly Agree",
 *   "orden": 1,
 *   "num": 5,
 *   "justified": true,
 *   "word_count": 50
 * }
 * 
 * // Request (for ranking phase)
 * POST /phases/123/items
 * {
 *   "name": "Ranked Choice Example",
 *   "orden": 1,
 *   "justified": false,
 *   "word_count": 30
 * }
 * 
 * // Response (success)
 * {
 *   "status": "ok",
 *   "message": "Item added successfully."
 * }
 * 
 * // Response (missing required parameter)
 * {
 *   "error": "Missing required parameter: id."
 * }
 * 
 * // Response (unsupported design type)
 * {
 *   "error": "Unsupported design type: example_type."
 * }
 * 
 * // Response (internal server error)
 * {
 *   "error": "Internal server error."
 * }
 */
router.post("/phases/:id/items", async (req, res) => {
    const { id } = req.params; // Phase (stage) ID
    const payload = req.body; // Item details from the request body

    const userId = req.session?.uid;

    if (!userId) {
        return res.status(401).json({ status: "err", message: "Unauthorized" });
    }

    if (!id) {
        return res.status(400).json({ error: "Missing required parameter: id." });
    }

    try {
        // Determine the design type for the phase
        const designType = await getDesignTypeByPhaseId(id);

        // Find the handler for the design type
        const handler = phaseCreationHandlers[designType];
        if (!handler) {
            return res.status(400).json({ error: `Unsupported design type: ${designType}` });
        }

        // Execute the appropriate handler
        await handler({ userId, stageId: id, ...payload });

        res.status(201).json({ status: "ok", message: "Item added successfully." });
    } catch (err) {
        console.error("Error adding item to phase:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

/**
 * Fetches responses for semantic_differential activities in a specific phase (stage).
 * This query retrieves responses grouped by stage and includes details such as user IDs, team IDs,
 * selections, and comments. It focuses on responses within a single stage.
 * 
 * @async
 * @function fetchSemanticDifferentialResponsesByPhase
 * @param {string} phaseId - The ID of the phase (stage) for which to fetch responses.
 * @returns {Promise<Array>} - Resolves with an array of response objects, each containing:
 *   - `stageid`: The ID of the stage (phase).
 *   - `orden`: The order of the item.
 *   - `uid`: The user ID of the respondent.
 *   - `tmid`: The team ID of the respondent (if applicable).
 *   - `did`: The differential ID of the item.
 *   - `sel`: The user's selection.
 *   - `comment`: Any comment associated with the response.
 * 
 * @throws {Error} If the SQL query fails.
 * 
 * @example
 * // Usage
 * const responses = await fetchSemanticDifferentialResponsesByStage('456');
 * console.log(responses);
 * 
 * // Example response
 * [
 *   {
 *     "stageid": 2,
 *     "orden": 1,
 *     "uid": 101,
 *     "tmid": 7,
 *     "did": 501,
 *     "sel": "Agree",
 *     "comment": "Interesting choice"
 *   },
 *   {
 *     "stageid": 2,
 *     "orden": 2,
 *     "uid": 102,
 *     "tmid": 8,
 *     "did": 502,
 *     "sel": "Neutral",
 *     "comment": null
 *   }
 * ]
 */
async function fetchSemanticDifferentialResponsesByPhase(phaseId) {
    const results = await rpg2.execSQL({
        sql: `
            SELECT d.stageid,
                   d.orden,
                   s.uid,
                   r.tmid,
                   s.did,
                   s.sel,
                   s.comment
            FROM differential_selection AS s
            INNER JOIN differential AS d
                ON s.did = d.id
            LEFT JOIN (
                SELECT tu.*
                FROM teamusers AS tu
                INNER JOIN teams AS t
                    ON tu.tmid = t.id
                    AND t.stageid = $1
            ) AS r
                ON r.uid = s.uid
            WHERE d.stageid = $2
            ORDER BY d.stageid, s.uid, d.orden
        `,
        dbcon: config.dbconnString,
        sqlParams: [rpg2.param('plain', phaseId), 
            rpg2.param('plain', phaseId)],
    });

    return results;
}

/**
 * Fetches responses for ranking activities in a specific phase (stage).
 * This query retrieves data related to user rankings, including item descriptions, order, and user selections,
 * focusing on responses within a single stage.
 * 
 * @async
 * @function fetchRankingResponsesByPhase
 * @param {string} phaseId - The ID of the phase (stage) for which to fetch ranking responses.
 * @returns {Promise<Array>} - Resolves with an array of response objects, each containing:
 *   - `id`: The ID of the ranking item.
 *   - `description`: The description of the ranking item.
 *   - `orden`: The order in which the item was ranked.
 *   - `actorid`: The ID of the actor or choice being ranked.
 *   - `uid`: The user ID of the respondent.
 * 
 * @throws {Error} If the SQL query fails.
 * 
 * @example
 * // Usage
 * const responses = await fetchRankingResponsesByStage('456');
 * console.log(responses);
 * 
 * // Example response
 * [
 *   {
 *     "id": 1,
 *     "description": "Rank Item 1",
 *     "orden": 1,
 *     "actorid": 101,
 *     "uid": 201
 *   },
 *   {
 *     "id": 2,
 *     "description": "Rank Item 2",
 *     "orden": 2,
 *     "actorid": 102,
 *     "uid": 202
 *   }
 * ]
 */
async function fetchRankingResponsesByPhase(phaseId) {
    const results = await rpg2.execSQL({
        sql: `
            SELECT id,
                   description,
                   orden,
                   actorid,
                   uid
            FROM actor_selection
            WHERE stageid = $1
            ORDER BY uid, orden
        `,
        dbcon: config.dbconnString,
        sqlParams: [rpg2.param('plain', phaseId)],
    });

    return results;
}

/**
 * Retrieves a student's responses to semantic differential questions in a given phase.
 * 
 * @param {number} phaseId - The ID of the phase (stage) in the database.
 * @param {number} userId - The ID of the student whose responses are to be retrieved.
 * @returns {Promise<Array<Object>>} - A list of responses including question and answer details.
 * @throws {Error} - Throws an error if the database query fails.
 */
async function fetchSemanticDifferentialStudentResponsesByPhase(phaseId, userId) {
    const results = await rpg2.execSQL({
        dbcon: config.dbconnString,
        sql: `
            SELECT d.stageid,
                   d.orden,
                   s.uid,
                   s.did,
                   s.sel,
                   s.comment
            FROM differential_selection AS s
            INNER JOIN differential AS d
                ON s.did = d.id
            WHERE d.stageid = $1
              AND s.uid = $2
            ORDER BY d.orden
        `,
        sqlParams: [rpg2.param('plain', phaseId), 
            rpg2.param('plain', userId)],
    });

    return results;
}

/**
 * Retrieves a student's ranking responses for a given phase.
 * 
 * @param {number} phaseId - The ID of the phase (stage) in the database.
 * @param {number} userId - The ID of the student whose responses are to be retrieved.
 * @returns {Promise<Array<Object>>} - A list of ranking responses for the student.
 * @throws {Error} - Throws an error if the database query fails.
 */
async function fetchRankingStudentResponsesByPhase(phaseId, userId) {
    const results = await rpg2.execSQL({
        sql: `
            SELECT id,
                   description,
                   orden,
                   actorid,
                   uid
            FROM actor_selection
            WHERE stageid = $1
              AND uid = $2
            ORDER BY orden
        `,
        dbcon: config.dbconnString,
        sqlParams: [rpg2.param('plain', phaseId), 
            rpg2.param('plain', userId)],
    });

    return results;
}

/**
 * Adds a new item to a semantic_differential phase.
 * This function inserts a new semantic_differential item into the `differential` table, associating it with a specific phase (stage).
 * 
 * @async
 * @function addSemanticDifferentialItem
 * @param {Object} params - The parameters for the new item.
 * @param {string} params.stageId - The ID of the phase (stage) to which the item belongs.
 * @param {string} params.name - The title of the item.
 * @param {string} params.tleft - The left pole text for the item.
 * @param {string} params.tright - The right pole text for the item.
 * @param {number} params.orden - The order of the item in the phase.
 * @param {number} params.num - The number of possible values for the item.
 * @param {boolean} params.justify - Whether justification is required for the item.
 * @param {number} params.wordCount - The word count limit for justification.
 * @returns {Promise<void>} - Resolves when the item is successfully added.
 * 
 * @throws {Error} If the SQL query fails.
 * 
 * @example
 * // Usage
 * await addSemanticDifferentialItem({
 *   stageId: '456',
 *   name: 'Example Item',
 *   tleft: 'Strongly Disagree',
 *   tright: 'Strongly Agree',
 *   orden: 1,
 *   num: 7,
 *   justify: true,
 *   word_count: 50
 * });
 * 
 * // Inserts an item with the provided parameters into the database.
 */
async function addSemanticDifferentialItem({
    sessionId,
    userId,
    stageId,
    name,
    tleft,
    tright,
    orden,
    num,
    justify,
    wordCount,
}) {
    await rpg2.execSQL({
        sql: `
            INSERT INTO differential(
                title, tleft, tright, orden, creator, stageid, num, justify, sesid, word_count
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        dbcon: config.dbconnString,
        sqlParams: [
            rpg2.param('plain', name),
            rpg2.param('plain', tleft),
            rpg2.param('plain', tright),
            rpg2.param('plain', orden),
            rpg2.param('plain', userId),
            rpg2.param('plain', stageId),
            rpg2.param('plain', num),
            rpg2.param('plain', justify),
            rpg2.param('plain', sessionId),
            rpg2.param('plain', wordCount),
        ],
    });
}

/**
 * Adds a new item to a ranking phase.
 * This function inserts a new ranking item into the `actors` table, associating it with a specific phase (stage).
 * 
 * @async
 * @function addRankingItem
 * @param {Object} params - The parameters for the new ranking item.
 * @param {string} params.stageId - The ID of the phase (stage) to which the item belongs.
 * @param {string} params.name - The name of the ranking item.
 * @param {number} params.jorder - The order of the item in the phase.
 * @param {boolean} params.justified - Whether justification is required for the item.
 * @param {number} params.wordCount - The word count limit for justification.
 * @returns {Promise<void>} - Resolves when the item is successfully added.
 * 
 * @throws {Error} If the SQL query fails.
 * 
 * @example
 * // Usage
 * await addRankingItem({
 *   stageId: '456',
 *   name: 'Example Ranking Item',
 *   jorder: 1,
 *   justified: true,
 *   word_count: 30
 * });
 * 
 * // Inserts a ranking item with the provided parameters into the database.
 */
async function addRankingItem({ stageId, name, jorder, justified, wordCount }) {
    await rpg2.execSQL({
        sql: `
            INSERT INTO actors (name, jorder, stageid, justified, word_count)
            VALUES ($1, $2, $3, $4, $5)
        `,
        dbcon: config.dbconnString,
        sqlParams: [
            rpg2.param('plain', name),      // Item name
            rpg2.param('plain', jorder),    // Order
            rpg2.param('plain', stageId),   // Stage ID
            rpg2.param('plain', justified), // Requires justification
            rpg2.param('plain', wordCount), // Word count
        ],
    });
}

// Handler for semantic_differential responses
async function handleSemanticDifferentialResponse(
    sessionId, phaseId, userId, response, notificationEmitter) {

    if (!Array.isArray(response) || response.length > 1) {
        throw new Error(
            "Invalid response format. Either it is not an array, or its length is greater than 1");
    }
    // Only one response is expected for a semantic differential question
    const { did, sel, comment, iteration } = response[0];

    if (!did || sel === undefined || iteration === undefined) {
        throw new Error("Invalid response format for semantic_differential.");
    }

    await rpg2.execSQL({
        sql: `
            WITH updated AS (
                UPDATE differential_selection
                SET sel = $1,
                    comment = $2,
                    stime = now()
                WHERE did = $3
                    AND uid = $4
                    AND iteration = $5
                RETURNING 1
            )
            INSERT INTO differential_selection (uid, did, sel, comment, iteration, stime)
            SELECT $6, $7, $8, $9, $10, now()
            WHERE NOT EXISTS (
                SELECT 1
                FROM updated
            )
        `,
        dbcon: config.dbconnString,
        sqlParams: [
            rpg2.param('plain', sel),
            rpg2.param('plain', comment),
            rpg2.param('plain', did),
            rpg2.param('plain', userId),
            rpg2.param('plain', iteration), // Update params
            rpg2.param('plain', userId),
            rpg2.param('plain', did),
            rpg2.param('plain', sel),
            rpg2.param('plain', comment),
            rpg2.param('plain', iteration) // Insert params
        ],
    });

    notificationEmitter.responseSubmitted(
        { 
          type: "semantic_differential",
          sessionId: sessionId,
          phaseId: phaseId,
          uid: userId,
          did: did, 
          sel: sel,
          comment: comment
        });
}

// Handler for ranking responses
async function handleRankingResponse(
    sessionId, phaseId, userId, response, notificationEmitter) {
    for (const item of response) {
        const { actorid, orden, description } = item;

        if (!actorid || orden === undefined) {
            throw new Error("Invalid response format for ranking.");
        }

        await rpg2.execSQL({
            sql: `
                WITH updated AS (
                    UPDATE actor_selection
                    SET orden = $1,
                        description = $2,
                        stime = now()
                    WHERE actorid = $3
                        AND uid = $4
                        AND stageid = $5
                    RETURNING 1
                )
                INSERT INTO actor_selection (uid, actorid, orden, description, stageid, stime)
                SELECT $6, $7, $8, $9, $10, now()
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM updated
                )
            `,
            dbcon: config.dbconnString,
            sqlParams: [
                rpg2.param('plain', orden), 
                rpg2.param('plain', description),
                rpg2.param('plain', actorid), 
                rpg2.param('plain', userId),
                rpg2.param('plain', phaseId),
                rpg2.param('plain', userId),
                rpg2.param('plain', actorid),
                rpg2.param('plain', orden),
                rpg2.param('plain', description),
                rpg2.param('plain', phaseId)
            ],
        });
    }

    notificationEmitter.responseSubmitted(
        {
          type: "ranking",
          sessionId: sessionId,
          phaseId: phaseId,
          uid: userId,
          items: response
        });    
}

/**
 * Retrieves the design type for a given phase ID.
 * @param {number} phaseId - The phase ID.
 * @returns {Promise<string>} - The design type (e.g., "ranking" or "semantic_differential").
 * @throws {Error} If the design type is invalid or not found.
 */
async function getDesignTypeByPhaseId(phaseId) {
    const result = await rpg2.execSQL({
        sql: `
            SELECT d.design->>'type' AS design_type
            FROM stages AS st
            INNER JOIN activity AS a
                ON st.sesid = a.session
            INNER JOIN designs AS d
                ON a.design = d.id
            WHERE st.id = $1
        `,
        dbcon: config.dbconnString,
        sqlParams: [rpg2.param('plain', phaseId)],
    });

    if (result.length === 0) {
        throw new Error(`No design found for phase (stage) ID: ${phaseId}`);
    }

    const designType = result[0].design_type;

    if (!DesignTypes.isValidDesignType(designType)) {
        throw new Error(`Unsupported design type: ${designType}`);
    }

    return designType;
}

/**
 * Compute statistics for a ranking design phase.
 * @param {number} stageId - The ID of the stage (phase).
 * @returns {Promise<Array>} - An array of response stats per question.
 */
async function computeRankingStats(stageId) {
    // Get the actors (roles) in the stage, along with justification requirement
    const actors = await rpg2.execSQL({
        dbcon: config.dbconnString,
        sql: `
            SELECT a.id AS actor_id, a.justified
            FROM actors a
            WHERE a.stageid = $1
            ORDER BY a.id
        `,
        sqlParams: [rpg2.param('plain', stageId)],
    });

    if (actors.length === 0) {
        throw new Error("No actors found for the specified stage.");
    }

    const totalActors = actors.length;

    // Count valid user responses, considering justification requirements
    const responses = await rpg2.execSQL({
        dbcon: config.dbconnString,
        sql: `
            SELECT asel.uid AS user_id, COUNT(*) AS response_count
            FROM actor_selection asel
            INNER JOIN actors a ON asel.actorid = a.id
            WHERE asel.stageid = $1
            AND (
                a.justified = false OR
                (asel.description IS NOT NULL AND TRIM(asel.description) != '')
            )
            GROUP BY asel.uid
            HAVING COUNT(*) = $2
        `,
        sqlParams: [rpg2.param('plain', stageId),
            rpg2.param('plain', totalActors)],
    });

    // Count distinct user IDs with valid responses
    const completedResponses = responses.length;

    // Return stats for each actor
    return actors.map((actor, index) => ({
        question: index + 1, // Index the actors as "questions"
        responses: completedResponses, // Each actor shares the same response count
    }));
}

/**
 * Compute statistics for a semantic differential design phase.
 * @param {number} stageId - The ID of the stage (phase).
 * @returns {Promise<Array>} - An array of response stats per question.
 */
async function computeSemanticDifferentialStats(stageId) {
    // Get the questions in the stage
    const questions = await rpg2.execSQL({
        dbcon: config.dbconnString,
        sql: `
            SELECT d.id AS question_id, d.justify
            FROM differential d
            WHERE d.stageid = $1
            ORDER BY d.id
        `,
        sqlParams: [rpg2.param('plain', stageId)],
    });

    if (questions.length === 0) {
        throw new Error("No questions found for the specified stage.");
    }

    // Compute response stats for each question
    const responseStats = await Promise.all(
        questions.map(async (q) => {
            const { question_id, justify } = q;

            // Count complete responses (consider justification if required)
            const responses = await rpg2.execSQL({
                dbcon: config.dbconnString,
                sql: `
                    SELECT COUNT(*) AS count
                    FROM differential_selection ds
                    WHERE ds.did = $1
                    AND (
                        $2 = false OR
                        (ds.comment IS NOT NULL AND TRIM(ds.comment) != '')
                    )
                `,
                sqlParams: [question_id, justify],
            });

            return {
                question: question_id,
                responses: Number(responses[0].count),
            };
        })
    );

    return responseStats;
}

export default router;

