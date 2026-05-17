"use strict";

import express from "express";
import * as config from "../../config/database.config.js";
import * as rpg2 from "../../db/rest-pg-2.js";
import * as DesignTypes from "../../../common/modules/design-types.js";
import * as StatusCodes from "../../../common/modules/session-status.js";
import { requireRole, requireOwnershipOrRole } from "../../helpers/auth-helper.js";
import * as StudentActivityStatusHelper from "../../helpers/student-activity-state-helper.js";

const router = express.Router();

router.get("/activities/:session_id/descriptor", async (req, res) => {
    if (!requireRole(req, res, ["P", "A"])) {
        return;
    }
    const { session_id } = req.params;

    if (!session_id || isNaN(Number(session_id))) {
        return res.status(400).json({ error: "Invalid or missing required parameter: session_id." });
    }

    try {
        const pool = await rpg2.getDBInstance(config.dbconnString);

        if (!pool || typeof pool.query !== "function") {
            throw new Error("Database pool not properly initialized or invalid.");
        }

        const queryText = `
            SELECT
                activity.id AS id,
                activity.session AS sessionId,
                sessions.creator,
                sessions.name,
                sessions.descr AS description,
                sessions.time,
                sessions.code,
                sessions.archived,
                sessions.status,
                sessions.type,
                designs.id AS designId,
                designs.design
            FROM activity
            INNER JOIN sessions
                ON activity.session = sessions.id
            INNER JOIN designs
                ON activity.design = designs.id
            WHERE activity.session = $1
            ORDER BY activity.id DESC
            LIMIT 1;
        `;

        const result = await pool.query(queryText, [Number(session_id)]);

        if (!result.rows || result.rows.length === 0) {
            console.warn(`No activity found for session_id: ${session_id}`);
            return res.status(404).json({ error: "No activity found for the given session." });
        }

        const activityResult = result.rows[0];
        const designType = activityResult.design.type;
        const phases = await getPhasesForSessionByDesignType(session_id, designType);

        const descriptor = {
            id: activityResult.id,
            sessionId: activityResult.sessionid,
            creator: activityResult.creator,
            name: activityResult.name,
            description: activityResult.description,
            time: activityResult.time,
            code: activityResult.code,
            archived: activityResult.archived,
            status: StatusCodes.getNameByCode(activityResult.status),
            type: activityResult.type,
            designId: activityResult.designid,
            design: activityResult.design,
            phases: phases || [],
            currentPhase: phases && phases.length > 0 ? phases[phases.length - 1] : null,
        };

        console.info(`Successfully retrieved activity descriptor for session_id: ${session_id}.`);
        return res.status(200).json({ descriptor });
    } catch (err) {
        console.error(`Error fetching activity descriptor for session_id: ${session_id}`, err);
        return res.status(500).json({ error: "Internal server error" });
    }
});

router.get('/activities/:session_id/users/:user_id/peer_responses', async (req, res) => {
    try {
        const sessionId = Number(req.params.session_id);
        const userId = Number(req.params.user_id);

        if (isNaN(sessionId) || isNaN(userId)) {
            return res.status(400).json({ error: 'Invalid session_id or user_id' });
        }

        if (!requireOwnershipOrRole(req, res, userId, 'P')) {
            return;
        }

        const { phases } = req.body;
        if (!Array.isArray(phases) || phases.length === 0) {
            return res.status(400).json({ error: 'Phases must be a non-empty array' });
        }

        const designType = await getDesignTypeBySessionId(sessionId);
        if (!designType) {
            return res.status(404).json({ error: 'Design type not found for the given session' });
        }

        const updatedPhases = await StudentActivityStatusHelper.getCachedStudentActivityPeerResponses(
            designType,
            sessionId,
            userId,
            phases
        );

        return res.status(200).json({ status: 'ok', phases: updatedPhases });
    } catch (error) {
        console.error('Error in /activities/:session_id/users/:user_id/peer_responses:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

export async function getDesignTypeBySessionId(sessionId) {
    const result = await rpg2.execSQL({
        sql: `
            SELECT d.design->>'type' AS design_type
            FROM activity AS a
            INNER JOIN designs AS d
                ON a.design = d.id
            WHERE a.session = $1
        `,
        dbcon: config.dbconnString,
        sqlParams: [rpg2.param('plain', sessionId)],
    });

    if (result.length === 0) {
        throw new Error(`No design found for session ID: ${sessionId}`);
    }

    const designType = result[0].design_type;

    if (!DesignTypes.isValidDesignType(designType)) {
        throw new Error(`Unsupported design type: ${designType}`);
    }

    return designType;
}

async function getPhasesForSessionByDesignType(sessionId, designType) {
    const results = await rpg2.execSQL({
        dbcon: config.dbconnString,
        sql: `
            SELECT id,
                   phase_type AS type,
                   phase_number AS number
            FROM phases
            WHERE session_id = $1
            ORDER BY phase_number ASC
        `,
        sqlParams: [rpg2.param('plain', sessionId)],
    });

    if (results.length === 0) {
        return [];
    }

    return Promise.all(
        results.map(async (row) => {
            const questions = await getQuestionsByPhase(row.id, designType);
            return {
                id: row.id,
                number: row.number,
                mode: row.type,
                questions,
            };
        })
    );
}

async function getQuestionsByPhase(phaseId, type) {
    const handler = questionFetchHandlers[type];
    if (!handler) {
        throw new Error(`Unsupported design type: ${type}`);
    }

    return handler(phaseId);
}

const questionFetchHandlers = {
    semantic_differential: async (phaseId) => {
        const results = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT id,
                justify,
                orden,
                num
                FROM differential
                WHERE phase_id = $1
                ORDER BY orden ASC
            `,
            sqlParams: [rpg2.param('plain', phaseId)],
        });

        return results.map((row, index) => ({
            id: row.id,
            number: index + 1,
            justify: row.justify,
            range: row.num,
            order: row.orden,
        }));
    },
    ranking: async (phaseId) => {
        const results = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT id
                FROM actors
                WHERE phase_id = $1
                ORDER BY id ASC
            `,
            sqlParams: [rpg2.param('plain', phaseId)],
        });

        return results.map((row) => ({
            name: row.name,
            id: row.id,
        }));
    },
};

export default router;
