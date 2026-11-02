"use strict";

import express from "express";
import * as config from "../../config/database.config.js";
import * as rpg2 from "../../db/rest-pg-2.js";
import * as ActivitiesHelper from "../../helpers/activities-helper.js";
import { launchActivity } from "../../helpers/activity-launch-helper.js";
import { servicesNotRunningAtLaunch } from "../../helpers/ai-service-launch-notice.js";
import { requireRole } from "../../helpers/auth-helper.js";
import {
    launchAiServicesEnabled,
    sessionAiServicesEnabled,
} from "../../helpers/session-ai-services.js";
import { getDesignTypeBySessionId } from "./activities-common.js";
import activityFinisher from "../../helpers/activity-finish-helper.js";
import { CREATE_SESSION_SQL } from "../../helpers/teacher-activity-writes.js";
import {
    requireLaunchableDesign,
    requirePhaseOwner,
    requireSessionOwner,
} from "../../helpers/activity-owner-helper.js";

const router = express.Router();

router.post("/sessions", async (req, res) => {
    if (!requireRole(req, res, "P")) {
        return;
    }

    const teacherId = req.session.uid;
    const { name, description, type } = req.body;

    if (!name || !type) {
        return res.status(400).json({ status: "err", message: "Missing required session fields." });
    }

    try {
        // Nothing is created for an account that was forgotten meanwhile.
        const session = await rpg2.singleSQL({
            dbcon:     config.dbconnString,
            sql:       CREATE_SESSION_SQL,
            sqlParams: [
                rpg2.param("plain", name),
                rpg2.param("plain", description || ""),
                rpg2.param("plain", teacherId),
                rpg2.param("plain", type),
            ],
        });

        if (!session?.id) {
            return res.status(403).json({
                status:  "err",
                message: "The account cannot create activities.",
            });
        }

        await rpg2.singleSQL({
            dbcon: config.dbconnString,
            sql: `
                INSERT INTO sesusers (sesid, uid)
                VALUES ($1, $2);
            `,
            sqlParams: [
                rpg2.param("plain", session.id),
                rpg2.param("plain", teacherId),
            ],
        });

        return res.status(201).json({ status: "ok", id: session.id });
    } catch (err) {
        console.error("Error in POST /sessions:", err);
        return res.status(500).json({ status: "err", message: "Error creating session." });
    }
});

router.get("/activities", async (req, res) => {
    try {
        if (!requireRole(req, res, "P")) {
            return;
        }

        const userId = req.session.uid;

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
                WHERE sessions.creator = $1
                ORDER BY sessions.time DESC, sessions.id DESC;
            `,
            sqlParams: [rpg2.param("plain", userId)],
        });

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

        return res.status(200).json({ status: "ok", activities });
    } catch (err) {
        console.error("Error in GET /activities:", err);
        return res.status(500).json({ status: "err", error: "Error retrieving activities." });
    }
});

router.get("/sessions/:id/users", async (req, res) => {
    if (!requireRole(req, res, "P")) {
        return;
    }

    const sessionId = Number(req.params.id);

    if (!Number.isInteger(sessionId) || sessionId <= 0) {
        return res.status(400).json({ error: "Invalid or missing required parameter: session id." });
    }

    try {
        // Only the activity's teacher lists its participants, and another
        // teacher's session is answered as an unknown one (#925).
        if (!await requireSessionOwner(req, res, sessionId)) {
            return;
        }

        const users = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT u.id,
                       u.name,
                       u.mail,
                       NULL AS aprendizaje,
                       u.role,
                       su.device
                FROM users AS u
                INNER JOIN sesusers AS su
                    ON u.id = su.uid
                WHERE su.sesid = $1
                ORDER BY u.role DESC
            `,
            sqlParams: [rpg2.param("plain", sessionId)],
        });

        return res.status(200).json({ users });
    } catch (err) {
        console.error("Error in GET /sessions/:id/users:", err);
        return res.status(500).json({ error: "Internal server error" });
    }
});

router.post("/activities", async (req, res) => {
    if (!requireRole(req, res, "P")) {
        return;
    }
    const sessionId = req.body.sessionId;
    const designId = req.body.designId;
    // `aiServices: false` launches the activity with the design's AI
    // services turned off (#970); anything else keeps them on.
    const aiServicesEnabled = launchAiServicesEnabled(req.body.aiServices);

    try {
        if (!sessionId || !designId) {
            return res.status(400).json({ status: "err", message: "Missing session or design ID" });
        }

        // Only the session's teacher launches it, with a design of theirs
        // (#910).
        if (!await requireSessionOwner(req, res, sessionId)
            || !await requireLaunchableDesign(req, res, designId)) {
            return;
        }

        const sessionCode = ActivitiesHelper.generateSessionCode(sessionId);

        const { policyVersionId } = await launchActivity({
            sessionId, designId, sessionCode, aiServicesEnabled,
        });

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
                    sessions.ai_services_enabled,
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

        return res.status(200).json({
            status:             "ok",
            activity,
            servicesNotRunning: await servicesNotRunningAtLaunch({
                design:            activity?.design,
                policyVersionId,
                // The stored switch: a relaunch keeps the first launch's.
                aiServicesEnabled: sessionAiServicesEnabled(activity),
            }),
        });
    } catch (error) {
        console.error("Error in POST /activities endpoint:", error);
        return res.status(500).json({ status: "err", message: "Error processing activity addition" });
    }
});

router.get("/activities/:session_id/responses", async (req, res) => {
    if (!requireRole(req, res, "P")) {
        return;
    }
    const { session_id } = req.params;

    if (!session_id || isNaN(Number(session_id))) {
        return res.status(400).json({ error: "Invalid or missing required parameter: session_id" });
    }

    try {
        // Only the activity's teacher reads its responses (#910).
        if (!await requireSessionOwner(req, res, session_id)) {
            return;
        }

        const designType = await getDesignTypeBySessionId(session_id);

        const handler = activityResponsesFetchHandlers[designType];
        if (!handler) {
            return res.status(400).json({ error: `Unsupported design type: ${designType}` });
        }

        const results = await handler(session_id);

        if (!results || results.length === 0) {
            console.warn(`No responses found for session_id: ${session_id}`);
            return res.status(200).json({ phases: [] });
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

router.get("/groups/:group_id/responses", async (req, res) => {
    if (!requireRole(req, res, "P")) {
        return;
    }

    const { group_id: groupId } = req.params;
    const { phase_id: phaseId } = req.query;

    if (!groupId || isNaN(Number(groupId))) {
        return res.status(400).json({ error: "Invalid or missing required parameter: group_id" });
    }

    if (!phaseId || isNaN(Number(phaseId))) {
        return res.status(400).json({ error: "Invalid or missing required query parameter: phase_id" });
    }

    try {
        // Only the activity's teacher reads a group's responses (#910). The
        // group must then belong to that phase.
        if (!await requirePhaseOwner(req, res, phaseId)) {
            return;
        }

        const designType = await getDesignTypeByGroupAndPhase(groupId, phaseId);

        const handler = groupResponsesFetchHandlers[designType];
        if (!handler) {
            return res.status(400).json({ error: `Unsupported design type: ${designType}` });
        }

        const responses = await handler(groupId, phaseId);

        return res.status(200).json({ responses });
    } catch (err) {
        if (err.message === "GROUP_PHASE_MISMATCH") {
            return res.status(404).json({ error: "Group not found for this phase." });
        }

        console.error(`Error fetching responses for group_id: ${groupId}, phase_id: ${phaseId}`, err);
        return res.status(500).json({ error: "Internal server error" });
    }
});

router.post("/activities/:session_id/finish", async (req, res) => {
    if (!requireRole(req, res, "P")) {
        return;
    }
    const { session_id: sessionId } = req.params;

    if (!sessionId) {
        return res.status(400).json({ error: "Missing required parameter: session_id" });
    }

    try {
        // Only the activity's teacher finishes it (#910).
        if (!await requireSessionOwner(req, res, sessionId)) {
            return;
        }

        // Shared with the internal endpoint that finishes every open activity
        // of a teacher (#881): status, phase-ended, student notification and
        // activity-finished to every service enabled in the design.
        const result = await activityFinisher.finishActivity(sessionId);

        if (result.status === "not_found") {
            return res.status(404).json({ error: "Session not found." });
        }

        if (result.status === "not_updated") {
            return res.status(404).json({ error: "Session not found or no update performed." });
        }

        res.status(200).json({ status: "ok", message: "Activity session finished successfully." });
    } catch (err) {
        console.error("Error finishing activity session:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.get("/activities/:session_id/phases", async (req, res) => {
    if (!requireRole(req, res, "P")) {
        return;
    }
    const { session_id } = req.params;

    if (!session_id || isNaN(Number(session_id))) {
        return res.status(400).json({ error: "Invalid or missing required parameter: session_id." });
    }

    try {
        // Only the activity's teacher reads its phases (#910).
        if (!await requireSessionOwner(req, res, session_id)) {
            return;
        }

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

        if (!phases || phases.length === 0) {
            console.warn(`No phases found for session_id: ${session_id}`);
            return res.status(200).json({ phases: [] });
        }

        console.info(`Successfully retrieved ${phases.length} phases for session_id: ${session_id}.`);
        return res.status(200).json({ phases });
    } catch (err) {
        console.error(`Error fetching phases for session_id: ${session_id}`, err);
        return res.status(500).json({ error: "Internal server error" });
    }
});

router.patch("/activities/:session_id/toggle_archived", async (req, res) => {
    if (!requireRole(req, res, "P")) {
        return;
    }
    try {
        const sessionId = req.params.session_id;

        if (!sessionId) {
            return res.status(400).json({ status: "err", message: "Session ID is required" });
        }

        // Only the activity's teacher archives it (#910).
        if (!await requireSessionOwner(req, res, sessionId)) {
            return;
        }

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

async function fetchSemanticDifferentialGroupResponses(groupId, phaseId) {
    const results = await rpg2.execSQL({
        sql: `
            SELECT d.stageid,
                   d.orden,
                   d.id AS did,
                   tu.uid,
                   u.name AS user_name,
                   tu.tmid,
                   s.sel,
                   s.comment,
                   s.stime
            FROM differential AS d
            INNER JOIN teamusers AS tu
                ON tu.tmid = $1
            INNER JOIN users AS u
                ON u.id = tu.uid
            LEFT JOIN differential_selection AS s
                ON s.did = d.id
               AND s.uid = tu.uid
            WHERE d.stageid = $2
            ORDER BY d.orden, u.name
        `,
        dbcon: config.dbconnString,
        sqlParams: [rpg2.param("plain", groupId), rpg2.param("plain", phaseId)],
    });

    return results.map(row => ({
        phaseId: row.stageid,
        questionOrder: row.orden,
        questionId: row.did,
        userId: row.uid,
        userName: row.user_name,
        groupId: row.tmid,
        value: row.sel,
        comment: row.comment,
        submittedAt: row.stime,
    }));
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
        sqlParams: [rpg2.param('plain', sessionId)],
    });

    return results;
}

async function fetchRankingGroupResponses(groupId, phaseId) {
    const results = await rpg2.execSQL({
        sql: `
            SELECT a.id,
                   a.description,
                   a.orden,
                   a.actorid,
                   tu.uid,
                   u.name AS user_name,
                   tu.tmid,
                   a.stime
            FROM teamusers AS tu
            INNER JOIN users AS u
                ON u.id = tu.uid
            LEFT JOIN actor_selection AS a
                ON a.uid = tu.uid
               AND a.stageid = $2
            WHERE tu.tmid = $1
            ORDER BY tu.uid, a.orden
        `,
        dbcon: config.dbconnString,
        sqlParams: [rpg2.param("plain", groupId), rpg2.param("plain", phaseId)],
    });

    return results.map(row => ({
        phaseId,
        selectionId: row.id,
        description: row.description,
        order: row.orden,
        actorId: row.actorid,
        userId: row.uid,
        userName: row.user_name,
        groupId: row.tmid,
        submittedAt: row.stime,
    }));
}

async function getDesignTypeByGroupAndPhase(groupId, phaseId) {
    const groupPhase = await rpg2.execSQL({
        sql: `
            SELECT id
            FROM teams
            WHERE id = $1
              AND stageid = $2
        `,
        dbcon: config.dbconnString,
        sqlParams: [rpg2.param("plain", groupId), rpg2.param("plain", phaseId)],
    });

    if (groupPhase.length === 0) {
        throw new Error("GROUP_PHASE_MISMATCH");
    }

    return getDesignTypeBySessionId(
        await rpg2.singleSQL({
            sql: `
                SELECT sesid
                FROM stages
                WHERE id = $1
            `,
            dbcon: config.dbconnString,
            sqlParams: [rpg2.param("plain", phaseId)],
        }).then(row => row.sesid)
    );
}

const activityResponsesFetchHandlers = {
    semantic_differential: fetchSemanticDifferentialResponses,
    ranking: fetchRankingResponses,
};

const groupResponsesFetchHandlers = {
    semantic_differential: fetchSemanticDifferentialGroupResponses,
    ranking: fetchRankingGroupResponses,
};

export default router;
