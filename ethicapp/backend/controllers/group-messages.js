"use strict";

import express from "express";
import { getDesignTypeByPhaseId } from "../helpers/designs-helper.js";
import { dispatchPhaseHook } from "../helpers/external-service-dispatch.js";
import { resolveGroupChatAccessContext } from "../helpers/group-chat-access.js";
import { describeError } from "../helpers/log-safety.js";
import { JOB_SOURCE_KIND } from "../services/external-service-jobs.service.js";
import { messageCountHandlers,
    chatTranscriptHandlers,
    saveChatMessage } from "../helpers/chat-helper.js";
import { studentNotifications, teacherNotifications } from "../config/socket.config.js";
import { requirePhaseOwner } from "../helpers/activity-owner-helper.js";
import { chatTranscriptForStudent, loadGroupMasks } from "../helpers/peer-names.js";

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
        // Only the activity's teacher reads its message counts (#910).
        if (!await requirePhaseOwner(req, res, id)) {
            return;
        }

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
    const userId = req.session.uid;
    const role = req.session.role;

    if (!groupId || !questionId) {
        return res.status(400).json({
            error: "Missing required parameters: group_id or question_id.",
        });
    }

    try {
        const accessContext = await resolveGroupChatAccessContext({
            groupId,
            questionId,
            userId,
            role,
        });

        if (!accessContext) {
            return res.status(404).json({ error: "Group not found or not associated with any phase." });
        }

        if (!accessContext.canRead) {
            return res.status(403).json({ error: "Access denied for this group chat." });
        }

        // Step 2: Determine the design type for the phase
        const designType = await getDesignTypeByPhaseId(accessContext.phaseId);

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

        // The teacher reads every author's name. A student in an anonymous
        // phase reads their peers by their masks (#1199).
        if (role === "P") {
            return res.status(200).json({ chat_transcript: results });
        }
        const { phaseAnonymous, masksByUserId } = await loadGroupMasks(accessContext.groupId);
        res.status(200).json({
            chat_transcript: chatTranscriptForStudent(results, {
                viewerId: userId,
                phaseAnonymous,
                masksByUserId,
            }),
        });
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
    if (!phaseId || !questionId || !groupId || !content) {
        return res.status(400).json({
            error: "Missing required parameters: phaseId, questionId, groupId, or content.",
        });
    }

    try {
        const accessContext = await resolveGroupChatAccessContext({
            groupId,
            phaseId,
            questionId,
            userId,
            role: req.session.role,
        });

        if (!accessContext) {
            return res.status(404).json({ error: "Group not found for this phase." });
        }

        if (!accessContext.canPost) {
            return res.status(403).json({ error: "Access denied or chat is read-only for this phase." });
        }

        const savedMessage = await saveChatMessage({userId, phaseId, questionId, groupId, parentId, content});
        if (!savedMessage) {
            return res.status(400).json({
                error: `Error saving the chat message`,
            });
        }

        // Step 4: Notify clients about the new message
        const notificationPayload = normalizeChatNotificationPayload(savedMessage, req.session.role);
        teacherNotifications.chatMessage(accessContext.sessionId, phaseId, questionId, groupId, content);
        teacherNotifications.groupChatMessage(groupId, {
            ...notificationPayload,
            phaseId:    Number(phaseId),
            questionId: Number(questionId),
            groupId:    Number(groupId),
        });
        studentNotifications?.chatMessage(groupId);
        dispatchIncomingChatMessageHook({
            sessionId: accessContext.sessionId,
            phaseId: Number(phaseId),
            questionId: Number(questionId),
            groupId: Number(groupId),
            userId: Number(userId),
            parentId: parentId == null ? null : Number(parentId),
            content,
            savedMessage,
            notificationPayload,
            designType: accessContext.designType,
            // The saved message, recorded on each hook job (#946).
            source:     chatMessageSource(savedMessage),
        });

        // Respond with success
        res.status(201).json({
            status:       "ok",
            message:      "Message posted successfully.",
            chat_message: notificationPayload,
        });
    } catch (err) {
        console.error("Error posting chat message:", err); // Log the error for debugging
        res.status(500).json({ error: "Internal server error" });
    }
});

// The hook's `source` for a saved message: its row in differential_chat, or in
// chat for ranking. saveChatMessage() answers `true` when the insert returned
// no row, and then there is no id to record.
export function chatMessageSource(savedMessage) {
    const id = Number(savedMessage?.id);
    return Number.isSafeInteger(id) && id > 0
        ? { kind: JOB_SOURCE_KIND.CHAT_MESSAGE, id }
        : null;
}

async function dispatchIncomingChatMessageHook(context) {
    try {
        await dispatchPhaseHook("chat-message-received", context);
    } catch (error) {
        console.error("[external-services] Error dispatching incoming chat message hook.",
            describeError(error));
    }
}

function normalizeChatNotificationPayload(message, role) {
    return {
        id: message.id,
        uid: message.uid,
        author_role: role,
        groupId: message.tmid,
        phaseId: message.stageid,
        questionId: message.did,
        content: message.content,
        stime: message.stime,
        parent_id: message.parent_id,
    };
}



export default router;
