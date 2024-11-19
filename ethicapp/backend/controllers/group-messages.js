"use strict";

import express from "express";
import config from "../config/config.js"; 
import * as rpg2 from "../db/rest-pg-2.js";

const router = express.Router();

/**
 * @route GET /phases/:id/message_count
 * @description Retrieves the count of messages exchanged in a given phase (stage), grouped by question, user, and team.
 * @param {string} id - The ID of the phase (from the URL path).
 * @returns {Object} - A JSON object containing message counts grouped by question, user, and team.
 * 
 * @example
 * // Request
 * GET /phases/123/message_count
 * 
 * // Response (success)
 * {
 *   "messages": [
 *     {
 *       "question_id": 101,
 *       "user_id": 45,
 *       "team_id": 7,
 *       "message_count": 5
 *     },
 *     {
 *       "question_id": 102,
 *       "user_id": 46,
 *       "team_id": 8,
 *       "message_count": 3
 *     }
 *   ]
 * }
 * 
 * // Response (missing required parameter)
 * {
 *   "error": "Missing required parameter: id."
 * }
 * 
 * // Response (no messages found)
 * {
 *   "error": "No messages found for the given phase."
 * }
 * 
 * // Response (internal server error)
 * {
 *   "error": "Internal server error."
 * }
 */
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

/**
 * @route GET /phases/:id/group_messages/:user_id
 * @description Retrieves all messages exchanged within the user's group during a specific phase.
 *              The user's group is determined based on their team membership in the given phase.
 * @param {string} id - The ID of the phase (stage) (from the URL path).
 * @param {string} user_id - The ID of the user (from the URL path).
 * @returns {Object} - A JSON object containing the messages for the user's group.
 * 
 * @example
 * // Request
 * GET /phases/123/group_messages/456
 * 
 * // Response (success)
 * {
 *   "group_messages": [
 *     {
 *       "id": 1,
 *       "uid": 101,
 *       "content": "Hello team!",
 *       "stime": "2024-01-01T12:00:00Z",
 *       "parent_id": null,
 *       "stageid": 123
 *     },
 *     {
 *       "id": 2,
 *       "uid": 102,
 *       "content": "Let's discuss our strategy.",
 *       "stime": "2024-01-01T12:01:00Z",
 *       "parent_id": null,
 *       "stageid": 123
 *     }
 *   ]
 * }
 * 
 * // Response (missing required parameters)
 * {
 *   "error": "Missing required parameters: id or user_id."
 * }
 * 
 * // Response (no messages found)
 * {
 *   "error": "No messages found for the user's group in the given phase."
 * }
 * 
 * // Response (internal server error)
 * {
 *   "error": "Internal server error."
 * }
 */
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
 * @route POST /phases/:id/group_messages
 * @description Allows users to post a message to the group chat of a phase (stage).
 *              The message is associated with the user, the phase, and optionally a parent message for threading.
 * @param {string} id - The ID of the phase (stage) (from the URL path).
 * @param {Object} body - The message details, including:
 *   - `content`: The content of the message.
 *   - `parent_id` (optional): The ID of the parent message for threaded replies.
 * @returns {Object} - A JSON object indicating the success or failure of the operation.
 */
router.post("/phases/:id/group_messages", async (req, res) => {
    const { id } = req.params; // Phase (stage) ID
    const { content, parent_id } = req.body; // Message details

    // Validate required parameters
    if (!id || !content) {
        return res.status(400).json({ error: "Missing required parameters: id or content." });
    }

    try {
        // Insert the message into the chat table
        const result = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: `
                INSERT INTO chat (uid, stageid, content, parent_id)
                VALUES ($1, $2, $3, $4)
            `,
            sesReqData: ["uid"], // User ID from session
            sqlParams: [
                req.session.uid, // UID of the user posting the message
                id,              // Phase (stage) ID
                content,         // Content of the message
                parent_id || null // Optional parent message ID for threading
            ],
        });

        // Notify clients about the new message
        const io = req.app.locals.io;
        const socket = configSocket(io);
        socket.chatMsgStage(id);

        // Respond with success
        res.status(201).json({
            status: "ok",
            message: "Message posted successfully.",
        });
    } catch (err) {
        console.error("Error posting group message:", err); // Log the error for debugging
        res.status(500).json({ error: "Internal server error" });
    }
});