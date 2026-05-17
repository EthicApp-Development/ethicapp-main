"use strict";

import express from "express";
import * as config from "../../config/database.config.js";
import * as rpg2 from "../../db/rest-pg-2.js";
import * as ActivitiesHelper from "../../helpers/activities-helper.js";
import * as StatusCodes from "../../../common/modules/session-status.js";
import { requireRole } from "../../helpers/auth-helper.js";
import { studentNotifications } from "../../config/socket.config.js";
import redisClient from "../../db/redis.js";
import { getDesignTypeBySessionId } from "./activities-common.js";

const router = express.Router();

router.post("/sessions", async (req, res) => {
    if (!requireRole(req, res, "P")) {
        return;
    }

    const uid = Number(req.session.uid);
    const { name, description, type } = req.body;

    if (!name || !type) {
        return res.status(400).json({ status: "err", message: "Missing activity session data." });
    }

    try {
        const sessionResult = await rpg2.singleSQL({
            dbcon: config.dbconnString,
            sql: `
                INSERT INTO sessions(name, descr, creator, time, status, type)
                VALUES ($1, $2, $3, now(), 1, $4)
                RETURNING id;
            `,
            sqlParams: [
                rpg2.param("plain", name),
                rpg2.param("plain", description || null),
                rpg2.param("plain", uid),
                rpg2.param("plain", type),
            ],
        });

        const sessionId = Number(sessionResult?.id);

        if (!sessionId) {
            throw new Error("Failed to retrieve session ID.");
        }

        await rpg2.singleSQL({
            dbcon: config.dbconnString,
            sql: `
                INSERT INTO sessions_users(session_id, user_id)
                VALUES ($1, $2);
            `,
            sqlParams: [
                rpg2.param("plain", sessionId),
                rpg2.param("plain", uid),
            ],
        });

        return res.status(201).json({ status: 200, id: sessionId });
    } catch (err) {
        console.error("Error in POST /sessions:", err);
        return res.status(400).json({ status: 400, message: "Error creating activity session." });
    }
});

router.get("/sessions/:id/users", async (req, res) => {
    if (!requireRole(req, res, "P")) {
        return;
    }

    const sessionId = Number(req.params.id);
    const userId = Number(req.session.uid);

    if (!sessionId || !userId) {
        return res.status(400).json({ error: "Missing required parameters: session id or user id." });
    }

    try {
        const validationResult = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT id
                FROM sessions
                WHERE id = $1
                  AND creator = $2
            `,
            sqlParams: [
                rpg2.param("plain", sessionId),
                rpg2.param("plain", userId),
            ],
        });

        if (validationResult.length === 0) {
            return res.status(403).json({ error: "Access denied. User is not authorized for this session." });
        }

        const users = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT u.id,
                       u.name,
                       u.mail,
                       u.role,
                       su.device
                FROM users AS u
                INNER JOIN sessions_users AS su
                    ON u.id = su.user_id
                WHERE su.session_id = $1
                ORDER BY u.role DESC
            `,
            sqlParams: [rpg2.param("plain", sessionId)],
        });

        return res.status(200).json({ users });
    } catch (err) {
        console.error("Error fetching users for session:", err);
        return res.status(500).json({ error: "Internal server error" });
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
                WHERE sessions.creator = $1;
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

router.post("/activities", async (req, res) => {
    if (!requireRole(req, res, "P")) {
        return;
    }
    const sessionId = req.body.sessionId;
    const designId = req.body.designId;

    try {
        if (!sessionId || !designId) {
            return res.status(400).json({ status: "err", message: "Missing session or design ID" });
        }

        const sessionCode = ActivitiesHelper.generateSessionCode(sessionId);

        await rpg2.singleSQL({
            dbcon: config.dbconnString,
            sql: `
                UPDATE sessions
                SET code = $1
                WHERE id = $2
                  AND code IS NULL
            `,
            sqlParams: [rpg2.param('plain', sessionCode), rpg2.param('plain', sessionId)],
        });

        await rpg2.singleSQL({
            dbcon: config.dbconnString,
            sql: `
                INSERT INTO activity (design, session)
                VALUES ($1, $2)
            `,
            sqlParams: [rpg2.param('plain', designId), rpg2.param('plain', sessionId)],
        });

        await rpg2.singleSQL({
            dbcon: config.dbconnString,
            sql: `
                UPDATE designs
                SET locked = TRUE
                WHERE id = $1
            `,
            sqlParams: [rpg2.param('plain', designId)],
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

        return res.status(200).json({ status: "ok", activity });
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

router.post("/activities/:session_id/phase_transition", async (req, res) => {
    if (!requireRole(req, res, "P")) {
        return;
    }
    const { session_id: sessionId } = req.params;
    const { phaseId } = req.body;

    if (!sessionId || !phaseId) {
        return res.status(400).json({ error: "Missing required parameters: session_id or phase_id." });
    }

    const status = StatusCodes.getStatusCode("in_progress");

    try {
        let result = await rpg2.execSQL({
            sql: `
                SELECT COUNT(*)::integer
                FROM phases
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
                    current_phase_id = $2
                WHERE id = $3
            `,
            dbcon: config.dbconnString,
            sqlParams: [rpg2.param('plain', status), rpg2.param('plain', phaseId), rpg2.param('plain', sessionId)],
        });

        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Session not found or no update performed." });
        }

        await redisClient.del(`descriptor:${sessionId}`);
        studentNotifications.phaseTransition(sessionId);

        res.status(200).json({ status: "ok", message: "Session transitioned to the new phase." });
    } catch (err) {
        console.error("Error transitioning session stage:", err);
        res.status(500).json({ error: "Internal server error" });
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

    const status = StatusCodes.getStatusCode("finished");

    try {
        const result = await rpg2.execSQL({
            sql: `
                UPDATE sessions
                SET status = $1,
                    current_phase_id = NULL
                WHERE id = $2
            `,
            dbcon: config.dbconnString,
            sqlParams: [rpg2.param('plain', status), rpg2.param('plain', sessionId)],
        });

        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Session not found or no update performed." });
        }

        studentNotifications.endSession(sessionId);

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
        const phases = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT id,
                       phase_number AS number,
                       phase_type AS type,
                       anonymous AS anon,
                       chat_enabled AS chat,
                       previous_answers AS prev_ans,
                       question,
                       grouping
                FROM phases
                WHERE session_id = $1
                ORDER BY phase_number
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

router.post("/activities/:session_id/phases", async (req, res) => {
    if (!requireRole(req, res, "P")) {
        return;
    }
    const { session_id } = req.params;
    const {
        number,
        type,
        anon,
        chat,
        prev_ans,
        question,
        grouping,
    } = req.body;

    if (!session_id || !number || !type) {
        return res.status(400).json({
            error: "Missing required parameters: session_id, number, or type.",
        });
    }

    const queryParams = [
        rpg2.param('plain', number),
        rpg2.param('plain', type),
        rpg2.param('plain', anon || false),
        rpg2.param('plain', chat || false),
        rpg2.param('plain', session_id),
        rpg2.param('plain', JSON.stringify(prev_ans) || null),
        rpg2.param('plain', question || null),
        rpg2.param('plain', grouping || null),
    ];

    try {
        const result = await rpg2.execSQL({
            sql: `
                INSERT INTO phases (
                    phase_number,
                    phase_type,
                    anonymous,
                    chat_enabled,
                    session_id,
                    previous_answers,
                    question,
                    grouping
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING id AS phase_id
            `,
            dbcon: config.dbconnString,
            sqlParams: queryParams,
        });

        if (result.rowCount === 0) {
            return res.status(500).json({
                error: "Failed to add the phase. No rows were inserted.",
            });
        }

        res.status(201).json({
            status: "ok",
            phaseId: result[0].phase_id,
            message: "Phase added successfully.",
        });
    } catch (err) {
        console.error("Error adding phase:", err);
        res.status(500).json({ error: "Internal server error" });
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
            SELECT d.phase_id,
                   d.orden,
                   s.uid,
                   r.group_id,
                   s.did,
                   s.sel,
                   s.comment,
                   st.phase_number AS phase_number
            FROM differential_selection AS s
            INNER JOIN differential AS d
                ON s.did = d.id
            INNER JOIN phases AS st
                ON d.phase_id = st.id
            LEFT JOIN (
                SELECT tu.*
                FROM groups_users AS tu
                INNER JOIN groups AS t
                    ON tu.group_id = t.id
            ) AS r
                ON r.user_id = s.uid
            WHERE st.session_id = $1
            ORDER BY d.phase_id, s.uid, d.orden
        `,
        dbcon: config.dbconnString,
        sqlParams: [rpg2.param('plain', sessionId)],
    });

    return results;
}

async function fetchSemanticDifferentialGroupResponses(groupId, phaseId) {
    const results = await rpg2.execSQL({
        sql: `
            SELECT d.phase_id,
                   d.orden,
                   d.id AS did,
                   tu.user_id AS uid,
                   u.name AS user_name,
                   tu.group_id,
                   s.sel,
                   s.comment,
                   s.stime
            FROM differential AS d
            INNER JOIN groups_users AS tu
                ON tu.group_id = $1
            INNER JOIN users AS u
                ON u.id = tu.user_id
            LEFT JOIN differential_selection AS s
                ON s.did = d.id
               AND s.uid = tu.user_id
            WHERE d.phase_id = $2
            ORDER BY d.orden, u.name
        `,
        dbcon: config.dbconnString,
        sqlParams: [rpg2.param("plain", groupId), rpg2.param("plain", phaseId)],
    });

    return results.map(row => ({
        phaseId: row.phase_id,
        questionOrder: row.orden,
        questionId: row.did,
        userId: row.uid,
        userName: row.user_name,
        groupId: row.group_id,
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
                   st.phase_number AS phase_number
            FROM actor_selection AS a
            INNER JOIN phases AS st
                ON a.phase_id = st.id
            WHERE st.session_id = $1
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
                   tu.user_id AS uid,
                   u.name AS user_name,
                   tu.group_id,
                   a.stime
            FROM groups_users AS tu
            INNER JOIN users AS u
                ON u.id = tu.user_id
            LEFT JOIN actor_selection AS a
                ON a.uid = tu.user_id
               AND a.phase_id = $2
            WHERE tu.group_id = $1
            ORDER BY tu.user_id, a.orden
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
        groupId: row.group_id,
        submittedAt: row.stime,
    }));
}

async function getDesignTypeByGroupAndPhase(groupId, phaseId) {
    const groupPhase = await rpg2.execSQL({
        sql: `
            SELECT id AS group_id
            FROM groups
            WHERE id = $1
              AND phase_id = $2
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
                SELECT session_id
                FROM phases
                WHERE id = $1
            `,
            dbcon: config.dbconnString,
            sqlParams: [rpg2.param("plain", phaseId)],
        }).then(row => row.session_id)
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
