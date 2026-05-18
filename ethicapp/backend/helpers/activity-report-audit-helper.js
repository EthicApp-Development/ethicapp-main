"use strict";

import * as config from "../config/database.config.js";
import * as rpg2 from "../db/rest-pg-2.js";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

function normalizePositiveInteger(value) {
    const normalizedValue = Number(value);
    return Number.isInteger(normalizedValue) && normalizedValue > 0 ? normalizedValue : null;
}

function normalizeOptionalPositiveInteger(value) {
    if (value === undefined || value === null || value === "") {
        return null;
    }
    return normalizePositiveInteger(value);
}

function getRequestIp(req) {
    const forwardedFor = req.get("X-Forwarded-For");
    if (forwardedFor) {
        return forwardedFor.split(",")[0].trim();
    }
    return req.ip || req.socket?.remoteAddress || null;
}

function getRequestActor(req) {
    const effectiveUserId = normalizePositiveInteger(req.session?.uid);
    const actorUserId = normalizePositiveInteger(req.session?.authUid) || effectiveUserId;

    return {
        actorUserId,
        effectiveUserId,
        actorRole: req.session?.authRole || req.session?.role || null,
        effectiveRole: req.session?.role || null,
        impersonated: Boolean(req.session?.impersonating),
    };
}

function sanitizeMetadata(metadata) {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
        return {};
    }
    return metadata;
}

export async function createActivityReportExportLog({
    req,
    activity,
    designType,
    reportType,
    exportFormat = "csv",
    metadata = {},
}) {
    const actor = getRequestActor(req);
    const rows = await rpg2.execSQL({
        dbcon: config.dbconnString,
        sql: `
            INSERT INTO activity_report_exports (
                activity_id,
                session_id,
                design_id,
                report_type,
                export_format,
                design_type,
                actor_user_id,
                effective_user_id,
                actor_role,
                effective_role,
                impersonated,
                ip_address,
                user_agent,
                request_id,
                metadata
            )
            VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8,
                $9, $10, $11, NULLIF($12, '')::inet, $13, $14, $15::jsonb
            )
            RETURNING *
        `,
        sqlParams: [
            activity.activity_id,
            activity.session_id,
            activity.design_id,
            reportType,
            exportFormat,
            designType,
            actor.actorUserId,
            actor.effectiveUserId,
            actor.actorRole,
            actor.effectiveRole,
            actor.impersonated,
            getRequestIp(req) || "",
            req.get("User-Agent") || null,
            req.get("X-Request-Id") || null,
            JSON.stringify(sanitizeMetadata(metadata)),
        ],
    });

    return rows[0] || null;
}

export async function markActivityReportExportCompleted(exportLogId, {
    rowCount = null,
    byteCount = null,
    contentSha256 = null,
    metadata = {},
} = {}) {
    const rows = await rpg2.execSQL({
        dbcon: config.dbconnString,
        sql: `
            UPDATE activity_report_exports
            SET status = 'completed',
                completed_at = now(),
                row_count = $2,
                byte_count = $3,
                content_sha256 = $4,
                metadata = metadata || $5::jsonb
            WHERE id = $1
            RETURNING *
        `,
        sqlParams: [
            exportLogId,
            rowCount,
            byteCount,
            contentSha256,
            JSON.stringify(sanitizeMetadata(metadata)),
        ],
    });

    return rows[0] || null;
}

export async function markActivityReportExportFailed(exportLogId, {
    errorMessage,
    metadata = {},
} = {}) {
    const rows = await rpg2.execSQL({
        dbcon: config.dbconnString,
        sql: `
            UPDATE activity_report_exports
            SET status = 'failed',
                completed_at = now(),
                error_message = $2,
                metadata = metadata || $3::jsonb
            WHERE id = $1
            RETURNING *
        `,
        sqlParams: [
            exportLogId,
            errorMessage || "Report export failed.",
            JSON.stringify(sanitizeMetadata(metadata)),
        ],
    });

    return rows[0] || null;
}

export async function listActivityReportExports({
    actorUserId,
    effectiveUserId,
    sessionId,
    reportType,
    status,
    from,
    to,
    page = 1,
    pageSize = DEFAULT_PAGE_SIZE,
} = {}) {
    const conditions = [];
    const params = [];

    const addCondition = function(sqlFragment, value) {
        params.push(value);
        conditions.push(sqlFragment.replace("?", `$${params.length}`));
    };

    const normalizedActorUserId = normalizeOptionalPositiveInteger(actorUserId);
    if (normalizedActorUserId) {
        addCondition("actor_user_id = ?", normalizedActorUserId);
    }

    const normalizedEffectiveUserId = normalizeOptionalPositiveInteger(effectiveUserId);
    if (normalizedEffectiveUserId) {
        addCondition("effective_user_id = ?", normalizedEffectiveUserId);
    }

    const normalizedSessionId = normalizeOptionalPositiveInteger(sessionId);
    if (normalizedSessionId) {
        addCondition("session_id = ?", normalizedSessionId);
    }

    if (reportType) {
        addCondition("report_type = ?", reportType);
    }

    if (status) {
        addCondition("status = ?", status);
    }

    if (from) {
        addCondition("requested_at >= ?", from);
    }

    if (to) {
        addCondition("requested_at <= ?", to);
    }

    const normalizedPage = normalizePositiveInteger(page) || 1;
    const normalizedPageSize = Math.min(
        normalizePositiveInteger(pageSize) || DEFAULT_PAGE_SIZE,
        MAX_PAGE_SIZE
    );
    const offset = (normalizedPage - 1) * normalizedPageSize;
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countRows = await rpg2.execSQL({
        dbcon: config.dbconnString,
        sql: `SELECT COUNT(*)::int AS total FROM activity_report_exports ${whereClause}`,
        sqlParams: params,
    });

    const queryParams = [...params, normalizedPageSize, offset];
    const rows = await rpg2.execSQL({
        dbcon: config.dbconnString,
        sql: `
            SELECT *
            FROM activity_report_exports
            ${whereClause}
            ORDER BY requested_at DESC, id DESC
            LIMIT $${params.length + 1}
            OFFSET $${params.length + 2}
        `,
        sqlParams: queryParams,
    });

    return {
        rows,
        pagination: {
            page: normalizedPage,
            pageSize: normalizedPageSize,
            total: countRows[0]?.total || 0,
        },
    };
}

export async function getActivityReportExportById(exportLogId) {
    const normalizedExportLogId = normalizePositiveInteger(exportLogId);
    if (!normalizedExportLogId) {
        return null;
    }

    const rows = await rpg2.execSQL({
        dbcon: config.dbconnString,
        sql: `
            SELECT *
            FROM activity_report_exports
            WHERE id = $1
            LIMIT 1
        `,
        sqlParams: [normalizedExportLogId],
    });

    return rows[0] || null;
}
