"use strict";

import express from "express";
import config from "../config/config.js"; 
import * as rpg2 from "../db/rest-pg-2.js";

const activityResponsesFetchHandlers = {
    "semantic-differential": fetchSemanticDifferentialResponses,
    ranking: fetchRankingResponses,
};

const phaseResponsesFetchHandlers = {
    "semantic-differential": fetchSemanticDifferentialResponsesByStage,
    ranking: fetchRankingResponsesByStage,
};

const router = express.Router();

router.get("/activities/:session_id/current_phase_number", async (req, res) => {
    const { session_id } = req.params;

    if (!session_id) {
        return res.status(400).json({ error: "Missing required parameter: session_id" });
    }

    try {
        const result = await rpg2.singleSQL({
            sql: `
                SELECT number
                FROM stages
                INNER JOIN sessions
                ON stages.id = sessions.current_stage
                WHERE sessions.id = $1
            `,
            dbcon: config.dbconnString,
            sqlParams: [session_id],
        });

        if (!result) {
            return res.status(404).json({ error: "No current phase found for the given session." });
        }

        res.status(200).json({ current_phase: result.number });
    } catch (err) {
        console.error("Error fetching current phase:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

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

router.post("/activities/:session_id/phase_transition", async (req, res) => {
    const { session_id } = req.params;
    const { stage_id } = req.body;

    if (!session_id || !stage_id) {
        return res.status(400).json({ error: "Missing required parameters: session_id or stage_id." });
    }

    try {
        const result = await rpg.execSQL({
            sql: `
                UPDATE sessions
                SET status = 2,
                    current_stage = $1
                WHERE id = $2
            `,
            dbcon: config.dbconnString,
            sqlParams: [stage_id, session_id],
        });

        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Session not found or no update performed." });
        }

        const io = req.app.locals.io;
        const socket = configSocket(io);
        socket.stateChange(session_id);

        res.status(200).json({ status: "ok", message: "Session transitioned to the new stage." });
    } catch (err) {
        console.error("Error transitioning session stage:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.post("/activities/:session_id/finish", async (req, res) => {
    const { session_id } = req.params;

    if (!session_id) {
        return res.status(400).json({ error: "Missing required parameter: session_id" });
    }

    try {
        const result = await rpg2.execSQL({
            sql: `
                UPDATE sessions
                SET status = 3,
                    current_stage = NULL
                WHERE id = $1
            `,
            dbcon: config.dbconnString,
            sqlParams: [session_id],
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

router.get("/phases/:id/groups", async (req, res) => {
    const { id } = req.params;

    if (!id) {
        return res.status(400).json({ error: "Missing required parameter: id" });
    }

    try {
        const results = await rpg2.execSQL({
            sql: `
                SELECT t.id AS team_id,
                       tu.uid AS user_id
                FROM teams AS t
                LEFT JOIN teamusers AS tu
                    ON t.id = tu.tmid
                WHERE t.stageid = $1
                ORDER BY t.id, tu.uid
            `,
            dbcon: config.dbconnString,
            sqlParams: [id],
        });

        if (results.length === 0) {
            return res.status(404).json({ error: "No groups found for the given phase." });
        }

        const groupedTeams = results.reduce((acc, row) => {
            const { team_id, user_id } = row;

            if (!acc[team_id]) {
                acc[team_id] = {
                    id: team_id,
                    number: Object.keys(acc).length + 1,
                    participants: [],
                };
            }

            if (user_id) {
                acc[team_id].participants.push(user_id);
            }

            return acc;
        }, {});

        const responseArray = Object.values(groupedTeams);

        res.status(200).json({ groups: responseArray });
    } catch (err) {
        console.error("Error fetching groups:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.get("/phases/:id/responses", async (req, res) => {
    const { id } = req.params;

    if (!id) {
        return res.status(400).json({ error: "Missing required parameter: id" });
    }

    try {
        // Determine the design type for the stage
        const designType = await getDesignTypeByStageId(id);

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

router.get("/phases/:id/message_count", async (req, res) => {
    const { id } = req.params;

    if (!id) {
        return res.status(400).json({ error: "Missing required parameter: id" });
    }

    try {
        const results = await rpg2.execSQL({
            sql: `
                SELECT c.did,
                       u.uid,
                       u.tmid,
                       COUNT(*) AS message_count
                FROM differential_chat AS c
                INNER JOIN teamusers AS u
                    ON u.uid = c.uid
                INNER JOIN differential AS d
                    ON d.id = c.did
                INNER JOIN teams AS tm
                    ON tm.id = u.tmid
                WHERE d.stageid = $1
                  AND tm.stageid = $1
                GROUP BY c.did, u.uid, u.tmid
            `,
            dbcon: config.dbconnString,
            sqlParams: [id],
        });

        if (results.length === 0) {
            return res.status(404).json({ error: "No messages found for the given phase." });
        }

        const formattedResults = results.map(row => ({
            question_id: row.did,
            user_id: row.uid,
            team_id: row.tmid,
            message_count: parseInt(row.message_count, 10),
        }));

        res.status(200).json({ messages: formattedResults });
    } catch (err) {
        console.error("Error fetching messages:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.get("/phases/:id/group_messages/:user_id", async (req, res) => {
    const { id, user_id } = req.params;

    if (!id || !user_id) {
        return res.status(400).json({ error: "Missing required parameters: id or user_id." });
    }

    try {
        const results = await rpg2.execSQL({
            sql: `
                SELECT s.id,
                       s.uid,
                       s.content,
                       s.stime,
                       s.parent_id,
                       s.stageid
                FROM chat AS s
                WHERE s.stageid = $1
                  AND s.uid IN (
                      SELECT tu.uid
                      FROM teamusers AS tu
                      WHERE tu.tmid = (
                          SELECT t.id
                          FROM teamusers AS tu,
                               teams AS t
                          WHERE t.stageid = $1
                            AND tu.tmid = t.id
                            AND tu.uid = $2
                      )
                  )
                ORDER BY s.stime ASC
            `,
            dbcon: config.dbconnString,
            sqlParams: [id, user_id], // `id` es el `stageid`, `user_id` es el identificador del usuario
        });

        if (results.length === 0) {
            return res.status(404).json({ error: "No messages found for the user's group in the given phase." });
        }

        res.status(200).json({ group_messages: results });
    } catch (err) {
        console.error("Error fetching group messages:", err);
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

async function fetchSemanticDifferentialResponsesByStage(stageId) {
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
        sqlParams: [stageId, stageId],
    });

    return results;
}

async function fetchRankingResponsesByStage(stageId) {
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
        sqlParams: [stageId],
    });

    return results;
}

export default router;