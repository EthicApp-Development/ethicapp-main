"use strict";

import express from "express";
import { requireRole } from "../../helpers/auth-helper.js";
import { requireSessionOwnerOrParticipant } from "../../helpers/activity-owner-helper.js";
import * as StudentActivityStatusHelper from "../../helpers/student-activity-state-helper.js";
import * as config from "../../config/database.config.js";
import * as rpg2 from "../../db/rest-pg-2.js";
import { teacherNotifications } from "../../config/socket.config.js";
import { evaluateStudentResponse } from "../../helpers/student-response-policy.js";
import { dispatchPhaseHook } from "../../helpers/external-service-dispatch.js";
import { describeError } from "../../helpers/log-safety.js";

const router = express.Router();

router.get("/activities/:session_id/current_phase_state", async (req, res) => {
    const sessionId = Number(req.params.session_id);
    const invalidate = req.query.invalidate === "true";

    // Only students call this endpoint: a wrong role is refused before any
    // lookup.
    if (!requireRole(req, res, "A")) {
        return;
    }

    if (!sessionId || isNaN(sessionId)) {
        return res.status(400).json({ error: "Invalid session ID." });
    }

    try {
        // Only a student enrolled in the session reads its state or flushes
        // its caches with `invalidate`; anyone else gets the 404 of an
        // unknown session (#926).
        if (!await requireSessionOwnerOrParticipant(req, res, sessionId)) {
            return;
        }

        const { descriptor } = await StudentActivityStatusHelper.
            getCachedStudentActivityDescriptor(sessionId, invalidate);
        const currentPhaseId = Number(descriptor?.currentPhaseId);

        if (!currentPhaseId || isNaN(currentPhaseId)) {
            return res.status(404).json({ error: "No active phase found for this session." });
        }

        const initialPhaseState = await StudentActivityStatusHelper.buildInitialPhaseState(currentPhaseId);
        return res.status(200).json(initialPhaseState);
    } catch (error) {
        console.error(`Error retrieving current phase state for session ${sessionId}:`, error);
        return res.status(500).json({ error: "Internal server error." });
    }
});

router.get("/activities/:id/users/:user_id/full_state", async (req, res) => {
    const sessionId = Number(req.params.id);
    const userId = Number(req.params.user_id);
    const invalidate = req.query.invalidate === "true";

    // Only students call this endpoint: a wrong role is refused before any
    // lookup.
    if (!requireRole(req, res, "A")) {
        return;
    }

    if (!sessionId || !userId) {
        return res.status(400).json({ error: "Invalid session ID or user ID." });
    }

    try {
        // Only a student enrolled in the session, asking for their own state,
        // reads it or flushes its caches with `invalidate`. Another user's id,
        // a session the student is not enrolled in and an unknown one all get
        // the same 404 (#926).
        if (!await requireSessionOwnerOrParticipant(req, res, sessionId, {
            subjectUserId: userId,
        })) {
            return;
        }

        const { descriptor } = await StudentActivityStatusHelper.
            getCachedStudentActivityDescriptor(sessionId, invalidate);

        if (!descriptor || !descriptor.design) {
            return res.status(404).json({ error: "Descriptor not found for the given session." });
        }

        const { phases } = await StudentActivityStatusHelper.
            getCachedStudentActivityPhases(sessionId, invalidate);

        if (!phases || phases.length === 0) {
            return res.status(404).json({ error: "No phases found for the given session." });
        }

        const designType = descriptor?.design?.type || await StudentActivityStatusHelper.
            getDesignTypeBySessionId(sessionId);

        if (!designType) {
            return res.status(400).json({ error: "Design type could not be determined." });
        }

        const phasesWithTasks = await StudentActivityStatusHelper.
            getCachedStudentActivityTasks(
                designType,
                sessionId,
                phases,
                invalidate
            );

        const phasesWithResponses = await StudentActivityStatusHelper.
            getCachedStudentActivityResponses(
                designType,
                sessionId,
                userId,
                phasesWithTasks,
                invalidate
            );

        const phasesWithPeerResponses = await StudentActivityStatusHelper.
            getCachedStudentActivityPeerResponses(
                designType,
                sessionId,
                userId,
                phasesWithResponses,
                invalidate
            );

        const phasesWithGroups = await StudentActivityStatusHelper.getCachedStudentActivityGroups(
            sessionId,
            userId,
            phasesWithPeerResponses,
            invalidate
        );

        const phasesWithGroupMessages = await StudentActivityStatusHelper.
            getCachedStudentActivityGroupMessages(
                designType,
                sessionId,
                userId,
                phasesWithGroups,
                invalidate
            );

        const state = {
            descriptor,
            phases: phasesWithGroupMessages
        };

        return res.status(200).json({ state });
    } catch (error) {
        console.error(`Error generating full state for session ID ${sessionId}, user ID ${userId}:`, error);
        return res.status(500).json({ error: "Internal server error." });
    }
});

// The student's response to the current phase. Role A is checked before any
// lookup (403); the response policy then refuses, with a code, a session the
// student is not enrolled in, a finished or archived activity, a phase that
// is not the current one and a task outside it (#927). A refusal writes
// nothing, notifies no teacher and dispatches no hook.
router.post("/activities/:id/response", async (req, res) => {
    const sessionId = Number(req.params.id);
    const userId = Number(req.session?.uid);

    if (!requireRole(req, res, "A")) {
        return;
    }

    if (!sessionId || isNaN(sessionId)) {
        return res.status(400).json({ error: "Invalid session ID." });
    }

    if (!userId || isNaN(userId)) {
        return res.status(401).json({ error: "Unauthorized user." });
    }

    const { questionId } = req.body;

    if (!questionId || isNaN(Number(questionId))) {
        return res.status(400).json({ error: "Missing or invalid questionId." });
    }

    try {
        const decision = await evaluateStudentResponse({
            sessionId,
            userId,
            questionId: Number(questionId),
            payload:    req.body,
        });
        if (!decision.allowed) {
            return res.status(decision.status).json({ error: decision.error, code: decision.code });
        }

        const { phaseId, designType, taskId, task } = decision;
        const handler = responseSubmissionHandlers[designType];

        if (!handler) {
            return res.status(400).json({ error: `Unsupported design type: ${designType}` });
        }

        const notificationData = await handler({
            userId,
            phaseId,
            taskId,
            task,
            payload: req.body,
        });

        responseSubmissionEffects.notifyTeacher(sessionId, phaseId, notificationData);
        responseSubmissionEffects.dispatchHook({
            sessionId,
            phaseId,
            userId,
            questionId:      Number(questionId),
            designType,
            requestPayload:  req.body,
            responsePayload: notificationData,
        });

        return res.status(201).json({
            status:  "ok",
            message: "Response submitted successfully.",
        });
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ error: error.message });
        }

        console.error(`Error submitting student response for session ${sessionId}:`, error);
        return res.status(500).json({ error: "Internal server error." });
    }
});

const responseSubmissionHandlers = {
    semantic_differential: submitSemanticDifferentialResponse,
    ranking:               submitRankingResponse,
};

// What an accepted response sets off, in an object so tests can observe it.
export const responseSubmissionEffects = {
    notifyTeacher: emitResponseSubmittedNotification,
    dispatchHook:  dispatchStudentResponseHook,
};

async function dispatchStudentResponseHook(context) {
    try {
        await dispatchPhaseHook("student-response-submitted", context);
    } catch (error) {
        console.error("[external-services] Error dispatching student response hook.",
            describeError(error));
    }
}

// `task` is the phase's question that the response policy found.
async function submitSemanticDifferentialResponse({ userId, taskId: questionId, task, payload }) {
    const value = Number(payload.value);
    const justification = normalizeText(payload.justification);

    if (!Number.isInteger(value) || value < 1 || value > Number(task.num_values)) {
        throw badRequest(
            `Invalid value. It must be an integer between 1 and ${Number(task.num_values)}.`
        );
    }

    validateJustification({
        justification,
        requiresJustification: task.requires_justification,
        minWordCount:          task.min_word_count,
    });

    await rpg2.execSQL({
        dbcon: config.dbconnString,
        sql:   `
            WITH updated AS (
                UPDATE differential_selection
                SET sel = $1,
                    comment = $2,
                    stime = now()
                WHERE did = $3
                    AND uid = $4
                    AND iteration = 0
                RETURNING 1
            )
            INSERT INTO differential_selection (uid, did, sel, comment, iteration, stime)
            SELECT $5, $6, $7, $8, 0, now()
            WHERE NOT EXISTS (
                SELECT 1 FROM updated
            );
        `,
        sqlParams: [
            rpg2.param("plain", value),
            rpg2.param("plain", justification),
            rpg2.param("plain", questionId),
            rpg2.param("plain", userId),
            rpg2.param("plain", userId),
            rpg2.param("plain", questionId),
            rpg2.param("plain", value),
            rpg2.param("plain", justification),
        ],
    });

    return {
        type:    "semantic_differential",
        uid:     userId,
        did:     questionId,
        sel:     value,
        comment: justification,
    };
}

// `task` is the phase's ranking item that the response policy found, from
// `itemId` or `questionId`.
async function submitRankingResponse({ phaseId, userId, taskId: itemId, task, payload }) {
    const order = Number(payload.order);
    const justification = normalizeText(payload.justification);

    if (!Number.isInteger(order) || order < 1) {
        throw badRequest("Invalid order. It must be an integer greater than or equal to 1.");
    }

    validateJustification({
        justification,
        requiresJustification: task.requires_justification,
        minWordCount:          task.min_word_count,
    });

    await rpg2.execSQL({
        dbcon: config.dbconnString,
        sql:   `
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
                SELECT 1 FROM updated
            );
        `,
        sqlParams: [
            rpg2.param("plain", order),
            rpg2.param("plain", justification),
            rpg2.param("plain", itemId),
            rpg2.param("plain", userId),
            rpg2.param("plain", phaseId),
            rpg2.param("plain", userId),
            rpg2.param("plain", itemId),
            rpg2.param("plain", order),
            rpg2.param("plain", justification),
            rpg2.param("plain", phaseId),
        ],
    });

    return {
        type:  "ranking",
        uid:   userId,
        items: [
            {
                actorid:     itemId,
                orden:       order,
                description: justification,
            },
        ],
    };
}

function emitResponseSubmittedNotification(sessionId, phaseId, responsePayload) {
    if (!teacherNotifications?.responseSubmitted) {
        console.warn("Teacher socket notification service is not initialized.");
        return;
    }

    teacherNotifications.responseSubmitted(
        sessionId,
        phaseId,
        responsePayload
    );
}

function validateJustification({ justification, requiresJustification, minWordCount }) {
    const hasJustification = Boolean(justification);
    const minimumWordCount = Number(minWordCount) || 0;

    if (requiresJustification && !hasJustification) {
        throw badRequest("Justification is required for this item.");
    }

    if (hasJustification && minimumWordCount > 0 && countWords(justification) < minimumWordCount) {
        throw badRequest(`Justification must contain at least ${minimumWordCount} words.`);
    }
}

function normalizeText(value) {
    if (value === undefined || value === null) {
        return null;
    }
    const text = String(value).trim();
    return text.length ? text : null;
}

function countWords(value) {
    return String(value).trim().split(/\s+/u).filter(Boolean).length;
}

function badRequest(message) {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
}

export default router;
