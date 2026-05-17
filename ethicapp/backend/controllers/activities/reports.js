"use strict";

import express from "express";
import * as config from "../../config/database.config.js";
import * as rpg2 from "../../db/rest-pg-2.js";
import { requireRole } from "../../helpers/auth-helper.js";
import {
    createActivityReportExportLog,
    markActivityReportExportFailed,
} from "../../helpers/activity-report-audit-helper.js";
import { getDesignTypeBySessionId } from "./activities-common.js";

const router = express.Router();
const REPORT_NOT_IMPLEMENTED = "REPORT_NOT_IMPLEMENTED";

function parseSessionId(rawSessionId) {
    const sessionId = Number(rawSessionId);
    return Number.isInteger(sessionId) && sessionId > 0 ? sessionId : null;
}

async function getTeacherActivityContext(sessionId, teacherId) {
    const rows = await rpg2.execSQL({
        dbcon: config.dbconnString,
        sql: `
            SELECT
                activity.id AS activity_id,
                activity.session AS session_id,
                activity.design AS design_id,
                sessions.creator,
                sessions.name,
                sessions.descr AS description
            FROM activity
            INNER JOIN sessions
                ON activity.session = sessions.id
            WHERE activity.session = $1
              AND sessions.creator = $2
            ORDER BY activity.id DESC
            LIMIT 1
        `,
        sqlParams: [
            rpg2.param("plain", sessionId),
            rpg2.param("plain", teacherId),
        ],
    });

    return rows[0] || null;
}

async function loadReportContext(req, res) {
    if (!requireRole(req, res, "P")) {
        return null;
    }

    const sessionId = parseSessionId(req.params.session_id);
    if (!sessionId) {
        res.status(400).json({ status: "err", error: "Invalid or missing required parameter: session_id." });
        return null;
    }

    const activity = await getTeacherActivityContext(sessionId, req.session.uid);
    if (!activity) {
        res.status(404).json({ status: "err", error: "No activity found for the given session." });
        return null;
    }

    const designType = await getDesignTypeBySessionId(sessionId);
    return { activity, designType, sessionId };
}

const fullReportHandlers = {
    semantic_differential: async () => {
        const error = new Error("Semantic differential full report export is not implemented yet.");
        error.code = REPORT_NOT_IMPLEMENTED;
        throw error;
    },
    ranking: async () => {
        const error = new Error("Ranking full report export is not implemented yet.");
        error.code = REPORT_NOT_IMPLEMENTED;
        throw error;
    },
};

const chatTranscriptHandlers = {
    semantic_differential: async () => {
        const error = new Error("Semantic differential chat transcript export is not implemented yet.");
        error.code = REPORT_NOT_IMPLEMENTED;
        throw error;
    },
    ranking: async () => {
        const error = new Error("Ranking chat transcript export is not implemented yet.");
        error.code = REPORT_NOT_IMPLEMENTED;
        throw error;
    },
};

function notImplementedResponse(res, reportType, context, exportLog = null) {
    return res.status(501).json({
        status: "err",
        error: "Report export is not implemented yet.",
        reportType,
        designType: context.designType,
        sessionId: context.sessionId,
        exportLogId: exportLog?.id || null,
    });
}

async function processReportRequest(req, res, { reportType, handlers }) {
    const context = await loadReportContext(req, res);
    if (!context) {
        return;
    }

    const exportLog = await createActivityReportExportLog({
        req,
        activity: context.activity,
        designType: context.designType,
        reportType,
        exportFormat: "csv",
        metadata: {
            route: req.originalUrl,
            activityName: context.activity.name,
        },
    });

    const handler = handlers[context.designType];
    if (!handler) {
        await markActivityReportExportFailed(exportLog.id, {
            errorMessage: `Unsupported design type: ${context.designType}`,
            metadata: {
                failureCode: "UNSUPPORTED_DESIGN_TYPE",
            },
        });
        return res.status(400).json({
            status: "err",
            error: `Unsupported design type: ${context.designType}`,
            exportLogId: exportLog.id,
        });
    }

    try {
        await handler(context);
    } catch (error) {
        await markActivityReportExportFailed(exportLog.id, {
            errorMessage: error.message,
            metadata: {
                failureCode: error.code || "REPORT_EXPORT_FAILED",
            },
        });

        if (error.code === REPORT_NOT_IMPLEMENTED) {
            return notImplementedResponse(res, reportType, context, exportLog);
        }

        throw error;
    }
}

router.get("/activity/:session_id/full_report", async (req, res) => {
    try {
        return await processReportRequest(req, res, {
            reportType: "full_report",
            handlers: fullReportHandlers,
        });
    } catch (error) {
        console.error("Error in GET /activity/:session_id/full_report:", error);
        return res.status(500).json({ status: "err", error: "Internal server error." });
    }
});

router.get("/activity/:session_id/chat_transcript", async (req, res) => {
    try {
        return await processReportRequest(req, res, {
            reportType: "chat_transcript",
            handlers: chatTranscriptHandlers,
        });
    } catch (error) {
        console.error("Error in GET /activity/:session_id/chat_transcript:", error);
        return res.status(500).json({ status: "err", error: "Internal server error." });
    }
});

export default router;
