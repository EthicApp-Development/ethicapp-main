"use strict";

import express from "express";
import fs from "fs";
import path from "path";
import * as config from "../config/database.config.js";
import { uploadsPath } from "../config/uploads.config.js";
import * as rpg2 from "../db/rest-pg-2.js";

const router = express.Router();
const uploadsRoot = path.resolve(process.cwd(), uploadsPath);

const UPLOAD_ROUTE_PATTERN = /^\/(?:assets\/)?uploads\/(.+)$/;

function publicPathCandidates(relativePath) {
    return [
        `uploads/${relativePath}`,
        `/uploads/${relativePath}`,
        `assets/uploads/${relativePath}`,
        `/assets/uploads/${relativePath}`,
    ];
}

function isInsideDirectory(candidatePath, parentDirectory) {
    const relativePath = path.relative(parentDirectory, candidatePath);
    return relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

export function normalizeRequestedUploadPath(rawPath) {
    if (!rawPath || typeof rawPath !== "string") {
        return null;
    }

    let decodedPath;
    try {
        decodedPath = decodeURIComponent(rawPath.split("?")[0]);
    } catch {
        return null;
    }

    if (decodedPath.includes("\0")) {
        return null;
    }

    const normalizedPublicPath = decodedPath.replaceAll("\\", "/").replace(/^\/+/, "");
    const relativePath = normalizedPublicPath.startsWith("assets/uploads/")
        ? normalizedPublicPath.slice("assets/uploads/".length)
        : normalizedPublicPath.startsWith("uploads/")
            ? normalizedPublicPath.slice("uploads/".length)
            : normalizedPublicPath;

    const normalizedRelativePath = path.posix.normalize(relativePath).replace(/^\/+/, "");
    if (
        !normalizedRelativePath ||
        normalizedRelativePath === "." ||
        normalizedRelativePath.startsWith("../") ||
        normalizedRelativePath.includes("/../")
    ) {
        return null;
    }

    return normalizedRelativePath;
}

function buildAbsoluteUploadPath(relativePath) {
    const absolutePath = path.resolve(uploadsRoot, relativePath);
    return isInsideDirectory(absolutePath, uploadsRoot) ? absolutePath : null;
}

async function queryOne(sql, sqlParams, query = rpg2.execSQL) {
    const rows = await query({
        dbcon: config.dbconnString,
        sql,
        sqlParams,
    });
    return rows[0] || null;
}

function getCaseIdFromRenderedDocumentPath(relativePath) {
    const match = String(relativePath || "").match(/^cases\/(\d+)\/(?:rendered\/page-\d+\.png|representation\.json)$/);
    if (!match) {
        return null;
    }

    const caseId = Number(match[1]);
    return Number.isSafeInteger(caseId) && caseId > 0 ? caseId : null;
}

async function findCaseDocument(relativePath, uid, role, query) {
    const renderedCaseId = getCaseIdFromRenderedDocumentPath(relativePath);

    return queryOne(`
        SELECT c.id, c.pdf_path
        FROM ethical_cases c
        WHERE (c.pdf_path = ANY($1) OR c.id = $4)
          AND (
            $3 = 'A'
            OR c.creator = $2
            OR EXISTS (
                SELECT 1
                FROM designs d
                WHERE d.case_id = c.id
                  AND (d.creator = $2 OR d.public = TRUE)
            )
            OR EXISTS (
                SELECT 1
                FROM designs d
                INNER JOIN activity a ON a.design = d.id
                INNER JOIN sessions s ON s.id = a.session
                WHERE d.case_id = c.id
                  AND (
                    s.creator = $2
                    OR EXISTS (
                        SELECT 1
                        FROM sesusers su
                        WHERE su.sesid = s.id
                          AND su.uid = $2
                    )
                  )
            )
          )
        LIMIT 1;
    `, [publicPathCandidates(relativePath), uid, role, renderedCaseId], query);
}

async function findProfileImage(relativePath, query) {
    return queryOne(`
        SELECT id
        FROM users
        WHERE (
            profile_image_path = ANY($1)
            OR profile_image_topbar_path = ANY($1)
          )
        LIMIT 1;
    `, [publicPathCandidates(relativePath)], query);
}

export async function getAuthorizedUpload(relativePath, session, query = rpg2.execSQL) {
    const uid = Number(session?.uid);
    if (!Number.isSafeInteger(uid) || uid <= 0) {
        return null;
    }

    const role = session?.role || "";
    const resolvers = [
        () => findCaseDocument(relativePath, uid, role, query),
        () => findProfileImage(relativePath, query),
    ];

    for (const resolveMetadata of resolvers) {
        const metadata = await resolveMetadata();
        if (metadata) {
            return metadata;
        }
    }

    return null;
}

export async function serveProtectedUpload(req, res) {
    const routeMatch = req.path.match(UPLOAD_ROUTE_PATTERN);
    const relativePath = normalizeRequestedUploadPath(routeMatch ? routeMatch[1] : req.path);
    const absolutePath = relativePath ? buildAbsoluteUploadPath(relativePath) : null;

    if (!absolutePath) {
        console.warn("Blocked invalid upload path request", {
            uid: req.session?.uid,
            path: req.originalUrl,
        });
        return res.status(400).json({ status: "err", message: "Invalid upload path." });
    }

    try {
        const authorizedUpload = await getAuthorizedUpload(relativePath, req.session);
        if (!authorizedUpload) {
            console.warn("Blocked unauthorized upload request", {
                uid: req.session?.uid,
                role: req.session?.role,
                path: req.originalUrl,
            });
            return res.status(404).json({ status: "err", message: "File not found." });
        }

        await fs.promises.access(absolutePath, fs.constants.R_OK);
        res.set("Cache-Control", "private, no-store");
        return res.sendFile(absolutePath);
    } catch (error) {
        if (error.code === "ENOENT") {
            return res.status(404).json({ status: "err", message: "File not found." });
        }

        console.error("Error serving protected upload:", error);
        return res.status(500).json({ status: "err", message: "Failed to serve file." });
    }
}

router.get(UPLOAD_ROUTE_PATTERN, serveProtectedUpload);

export default router;
