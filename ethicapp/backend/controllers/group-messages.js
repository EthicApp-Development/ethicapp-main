"use strict";

import express from "express";
import * as config from "../config/config.js"; 
import * as rpg2 from "../db/rest-pg-2.js";
import { getDesignById, getDesignTypeByPhaseId } from "../helpers/designs-helper.js";
import * as SessionsHelper from "../helpers/sessions-helper.js"
import { messageCountHandlers, 
    chatTranscriptHandlers, 
    chatInsertHandlers, 
    saveChatMessage } from "../helpers/chat-helper.js";
import { studentNotifications, teacherNotifications } from "../config/socket.config.js";

const router = express.Router();

/**
 * @route GET /phases/:id/message_count
 * @description Retrieves the count of messages exchanged in a given phase (stage), grouped by user and team.
 *              Handles both "semantic_differential" and "ranking" question types.
 * @param {string} id - The ID of the phase (from the URL path).
 * @returns {Object} - A JSON object containing message counts grouped by question, user, and team.
 */
router.get("/phases/:id/message_count", async (req, res) => {
    const { id } = req.params;

    // Validar que `id` sea un número
    if (!id || isNaN(Number(id))) {
        return res.status(400).json({ error: "Invalid or missing required parameter: id." });
    }

    try {
        // Fetch the design type for the phase
        const designType = await getDesignTypeByPhaseId(id);

        // Find the appropriate message count handler
        const handler = messageCountHandlers[designType];
        if (!handler) {
            return res.status(400).json({ error: `Unsupported design type: ${designType}` });
        }

        // Execute the handler to fetch message counts
        const results = await handler(id);

        if (!results || results.length === 0) {
            return res.status(200).json({ messageCount: [] });
        }

        // Log success and return the results
        console.info(`Successfully retrieved ${results.length} message(s) for phase ${id}.`);
        res.status(200).json({ messageCount: results });
    } catch (err) {
        // Log error with detailed context
        console.error(`Error fetching message counts for phase ${id}:`, err);
        res.status(500).json({ error: "An internal server error occurred." });
    }
});

/**
 * @route GET /groups/:group_id/question/:question_id/chat
 * @description Retrieves the chat transcript for a specific group and question in a phase.
 *              The chat transcript is determined based on the design type of the phase.
 *              For "semantic_differential", the transcript is linked to a specific question,
 *              while for "ranking", the transcript is linked to the entire phase.
 * @param {string} group_id - The ID of the group (team) to fetch messages for (from the URL path).
 * @param {string} question_id - The ID of the question to fetch messages for (from the URL path).
 * @returns {Object} - A JSON object containing the chat transcript or an error message.
 */
router.get("/groups/:group_id/question/:question_id/chat_messages", async (req, res) => {
    const { group_id: groupId, question_id: questionId } = req.params;

    if (!groupId || !questionId) {
        return res.status(400).json({
            error: "Missing required parameters: group_id or question_id.",
        });
    }

    try {
        // Step 1: Determine the phase (stage) ID using the group (team) ID
        const phaseIdResult = await rpg2.execSQL({
            sql: `
                SELECT stageid
                FROM teams
                WHERE id = $1
            `,
            dbcon: config.dbconnString,
            sqlParams: [rpg2.param('plain', groupId)],
        });

        if (phaseIdResult.length === 0) {
            return res.status(404).json({
                error: "Group not found or not associated with any phase.",
            });
        }

        const phaseId = phaseIdResult[0].stageid;

        // Step 2: Determine the design type for the phase
        const designType = await getDesignTypeByPhaseId(phaseId);

        // Step 3: Fetch the appropriate handler for the design type
        const handler = chatTranscriptHandlers[designType];
        if (!handler) {
            return res.status(400).json({
                error: `Unsupported design type: ${designType}`,
            });
        }

        // Step 4: Execute the handler and retrieve the chat transcript
        const results = await handler(groupId, questionId);

        if (!results || results.length === 0) {
            return res.status(200).json({ chat_transcript: [] });
        }

        res.status(200).json({ chat_transcript: results });
    } catch (err) {
        console.error("Error fetching chat transcript:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

/**
 * @route POST /phases/:id/question/:question_id/chat
 * @description Inserts a new chat message for a specific question in a phase. 
 *              The insertion behavior depends on the design type of the phase.
 *              For "semantic_differential", the message is associated with a specific question,
 *              while for "ranking", the message is associated with the phase as a whole.
 *              After the message is inserted, a notification is broadcast to all clients
 *              about the new message.
 * @param {string} id - The ID of the phase (from the URL path).
 * @param {string} question_id - The ID of the question (from the URL path).
 * @param {Object} body - The body of the request containing:
 *   - `content` {string} - The message content (required).
 *   - `parent_id` {number|null} - The ID of the parent message for threading (optional).
 * @param {Object} session - The session object containing:
 *   - `uid` {number} - The ID of the user posting the message (from session).
 * @returns {Object} - A JSON object indicating the success or failure of the operation.
 */
router.post("/phases/:id/question/:question_id/chat_messages", async (req, res) => {
    const { id: phaseId, question_id: questionId } = req.params; // Phase and question IDs
    const { content, parent_id: parentId, group_id: groupId } = req.body; // Message details
    const userId = req.session.uid; // User ID from session

    // Validate required parameters
    if (!phaseId || !questionId || !content) {
        return res.status(400).json({
            error: "Missing required parameters: phaseId, questionId, or content.",
        });
    }

    try {
        if (!await saveChatMessage({userId, phaseId, questionId, parentId, content})) {
            return res.status(400).json({
                error: `Error saving the chat message`,
            });
        }

        // Get the session Id
        const sessionId = await SessionsHelper.getSessionIdByPhaseId(phaseId);

        // Step 4: Notify clients about the new message
        teacherNotifications.chatMessage(sessionId, phaseId, questionId, groupId, content);
        studentNotifications?.chatMessage(groupId);

        // Respond with success
        res.status(201).json({
            status: "ok",
            message: "Message posted successfully.",
        });
    } catch (err) {
        console.error("Error posting chat message:", err); // Log the error for debugging
        res.status(500).json({ error: "Internal server error" });
    }
});



export default router;