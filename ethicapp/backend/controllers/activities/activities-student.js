"use strict";

import express from "express";
import { requireOwnershipOrRole, requireRole } from "../../helpers/auth-helper.js";
import * as StudentActivityStatusHelper from "../../helpers/student-activity-state-helper.js";
import * as config from "../../config/database.config.js";
import * as rpg2 from "../../db/rest-pg-2.js";
import { teacherNotifications } from "../../config/socket.config.js";
import { getDesignTypeBySessionId } from "./activities-common.js";

const router = express.Router();

router.post("/sessions/join/:code", async (req, res) => {
    if (!requireRole(req, res, "A")) {
        return;
    }

    const { code } = req.params;
    const { device } = req.body;
    const userId = req.session.uid;

    if (!code || !device || !userId) {
        return res.status(400).json({ status: "error", message: "Missing required parameters." });
    }

    try {
        const insertResult = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: `
                INSERT INTO sesusers (uid, sesid, device)
                SELECT $1::int AS uid,
                       id,
                       $2 AS device
                FROM sessions
                WHERE code = $3
                  AND NOT EXISTS (
                      SELECT 1
                      FROM sesusers AS su
                      INNER JOIN sessions AS s
                          ON su.sesid = s.id
                      WHERE su.uid = $1
                        AND s.code = $3
                  )
                  AND NOT EXISTS (
                      SELECT 1
                      FROM stages AS st
                      INNER JOIN sessions AS ss
                          ON st.sesid = ss.id
                      WHERE ss.code = $3
                        AND st.type = 'team'
                  )
                RETURNING sesid
            `,
            sqlParams: [
                rpg2.param("plain", userId),
                rpg2.param("plain", device),
                rpg2.param("plain", code),
            ],
        });

        if (insertResult.length === 0 || !insertResult[0].sesid) {
            return res.status(400).json({ status: "end" });
        }

        const sessionId = insertResult[0].sesid;

        const userResult = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT name, $1 AS device, role, mail
                FROM users
                WHERE id = $2
            `,
            sqlParams: [
                rpg2.param("plain", device),
                rpg2.param("plain", userId),
            ],
        });

        if (userResult.length === 0) {
            return res.status(404).json({ status: "error", message: "User not found." });
        }

        const { name, role, mail } = userResult[0];

        teacherNotifications.studentJoined(sessionId, {
            id: userId,
            name,
            device,
            role,
            mail,
        });

        const sessionResult = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT type
                FROM sessions
                WHERE id = $1
            `,
            sqlParams: [rpg2.param("plain", sessionId)],
        });

        if (sessionResult.length === 0 || !sessionResult[0].type) {
            return res.status(400).json({ status: "end" });
        }

        const sessionType = sessionResult[0].type;
        req.session.ses = sessionId;

        const redirectUrl =
            sessionType === "R" || sessionType === "J"
                ? "role-playing"
                : sessionType === "T"
                ? "ethics"
                : "select";

        return res.json({ status: "ok", redirect: redirectUrl, sesid: sessionId });
    } catch (err) {
        console.error("Error joining session:", err);
        return res.status(500).json({ status: "error", message: "Internal server error." });
    }
});

router.get("/activities/:session_id/current_phase_state", async (req, res) => {
    const sessionId = Number(req.params.session_id);
    const invalidate = req.query.invalidate === "true";

    if (!sessionId || isNaN(sessionId)) {
        return res.status(400).json({ error: "Invalid session ID." });
    }

    if (!requireRole(req, res, "A")) {
        return;
    }

    try {
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

    if (!sessionId || !userId) {
        return res.status(400).json({ error: "Invalid session ID or user ID." });
    }

    if (!requireRole(req, res, "A")) {
        return;
    }

    if (!requireOwnershipOrRole(req, res, userId, [])) {
        return;
    }

    try {
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
        const phaseId = await getCurrentPhaseIdForSession(sessionId);
        if (!phaseId) {
            return res.status(409).json({ error: "Session has no active phase." });
        }

        const designType = await getDesignTypeBySessionId(sessionId);
        const handler = responseSubmissionHandlers[designType];

        if (!handler) {
            return res.status(400).json({ error: `Unsupported design type: ${designType}` });
        }

        const notificationData = await handler({
            sessionId,
            phaseId,
            userId,
            questionId: Number(questionId),
            payload:    req.body,
        });

        emitResponseSubmittedNotification(sessionId, phaseId, notificationData);

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

async function submitSemanticDifferentialResponse({ phaseId, userId, questionId, payload }) {
    const value = Number(payload.value);
    const justification = normalizeText(payload.justification);

    const task = await getSemanticDifferentialTask(phaseId, questionId);
    if (!task) {
        throw badRequest("Question not found in the current phase.");
    }

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
        type: "semantic_differential",
        uid:  userId,
        did:  questionId,
        sel:  value,
        comment: justification,
    };
}

async function submitRankingResponse({ phaseId, userId, questionId, payload }) {
    const itemId = Number(payload.itemId ?? questionId);
    const order = Number(payload.order);
    const justification = normalizeText(payload.justification);

    if (!itemId || isNaN(itemId)) {
        throw badRequest("Missing or invalid itemId.");
    }

    if (!Number.isInteger(order) || order < 1) {
        throw badRequest("Invalid order. It must be an integer greater than or equal to 1.");
    }

    const task = await getRankingTask(phaseId, itemId);
    if (!task) {
        throw badRequest("Ranking item not found in the current phase.");
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
        type: "ranking",
        uid:  userId,
        items: [
            {
                actorid: itemId,
                orden: order,
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

async function getCurrentPhaseIdForSession(sessionId) {
    const result = await rpg2.execSQL({
        dbcon: config.dbconnString,
        sql:   `
            SELECT current_stage
            FROM sessions
            WHERE id = $1
            LIMIT 1;
        `,
        sqlParams: [rpg2.param("plain", Number(sessionId))],
    });

    if (!result.length) {
        throw notFound("Session not found.");
    }

    return result[0].current_stage;
}

async function getSemanticDifferentialTask(phaseId, questionId) {
    const result = await rpg2.execSQL({
        dbcon: config.dbconnString,
        sql:   `
            SELECT id, num AS num_values, justify AS requires_justification, word_count AS min_word_count
            FROM differential
            WHERE stageid = $1
              AND id = $2
            LIMIT 1;
        `,
        sqlParams: [rpg2.param("plain", Number(phaseId)), rpg2.param("plain", Number(questionId))],
    });

    return result[0];
}

async function getRankingTask(phaseId, itemId) {
    const result = await rpg2.execSQL({
        dbcon: config.dbconnString,
        sql:   `
            SELECT id, justified AS requires_justification, word_count AS min_word_count
            FROM actors
            WHERE stageid = $1
              AND id = $2
            LIMIT 1;
        `,
        sqlParams: [rpg2.param("plain", Number(phaseId)), rpg2.param("plain", Number(itemId))],
    });

    return result[0];
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

function notFound(message) {
    const error = new Error(message);
    error.statusCode = 404;
    return error;
}

export default router;
