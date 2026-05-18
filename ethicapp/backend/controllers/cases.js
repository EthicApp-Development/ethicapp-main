"use strict";

import express from "express";
import * as config from "../config/database.config.js";
import * as rpg2 from "../db/rest-pg-2.js";
import { requireRole } from "../helpers/auth-helper.js";
import {
    enqueueCasePdfRenderJob,
    normalizePdfRenderJob,
    pdfRenderJobJoinSql,
    pdfRenderJobSelectSql,
} from "../helpers/pdf-render-jobs-helper.js";
import { moveUploadedFile, pdfUpload, removeUploadedFile } from "../middleware/upload.js";

const router = express.Router();

function normalizeCase(row) {
    const representations = row.pdf_path ? [{
        rel: "content",
        mediaType: "application/pdf",
        href: row.pdf_path,
    }] : [];

    return {
        id: row.id,
        caseUuid: row.case_uuid,
        title: row.title,
        authorFirstname: row.author_firstname,
        authorLastname: row.author_lastname,
        authorEmail: row.author_email,
        pdfPath: row.pdf_path,
        creator: row.creator,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        documentProcessing: normalizePdfRenderJob(row),
        representations,
    };
}

function parseCaseId(id) {
    const caseId = Number(id);
    return Number.isSafeInteger(caseId) && caseId > 0 ? caseId : null;
}

async function enqueueCaseRenderSafely(caseObj) {
    try {
        const job = await enqueueCasePdfRenderJob({
            caseId:  Number(caseObj.id),
            pdfPath: caseObj.pdf_path,
            metadata: {
                reason:   "case_pdf_uploaded",
                caseUuid: caseObj.case_uuid,
            },
        });
        console.info("Queued PDF render job for case document.", {
            caseId: caseObj.id,
            jobId:  job.pdf_render_job_id,
        });
        return job;
    } catch (error) {
        console.error("Unable to queue PDF render job for case document:", {
            caseId: caseObj?.id,
            error,
        });
        return null;
    }
}

async function getReadableCaseWithDocumentProcessing(caseId, userId) {
    return rpg2.singleSQL({
        dbcon: config.dbconnString,
        sql: `
            SELECT c.id, c.case_uuid, c.title, c.author_firstname, c.author_lastname, c.author_email,
                   c.pdf_path, c.creator, c.created_at, c.updated_at,
                   ${pdfRenderJobSelectSql}
            FROM ethical_cases c
            ${pdfRenderJobJoinSql}
            WHERE c.id = $1
              AND (
                c.creator = $2
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
                      AND s.creator = $2
                )
              );
        `,
        sqlParams: [
            rpg2.param("plain", caseId),
            rpg2.param("plain", userId),
        ],
    });
}

router.get("/cases", async (req, res) => {
    if (!requireRole(req, res, "P")) {
        return;
    }

    try {
        const cases = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT c.id, c.case_uuid, c.title, c.author_firstname, c.author_lastname, c.author_email,
                       c.pdf_path, c.creator, c.created_at, c.updated_at,
                       ${pdfRenderJobSelectSql}
                FROM ethical_cases c
                ${pdfRenderJobJoinSql}
                WHERE c.creator = $1
                ORDER BY c.id DESC;
            `,
            sqlParams: [rpg2.param("plain", req.session.uid)],
        });

        return res.status(200).json({
            status: "ok",
            result: cases.map(normalizeCase),
        });
    } catch (error) {
        console.error("Error fetching cases:", error);
        return res.status(500).json({ status: "err", message: "Failed to load cases." });
    }
});

router.get("/cases/search", async (req, res) => {
    if (!requireRole(req, res, ["P", "A"])) {
        return;
    }

    const query = String(req.query.q || "").trim();
    if (query.length < 2) {
        return res.status(200).json({ status: "ok", result: [] });
    }

    try {
        const cases = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT c.id, c.case_uuid, c.title, c.author_firstname, c.author_lastname, c.author_email,
                       c.pdf_path, c.creator, c.created_at, c.updated_at,
                       ${pdfRenderJobSelectSql}
                FROM ethical_cases c
                ${pdfRenderJobJoinSql}
                WHERE LOWER(c.title) LIKE LOWER($1)
                   OR LOWER(c.author_firstname) LIKE LOWER($1)
                   OR LOWER(c.author_lastname) LIKE LOWER($1)
                ORDER BY c.updated_at DESC, c.id DESC
                LIMIT 20;
            `,
            sqlParams: [rpg2.param("plain", `%${query}%`)],
        });

        return res.status(200).json({
            status: "ok",
            result: cases.map(normalizeCase),
        });
    } catch (error) {
        console.error("Error searching cases:", error);
        return res.status(500).json({ status: "err", message: "Failed to search cases." });
    }
});

router.get("/cases/:id/download-link", async (req, res) => {
    if (!requireRole(req, res, ["P", "A"])) {
        return;
    }

    const caseId = parseCaseId(req.params.id);
    if (!caseId) {
        return res.status(400).json({ status: "err", message: "Invalid case id." });
    }

    try {
        const caseObj = await rpg2.singleSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT id, pdf_path
                FROM ethical_cases
                WHERE id = $1;
            `,
            sqlParams: [rpg2.param("plain", caseId)],
        });

        if (!caseObj || !caseObj.id) {
            return res.status(404).json({ status: "err", message: "Case not found." });
        }

        return res.status(200).json({
            status: "ok",
            result: {
                id: caseObj.id,
                downloadUrl: caseObj.pdf_path,
            },
        });
    } catch (error) {
        console.error("Error retrieving case download link:", error);
        return res.status(500).json({ status: "err", message: "Failed to load case file link." });
    }
});

router.get("/cases/:id/document-processing", async (req, res) => {
    if (!requireRole(req, res, ["P", "A"])) {
        return;
    }

    const caseId = parseCaseId(req.params.id);
    if (!caseId) {
        return res.status(400).json({ status: "err", message: "Invalid case id." });
    }

    try {
        const caseObj = await getReadableCaseWithDocumentProcessing(caseId, req.session.uid);

        if (!caseObj || !caseObj.id) {
            return res.status(404).json({ status: "err", message: "Case not found." });
        }

        return res.status(200).json({
            status: "ok",
            result: {
                caseId: caseObj.id,
                caseUuid: caseObj.case_uuid,
                documentProcessing: normalizePdfRenderJob(caseObj),
            },
        });
    } catch (error) {
        console.error("Error retrieving case document processing status:", error);
        return res.status(500).json({
            status:  "err",
            message: "Failed to load case document processing status.",
        });
    }
});

router.get("/cases/:id", async (req, res) => {
    if (!requireRole(req, res, ["P", "A"])) {
        return;
    }

    const caseId = parseCaseId(req.params.id);
    if (!caseId) {
        return res.status(400).json({ status: "err", message: "Invalid case id." });
    }

    try {
        const caseObj = await getReadableCaseWithDocumentProcessing(caseId, req.session.uid);

        if (!caseObj || !caseObj.id) {
            return res.status(404).json({ status: "err", message: "Case not found." });
        }

        return res.status(200).json({ status: "ok", result: normalizeCase(caseObj) });
    } catch (error) {
        console.error("Error retrieving case by id:", error);
        return res.status(500).json({ status: "err", message: "Failed to load case." });
    }
});

router.post("/cases", pdfUpload, async (req, res) => {
    if (!requireRole(req, res, "P")) {
        return;
    }

    const {
        title,
        author_firstname: authorFirstname,
        author_lastname: authorLastname,
        author_email: authorEmail,
    } = req.body;

    if (!title || !authorFirstname || !authorLastname || !authorEmail) {
        await removeUploadedFile(req.file);
        return res.status(400).json({ status: "err", message: "Missing required fields." });
    }

    if (!req.file || req.file.mimetype !== "application/pdf") {
        return res.status(400).json({ status: "err", message: "A PDF file is required." });
    }

    try {
        const caseIdResult = await rpg2.singleSQL({
            dbcon: config.dbconnString,
            sql: "SELECT nextval(pg_get_serial_sequence('ethical_cases', 'id')) AS id;",
        });
        const caseId = Number(caseIdResult.id);
        const pdfPath = `/uploads/cases/${caseId}/case.pdf`;
        await moveUploadedFile(req.file, pdfPath);

        const createdCase = await rpg2.singleSQL({
            dbcon: config.dbconnString,
            sql: `
                INSERT INTO ethical_cases
                    (id, title, author_firstname, author_lastname, author_email, pdf_path, creator)
                VALUES
                    ($1, $2, $3, $4, $5, $6, $7)
                RETURNING id, case_uuid, title, author_firstname, author_lastname, author_email,
                          pdf_path, creator, created_at, updated_at;
            `,
            sqlParams: [
                rpg2.param("plain", caseId),
                rpg2.param("plain", title),
                rpg2.param("plain", authorFirstname),
                rpg2.param("plain", authorLastname),
                rpg2.param("plain", authorEmail),
                rpg2.param("plain", pdfPath),
                rpg2.param("plain", req.session.uid),
            ],
        });

        const renderJob = await enqueueCaseRenderSafely(createdCase);

        return res.status(201).json({
            status: "ok",
            result: normalizeCase({
                ...createdCase,
                ...renderJob,
            }),
        });
    } catch (error) {
        await removeUploadedFile(req.file);
        console.error("Error creating case:", error);
        return res.status(500).json({ status: "err", message: "Failed to create case." });
    }
});

router.patch("/cases/:id", pdfUpload, async (req, res) => {
    if (!requireRole(req, res, "P")) {
        return;
    }

    const caseId = parseCaseId(req.params.id);
    if (!caseId) {
        return res.status(400).json({ status: "err", message: "Invalid case id." });
    }

    const {
        title,
        author_firstname: authorFirstname,
        author_lastname: authorLastname,
        author_email: authorEmail,
    } = req.body;

    if (!title || !authorFirstname || !authorLastname || !authorEmail) {
        await removeUploadedFile(req.file);
        return res.status(400).json({ status: "err", message: "Missing required fields." });
    }

    try {
        const existingCase = await rpg2.singleSQL({
            dbcon: config.dbconnString,
            sql: "SELECT id, pdf_path FROM ethical_cases WHERE id = $1 AND creator = $2;",
            sqlParams: [rpg2.param("plain", caseId), rpg2.param("plain", req.session.uid)],
        });

        if (!existingCase || !existingCase.id) {
            await removeUploadedFile(req.file);
            return res.status(404).json({ status: "err", message: "Case not found." });
        }

        const hasPdf = req.file && req.file.mimetype === "application/pdf";
        const pdfPath = hasPdf ? `/uploads/cases/${caseId}/case.pdf` : existingCase.pdf_path;

        const updatedCase = await rpg2.singleSQL({
            dbcon: config.dbconnString,
            sql: `
                UPDATE ethical_cases
                SET title = $1,
                    author_firstname = $2,
                    author_lastname = $3,
                    author_email = $4,
                    pdf_path = $5,
                    updated_at = NOW()
                WHERE id = $6 AND creator = $7
                RETURNING id, case_uuid, title, author_firstname, author_lastname, author_email,
                          pdf_path, creator, created_at, updated_at;
            `,
            sqlParams: [
                rpg2.param("plain", title),
                rpg2.param("plain", authorFirstname),
                rpg2.param("plain", authorLastname),
                rpg2.param("plain", authorEmail),
                rpg2.param("plain", pdfPath),
                rpg2.param("plain", caseId),
                rpg2.param("plain", req.session.uid),
            ],
        });

        if (hasPdf) {
            await moveUploadedFile(req.file, pdfPath);
            const renderJob = await enqueueCaseRenderSafely(updatedCase);
            Object.assign(updatedCase, renderJob);
        }

        return res.status(200).json({ status: "ok", result: normalizeCase(updatedCase) });
    } catch (error) {
        await removeUploadedFile(req.file);
        console.error("Error updating case:", error);
        return res.status(500).json({ status: "err", message: "Failed to update case." });
    }
});

router.delete("/cases/:id", async (req, res) => {
    if (!requireRole(req, res, "P")) {
        return;
    }

    const caseId = parseCaseId(req.params.id);
    if (!caseId) {
        return res.status(400).json({ status: "err", message: "Invalid case id." });
    }

    try {
        const deleted = await rpg2.singleSQL({
            dbcon: config.dbconnString,
            sql: `
                DELETE FROM ethical_cases
                WHERE id = $1 AND creator = $2
                RETURNING id;
            `,
            sqlParams: [
                rpg2.param("plain", caseId),
                rpg2.param("plain", req.session.uid),
            ],
        });

        if (!deleted || !deleted.id) {
            return res.status(404).json({ status: "err", message: "Case not found." });
        }

        return res.status(200).json({ status: "ok", message: "Case deleted." });
    } catch (error) {
        console.error("Error deleting case:", error);
        return res.status(500).json({ status: "err", message: "Failed to delete case." });
    }
});

export default router;
