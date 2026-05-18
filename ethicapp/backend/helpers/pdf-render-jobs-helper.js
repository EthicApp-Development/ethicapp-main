import crypto from "crypto";
import fs from "fs";
import path from "path";
import * as config from "../config/database.config.js";
import { uploadsPath } from "../config/uploads.config.js";
import * as rpg2 from "../db/rest-pg-2.js";

const uploadsRoot = path.resolve(process.cwd(), uploadsPath);

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
            RETURNING id, owner_type, owner_id, source_path, source_sha256, status;
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
