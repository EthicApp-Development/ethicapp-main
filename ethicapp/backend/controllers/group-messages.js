"use strict";

import express from "express";
import * as config from "../config/database.config.js";
import * as rpg2 from "../db/rest-pg-2.js";
import { getDesignTypeByPhaseId, getPhaseDesignByPhaseId } from "../helpers/designs-helper.js";
import { getStatusCode } from "../../common/modules/session-status.js";
import { messageCountHandlers,
    chatTranscriptHandlers,
    saveChatMessage } from "../helpers/chat-helper.js";
import { studentNotifications, teacherNotifications } from "../config/socket.config.js";
import externalServicesRegistry from "../services/external-services.service.js";

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

async function dispatchIncomingChatMessageHook(context) {
    try {
        const phaseDesign = await getPhaseDesignByPhaseId(context.phaseId);
        const enabledServiceIds = getEnabledExternalServiceIds(phaseDesign);

        if (enabledServiceIds.length === 0) {
            return;
        }

        await externalServicesRegistry.dispatchHook("chat-message-received", context, {
            enabledServiceIds,
        });
    } catch (error) {
        console.error("[external-services] Error dispatching incoming chat message hook.", error);
    }
}

function getEnabledExternalServiceIds(phaseDesign) {
    const enabledServiceIds = phaseDesign?.externalServices?.enabledServiceIds;

    if (!Array.isArray(enabledServiceIds)) {
        return [];
    }

    return enabledServiceIds
        .map(serviceId => String(serviceId).trim())
        .filter(Boolean);
}

async function resolveGroupChatAccessContext({ groupId, phaseId = null, questionId, userId, role }) {
    const rows = await rpg2.execSQL({
        sql: `
            SELECT t.id AS group_id,
                   t.stageid AS phase_id,
                   s.id AS session_id,
                   s.creator,
                   s.current_stage,
                   s.status,
                   st.chat,
                   EXISTS (
                       SELECT 1
                       FROM teamusers AS tu
                       WHERE tu.tmid = t.id
                         AND tu.uid = $4
                   ) AS is_group_member,
                   EXISTS (
                       SELECT 1
                       FROM differential AS d
                       WHERE d.id = $3
                         AND d.stageid = t.stageid
                   ) AS question_belongs_to_phase
            FROM teams AS t
            INNER JOIN stages AS st
                ON st.id = t.stageid
            INNER JOIN sessions AS s
                ON s.id = st.sesid
            WHERE t.id = $1
              AND ($2::integer IS NULL OR t.stageid = $2)
            LIMIT 1
        `,
        dbcon: config.dbconnString,
        sqlParams: [
            Number(groupId),
            phaseId == null ? null : Number(phaseId),
            Number(questionId),
            Number(userId),
        ],
    });

    if (rows.length === 0) {
        return null;
    }

    const row = rows[0];
    const designType = await getDesignTypeByPhaseId(row.phase_id);
    if (designType === "semantic_differential" && !row.question_belongs_to_phase) {
        return null;
    }

    const isTeacherOwner = role === "P" && Number(row.creator) === Number(userId);
    const isStudentMember = role === "A" && row.is_group_member === true;
    const activeStatus = getStatusCode("in_progress");
    const isActiveChatPhase = Boolean(row.chat)
        && Number(row.current_stage) === Number(row.phase_id)
        && Number(row.status) === Number(activeStatus);

    return {
        phaseId: Number(row.phase_id),
        sessionId: Number(row.session_id),
        groupId: Number(row.group_id),
        designType,
        canRead: isTeacherOwner || isStudentMember,
        canPost: (isTeacherOwner || isStudentMember) && isActiveChatPhase,
    };
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
