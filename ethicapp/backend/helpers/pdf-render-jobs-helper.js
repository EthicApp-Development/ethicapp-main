import crypto from "crypto";
import fs from "fs";
import path from "path";
import * as config from "../config/database.config.js";
import { uploadsPath } from "../config/uploads.config.js";
import * as rpg2 from "../db/rest-pg-2.js";

const uploadsRoot = path.resolve(process.cwd(), uploadsPath);

export function normalizePdfRenderJob(row) {
    if (!row || !row.pdf_render_job_id) {
        return null;
    }

    return {
        id:              row.pdf_render_job_id,
        ownerType:       row.pdf_render_owner_type,
        ownerId:         row.pdf_render_owner_id,
        sourcePath:      row.pdf_render_source_path,
        sourceSha256:    row.pdf_render_source_sha256,
        sourceByteCount: row.pdf_render_source_byte_count,
        status:          row.pdf_render_status,
        requestedAt:     row.pdf_render_requested_at,
        nextAttemptAt:   row.pdf_render_next_attempt_at,
        startedAt:       row.pdf_render_started_at,
        completedAt:     row.pdf_render_completed_at,
        attemptCount:    row.pdf_render_attempt_count,
        maxAttempts:     row.pdf_render_max_attempts,
        pageCount:       row.pdf_render_page_count,
        manifestPath:    row.pdf_render_manifest_path,
        errorMessage:    row.pdf_render_error_message,
        metadata:        row.pdf_render_metadata || {},
    };
}

export const pdfRenderJobSelectSql = `
    prj.id AS pdf_render_job_id,
    prj.owner_type AS pdf_render_owner_type,
    prj.owner_id AS pdf_render_owner_id,
    prj.source_path AS pdf_render_source_path,
    prj.source_sha256 AS pdf_render_source_sha256,
    prj.source_byte_count AS pdf_render_source_byte_count,
    prj.status AS pdf_render_status,
    prj.requested_at AS pdf_render_requested_at,
    prj.next_attempt_at AS pdf_render_next_attempt_at,
    prj.started_at AS pdf_render_started_at,
    prj.completed_at AS pdf_render_completed_at,
    prj.attempt_count AS pdf_render_attempt_count,
    prj.max_attempts AS pdf_render_max_attempts,
    prj.page_count AS pdf_render_page_count,
    prj.manifest_path AS pdf_render_manifest_path,
    prj.error_message AS pdf_render_error_message,
    prj.metadata AS pdf_render_metadata
`;

export const pdfRenderJobJoinSql = `
    LEFT JOIN pdf_render_jobs prj
      ON prj.owner_type = 'case'
     AND prj.owner_id = c.id
`;

function getRelativeUploadPath(publicPath) {
    const normalizedPath = String(publicPath || "").replaceAll("\\", "/").replace(/^\/+/, "");

    if (normalizedPath.startsWith("assets/uploads/")) {
        return normalizedPath.slice("assets/uploads/".length);
    }

    if (normalizedPath.startsWith("uploads/")) {
        return normalizedPath.slice("uploads/".length);
    }

    throw new Error(`Invalid upload public path: ${publicPath}`);
}

function getAbsoluteUploadPath(publicPath) {
    return path.join(uploadsRoot, getRelativeUploadPath(publicPath));
}

async function getFileMetadata(publicPath) {
    const absolutePath = getAbsoluteUploadPath(publicPath);
    const [stat, fileBuffer] = await Promise.all([
        fs.promises.stat(absolutePath),
        fs.promises.readFile(absolutePath),
    ]);

    return {
        byteCount: stat.size,
        sha256: crypto.createHash("sha256").update(fileBuffer).digest("hex"),
    };
}

export async function enqueueCasePdfRenderJob({ caseId, pdfPath, metadata = {} }) {
    if (!Number.isSafeInteger(Number(caseId)) || Number(caseId) <= 0) {
        throw new Error("caseId must be a positive integer.");
    }

    if (!pdfPath) {
        throw new Error("pdfPath is required.");
    }

    const fileMetadata = await getFileMetadata(pdfPath);

    const result = await rpg2.singleSQL({
        dbcon: config.dbconnString,
        sql: `
            INSERT INTO pdf_render_jobs (
                owner_type,
                owner_id,
                source_path,
                source_sha256,
                source_byte_count,
                status,
                requested_at,
                next_attempt_at,
                started_at,
                completed_at,
                attempt_count,
                page_count,
                manifest_path,
                error_message,
                metadata
            )
            VALUES (
                'case',
                $1,
                $2,
                $3,
                $4,
                'pending',
                now(),
                now(),
                NULL,
                NULL,
                0,
                NULL,
                NULL,
                NULL,
                $5::jsonb
            )
            ON CONFLICT (owner_type, owner_id)
            DO UPDATE SET
                source_path = EXCLUDED.source_path,
                source_sha256 = EXCLUDED.source_sha256,
                source_byte_count = EXCLUDED.source_byte_count,
                status = 'pending',
                requested_at = now(),
                next_attempt_at = now(),
                started_at = NULL,
                completed_at = NULL,
                attempt_count = 0,
                page_count = NULL,
                manifest_path = NULL,
                error_message = NULL,
                metadata = EXCLUDED.metadata
            RETURNING id AS pdf_render_job_id,
                      owner_type AS pdf_render_owner_type,
                      owner_id AS pdf_render_owner_id,
                      source_path AS pdf_render_source_path,
                      source_sha256 AS pdf_render_source_sha256,
                      source_byte_count AS pdf_render_source_byte_count,
                      status AS pdf_render_status,
                      requested_at AS pdf_render_requested_at,
                      next_attempt_at AS pdf_render_next_attempt_at,
                      started_at AS pdf_render_started_at,
                      completed_at AS pdf_render_completed_at,
                      attempt_count AS pdf_render_attempt_count,
                      max_attempts AS pdf_render_max_attempts,
                      page_count AS pdf_render_page_count,
                      manifest_path AS pdf_render_manifest_path,
                      error_message AS pdf_render_error_message,
                      metadata AS pdf_render_metadata;
        `,
        sqlParams: [
            rpg2.param("plain", Number(caseId)),
            rpg2.param("plain", pdfPath),
            rpg2.param("plain", fileMetadata.sha256),
            rpg2.param("plain", fileMetadata.byteCount),
            rpg2.param("plain", JSON.stringify(metadata)),
        ],
    });

    return result;
}
