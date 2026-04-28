"use strict";

import express from "express";
import { requireOwnershipOrRole, requireRole } from "../../helpers/auth-helper.js";
import * as StudentActivityStatusHelper from "../../helpers/student-activity-state-helper.js";

const router = express.Router();

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

router.get('/activities/:id/users/:user_id/full_state', async (req, res) => {
    const sessionId = Number(req.params.id);
    const userId = Number(req.params.user_id);
    const invalidate = req.query.invalidate === 'true';

    if (!sessionId || !userId) {
        return res.status(400).json({ error: 'Invalid session ID or user ID.' });
    }

    if (!requireRole(req, res, 'A')) {
        return;
    }

    if (!requireOwnershipOrRole(req, res, userId, [])) {
        return;
    }

    try {
        const { descriptor } = await StudentActivityStatusHelper.
            getCachedStudentActivityDescriptor(sessionId, invalidate);

        if (!descriptor || !descriptor.design) {
            return res.status(404).json({ error: 'Descriptor not found for the given session.' });
        }

        const { phases } = await StudentActivityStatusHelper.
            getCachedStudentActivityPhases(sessionId, invalidate);

        if (!phases || phases.length === 0) {
            return res.status(404).json({ error: 'No phases found for the given session.' });
        }

        const designType = descriptor?.design?.type || await StudentActivityStatusHelper.
            getDesignTypeBySessionId(sessionId);

        if (!designType) {
            return res.status(400).json({ error: 'Design type could not be determined.' });
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
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

export default router;
