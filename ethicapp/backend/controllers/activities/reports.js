"use strict";

import express from "express";
import crypto from "crypto";
import * as config from "../../config/database.config.js";
import * as rpg2 from "../../db/rest-pg-2.js";
import { requireRole } from "../../helpers/auth-helper.js";
import {
    createActivityReportExportLog,
    markActivityReportExportCompleted,
    markActivityReportExportFailed,
} from "../../helpers/activity-report-audit-helper.js";
import { getDesignTypeBySessionId } from "./activities-common.js";

const router = express.Router();
const REPORT_NOT_IMPLEMENTED = "REPORT_NOT_IMPLEMENTED";
const SEMANTIC_DIFFERENTIAL_RESPONSE_COLUMNS = [
    "id",
    "user_id",
    "team_id",
    "name",
    "rut",
    "gender",
    "question_number",
    "question_text",
    "left_pole",
    "right_pole",
    "max_scale_range",
    "selected_value",
    "comment",
    "phase_number",
    "time",
];
const SEMANTIC_DIFFERENTIAL_CHAT_COLUMNS = [
    "id",
    "user_id",
    "team_id",
    "name",
    "rut",
    "gender",
    "question_number",
    "question_text",
    "left_pole",
    "right_pole",
    "message",
    "phase_number",
    "time",
    "reply_to",
];

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
    semantic_differential: buildSemanticDifferentialResponsesReport,
    ranking: async () => {
        const error = new Error("Ranking full report export is not implemented yet.");
        error.code = REPORT_NOT_IMPLEMENTED;
        throw error;
    },
};

const chatTranscriptHandlers = {
    semantic_differential: buildSemanticDifferentialChatTranscript,
    ranking: async () => {
        const error = new Error("Ranking chat transcript export is not implemented yet.");
        error.code = REPORT_NOT_IMPLEMENTED;
        throw error;
    },
};

function padDatePart(value) {
    return String(value).padStart(2, "0");
}

function buildTimestampForFilename(date = new Date()) {
    return [
        date.getFullYear(),
        padDatePart(date.getMonth() + 1),
        padDatePart(date.getDate()),
        "-",
        padDatePart(date.getHours()),
        padDatePart(date.getMinutes()),
        padDatePart(date.getSeconds()),
    ].join("");
}

function csvEscape(value) {
    if (value === undefined || value === null) {
        return "\"\"";
    }

    const serializedValue = value instanceof Date
        ? value.toISOString()
        : String(value);
    return `"${serializedValue.replaceAll("\"", "\"\"")}"`;
}

function buildCsv(columns, rows) {
    const lines = [
        columns.map(csvEscape).join(","),
        ...rows.map(row => columns.map(column => csvEscape(row[column])).join(",")),
    ];

    return `${lines.join("\n")}\n`;
}

function hashContent(content) {
    return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

async function buildSemanticDifferentialResponsesReport(context) {
    const rows = await rpg2.execSQL({
        dbcon: config.dbconnString,
        sql: `
            SELECT
                ds.id,
                ds.uid AS user_id,
                tu.tmid AS team_id,
                u.name,
                u.rut,
                u.sex AS gender,
                d.orden AS question_number,
                d.title AS question_text,
                d.tleft AS left_pole,
                d.tright AS right_pole,
                d.num AS max_scale_range,
                ds.sel AS selected_value,
                ds.comment,
                st.number AS phase_number,
                ds.stime AS time
            FROM differential_selection AS ds
            INNER JOIN differential AS d
                ON ds.did = d.id
            INNER JOIN stages AS st
                ON d.stageid = st.id
            INNER JOIN users AS u
                ON ds.uid = u.id
            LEFT JOIN teams AS t
                ON t.sesid = st.sesid
               AND t.stageid = st.id
            LEFT JOIN teamusers AS tu
                ON tu.tmid = t.id
               AND tu.uid = ds.uid
            WHERE st.sesid = $1
            ORDER BY st.number, d.orden, u.name, ds.id
        `,
        sqlParams: [rpg2.param("plain", context.sessionId)],
    });

    const content = buildCsv(SEMANTIC_DIFFERENTIAL_RESPONSE_COLUMNS, rows);
    const filename = `responses_${context.sessionId}-${buildTimestampForFilename()}.csv`;

    return {
        content,
        filename,
        rowCount: rows.length,
        byteCount: Buffer.byteLength(content, "utf8"),
        contentSha256: hashContent(content),
    };
}

async function buildSemanticDifferentialChatTranscript(context) {
    const rows = await rpg2.execSQL({
        dbcon: config.dbconnString,
        sql: `
            SELECT
                dc.id,
                dc.uid AS user_id,
                COALESCE(dc.tmid, tu.tmid) AS team_id,
                u.name,
                u.rut,
                u.sex AS gender,
                d.orden AS question_number,
                d.title AS question_text,
                d.tleft AS left_pole,
                d.tright AS right_pole,
                dc.content AS message,
                st.number AS phase_number,
                dc.stime AS time,
                dc.parent_id AS reply_to
            FROM differential_chat AS dc
            INNER JOIN differential AS d
                ON dc.did = d.id
            INNER JOIN stages AS st
                ON d.stageid = st.id
            INNER JOIN users AS u
                ON dc.uid = u.id
            LEFT JOIN teams AS t
                ON t.sesid = st.sesid
               AND t.stageid = st.id
            LEFT JOIN teamusers AS tu
                ON tu.tmid = t.id
               AND tu.uid = dc.uid
            WHERE st.sesid = $1
            ORDER BY st.number, d.orden, team_id, dc.stime, dc.id
        `,
        sqlParams: [rpg2.param("plain", context.sessionId)],
    });

    const content = buildCsv(SEMANTIC_DIFFERENTIAL_CHAT_COLUMNS, rows);
    const filename = `chat_${context.sessionId}-${buildTimestampForFilename()}.csv`;

    return {
        content,
        filename,
        rowCount: rows.length,
        byteCount: Buffer.byteLength(content, "utf8"),
        contentSha256: hashContent(content),
    };
}

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

    let reportResult = null;
    try {
        reportResult = await handler(context);
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

    const report = await markActivityReportExportCompleted(exportLog.id, {
        rowCount: reportResult.rowCount,
        byteCount: reportResult.byteCount,
        contentSha256: reportResult.contentSha256,
    });

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${reportResult.filename}"`);
    res.setHeader("X-Activity-Report-Export-Id", String(report?.id || exportLog.id));
    return res.status(200).send(reportResult.content);
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
