"use strict";

import express from "express";
import * as config from "../config/database.config.js";
import * as rpg2 from "../db/rest-pg-2.js";
import { requireRole } from "../helpers/auth-helper.js";
import {
    CASE_DEFAULT_LICENSE,
    DEFAULT_LANGUAGE_CODE,
    PRIVATE_VISIBILITY,
    PUBLIC_VISIBILITY,
    canCaseBeSharedPublicly,
    deriveCaseSharingFlags,
    normalizeLicenseCode,
    normalizeLanguageCode,
    normalizeRightsStatus,
    normalizeVisibility,
} from "../helpers/sharing-policy-helper.js";
import {
    enqueueCasePdfRenderJob,
    normalizePdfRenderJob,
    pdfRenderJobJoinSql,
    pdfRenderJobSelectSql,
} from "../helpers/pdf-render-jobs-helper.js";
import { moveUploadedFile, pdfUpload, removeUploadedFile } from "../middleware/upload.js";

const router = express.Router();

const caseSharingSelectSql = `
    c.visibility, c.license_code, c.attribution_text,
    c.original_case_id, c.imported_from_case_id,
    c.source_case_title, c.source_case_author, c.source_case_license_code,
    c.is_editable_copy, c.rights_status, c.license_notes, c.permission_statement,
    c.commercial_source, c.can_be_shared_publicly, c.can_be_copied_by_others,
    c.language_code,
    COALESCE((
        SELECT json_agg(json_build_object(
            'id', a.id,
            'authorFirstname', a.author_firstname,
            'authorLastname', a.author_lastname,
            'authorEmail', a.author_email,
            'userId', ca.user_id,
            'authorOrder', ca.author_order,
            'isPrimary', ca.is_primary
        ) ORDER BY ca.author_order, a.id)
        FROM ethical_cases_authors ca
        INNER JOIN ethical_case_author a ON a.id = ca.author_id
        WHERE ca.case_id = c.id
    ), '[]'::json) AS authors,
    COALESCE((
        SELECT json_agg(json_build_object(
            'id', d.id,
            'title', COALESCE(d.design #>> '{metainfo,title}', d.design ->> 'title', 'Untitled design'),
            'licenseCode', d.license_code,
            'attributionText', d.attribution_text
        ) ORDER BY d.id DESC)
        FROM designs d
        WHERE d.case_id = c.id
          AND d.visibility = 'public'
    ), '[]'::json) AS public_designs
`;

function normalizeCase(row) {
    const representations = row.pdf_path ? [{
        rel: "content",
        mediaType: "application/pdf",
        href: row.pdf_path,
    }] : [];
    const documentProcessing = normalizePdfRenderJob(row);

    if (documentProcessing?.status === "completed" && documentProcessing.pageCount) {
        for (let pageNumber = 1; pageNumber <= documentProcessing.pageCount; pageNumber += 1) {
            representations.push({
                rel:            "rendered-image",
                mediaType:      "image/png",
                href:           `/uploads/cases/${row.id}/rendered/page-${pageNumber}.png`,
                sequenceNumber: pageNumber,
                pageNumber,
            });
        }
    }

    return {
        id: row.id,
        caseUuid: row.case_uuid,
        title: row.title,
        authorFirstname: row.author_firstname,
        authorLastname: row.author_lastname,
        authorEmail: row.author_email,
        pdfPath: row.pdf_path,
        creator: row.creator,
        visibility: row.visibility || PRIVATE_VISIBILITY,
        licenseCode: row.license_code || CASE_DEFAULT_LICENSE,
        attributionText: row.attribution_text,
        originalCaseId: row.original_case_id,
        importedFromCaseId: row.imported_from_case_id,
        sourceCaseTitle: row.source_case_title,
        sourceCaseAuthor: row.source_case_author,
        sourceCaseLicenseCode: row.source_case_license_code,
        isEditableCopy: row.is_editable_copy !== false,
        rightsStatus: row.rights_status,
        licenseNotes: row.license_notes,
        permissionStatement: row.permission_statement,
        commercialSource: row.commercial_source,
        canBeSharedPublicly: row.can_be_shared_publicly === true,
        canBeCopiedByOthers: row.can_be_copied_by_others === true,
        languageCode: row.language_code || DEFAULT_LANGUAGE_CODE,
        authors: Array.isArray(row.authors) && row.authors.length > 0
            ? row.authors
            : [{
                authorFirstname: row.author_firstname,
                authorLastname:  row.author_lastname,
                authorEmail:     row.author_email,
                authorOrder:     1,
                isPrimary:       true,
            }],
        publicDesigns: row.public_designs || [],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        documentProcessing,
        representations,
    };
}

function normalizeCaseAuthor(author, index) {
    return {
        authorFirstname: String(author?.authorFirstname || author?.author_firstname || "").trim(),
        authorLastname:  String(author?.authorLastname || author?.author_lastname || "").trim(),
        authorEmail:     String(author?.authorEmail || author?.author_email || "").trim(),
        authorOrder:     index + 1,
        isPrimary:       index === 0,
    };
}

function parseCaseAuthors(body) {
    if (body?.authors) {
        try {
            const parsedAuthors = typeof body.authors === "string" ? JSON.parse(body.authors) : body.authors;
            if (Array.isArray(parsedAuthors)) {
                return parsedAuthors.map(normalizeCaseAuthor).filter((author) => {
                    return author.authorFirstname || author.authorLastname || author.authorEmail;
                });
            }
        } catch {
            return [];
        }
    }

    return [normalizeCaseAuthor({
        authorFirstname: body?.author_firstname || body?.authorFirstname,
        authorLastname:  body?.author_lastname || body?.authorLastname,
        authorEmail:     body?.author_email || body?.authorEmail,
    }, 0)];
}

function areCaseAuthorsValid(authors) {
    return authors.length > 0 && authors.every((author) => {
        return author.authorFirstname && author.authorLastname && author.authorEmail;
    });
}

function hasDuplicateCaseAuthorEmails(authors) {
    const emails = authors
        .map((author) => String(author.authorEmail || "").trim().toLowerCase())
        .filter(Boolean);
    return new Set(emails).size !== emails.length;
}

async function replaceCaseAuthors(caseId, authors) {
    const db = await rpg2.getDBInstance(config.dbconnString);
    const client = await db.connect();

    try {
        await client.query("BEGIN");
        await client.query("DELETE FROM ethical_cases_authors WHERE case_id = $1;", [caseId]);

        for (const author of authors) {
            const userResult = await client.query(
                "SELECT id FROM users WHERE LOWER(mail) = LOWER($1) LIMIT 1;",
                [author.authorEmail]
            );
            const userId = userResult.rows[0]?.id || null;
            const authorResult = await client.query(`
                INSERT INTO ethical_case_author (author_firstname, author_lastname, author_email)
                VALUES ($1, $2, $3)
                ON CONFLICT ((LOWER(author_email))) DO UPDATE
                SET author_firstname = EXCLUDED.author_firstname,
                    author_lastname = EXCLUDED.author_lastname,
                    author_email = EXCLUDED.author_email,
                    updated_at = NOW()
                RETURNING id;
            `, [author.authorFirstname, author.authorLastname, author.authorEmail]);

            await client.query(`
                INSERT INTO ethical_cases_authors
                    (case_id, author_id, user_id, author_order, is_primary)
                VALUES
                    ($1, $2, $3, $4, $5)
                ON CONFLICT (case_id, author_id) DO UPDATE
                SET user_id = EXCLUDED.user_id,
                    author_order = EXCLUDED.author_order,
                    is_primary = EXCLUDED.is_primary,
                    updated_at = NOW();
            `, [caseId, authorResult.rows[0].id, userId, author.authorOrder, author.isPrimary]);
        }

        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
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

async function getReadableCaseWithDocumentProcessing(caseId, userId, role = "") {
    return rpg2.singleSQL({
        dbcon: config.dbconnString,
        sql: `
            SELECT c.id, c.case_uuid, c.title, c.author_firstname, c.author_lastname, c.author_email,
                   c.pdf_path, c.creator, c.created_at, c.updated_at,
                   ${caseSharingSelectSql},
                   ${pdfRenderJobSelectSql}
            FROM ethical_cases c
            ${pdfRenderJobJoinSql}
            WHERE c.id = $1
              AND (
                $3 = 'A'
                OR
                c.creator = $2
                OR c.visibility = 'public'
                OR EXISTS (
                    SELECT 1
                    FROM designs d
                    WHERE d.case_id = c.id
                      AND (d.creator = $2 OR d.visibility = 'public')
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
              );
        `,
        sqlParams: [
            rpg2.param("plain", caseId),
            rpg2.param("plain", userId),
            rpg2.param("plain", role || ""),
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
                       ${caseSharingSelectSql},
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
                       ${caseSharingSelectSql},
                       ${pdfRenderJobSelectSql}
                FROM ethical_cases c
                ${pdfRenderJobJoinSql}
                WHERE c.visibility = 'public'
                  AND (
                    LOWER(c.title) LIKE LOWER($1)
                    OR LOWER(c.author_firstname) LIKE LOWER($1)
                    OR LOWER(c.author_lastname) LIKE LOWER($1)
                  )
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
    if (!requireRole(req, res, ["P", "A", "S"])) {
        return;
    }

    const caseId = parseCaseId(req.params.id);
    if (!caseId) {
        return res.status(400).json({ status: "err", message: "Invalid case id." });
    }

    try {
        const caseObj = await getReadableCaseWithDocumentProcessing(caseId, req.session.uid, req.session.role);

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
    if (!requireRole(req, res, ["P", "A", "S"])) {
        return;
    }

    const caseId = parseCaseId(req.params.id);
    if (!caseId) {
        return res.status(400).json({ status: "err", message: "Invalid case id." });
    }

    try {
        const caseObj = await getReadableCaseWithDocumentProcessing(caseId, req.session.uid, req.session.role);

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
    if (!requireRole(req, res, ["P", "A", "S"])) {
        return;
    }

    const caseId = parseCaseId(req.params.id);
    if (!caseId) {
        return res.status(400).json({ status: "err", message: "Invalid case id." });
    }

    try {
        const caseObj = await getReadableCaseWithDocumentProcessing(caseId, req.session.uid, req.session.role);

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
        visibility,
        license_code: licenseCode,
        licenseCode: licenseCodeCamel,
        attribution_text: attributionText,
        attributionText: attributionTextCamel,
        rights_status: rightsStatus,
        rightsStatus: rightsStatusCamel,
        license_notes: licenseNotes,
        licenseNotes: licenseNotesCamel,
        permission_statement: permissionStatement,
        permissionStatement: permissionStatementCamel,
        commercial_source: commercialSource,
        commercialSource: commercialSourceCamel,
        can_be_shared_publicly: canBeSharedPublicly,
        canBeSharedPublicly: canBeSharedPubliclyCamel,
        can_be_copied_by_others: canBeCopiedByOthers,
        canBeCopiedByOthers: canBeCopiedByOthersCamel,
        language_code: languageCode,
        languageCode: languageCodeCamel,
    } = req.body;

    const authors = parseCaseAuthors(req.body);
    if (!title || !areCaseAuthorsValid(authors) || hasDuplicateCaseAuthorEmails(authors)) {
        await removeUploadedFile(req.file);
        return res.status(400).json({ status: "err", message: "Missing required fields." });
    }
    const primaryAuthor = authors[0];

    if (!req.file || req.file.mimetype !== "application/pdf") {
        return res.status(400).json({ status: "err", message: "A PDF file is required." });
    }

    const normalizedLicenseCode = normalizeLicenseCode(licenseCode ?? licenseCodeCamel, CASE_DEFAULT_LICENSE);
    const normalizedRightsStatus = normalizeRightsStatus(rightsStatus ?? rightsStatusCamel);
    const sharingFlags = deriveCaseSharingFlags({
        licenseCode:          normalizedLicenseCode,
        rightsStatus:         normalizedRightsStatus,
        canBeSharedPublicly:  canBeSharedPublicly ?? canBeSharedPubliclyCamel,
        canBeCopiedByOthers:  canBeCopiedByOthers ?? canBeCopiedByOthersCamel,
    });
    const normalizedVisibility = normalizeVisibility(visibility);
    if (normalizedVisibility === PUBLIC_VISIBILITY && !sharingFlags.canBeSharedPublicly) {
        await removeUploadedFile(req.file);
        return res.status(409).json({
            status:  "err",
            message: "This case needs explicit public sharing rights before it can be published.",
            code:    "CASE_PUBLIC_SHARING_RIGHTS_REQUIRED",
        });
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
                    (id, title, author_firstname, author_lastname, author_email, pdf_path, creator,
                     visibility, license_code, attribution_text, rights_status, license_notes,
                     permission_statement, commercial_source, can_be_shared_publicly, can_be_copied_by_others,
                     language_code)
                VALUES
                    ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
                RETURNING id, case_uuid, title, author_firstname, author_lastname, author_email,
                          pdf_path, creator, visibility, license_code, attribution_text,
                          original_case_id, imported_from_case_id, source_case_title,
                          source_case_author, source_case_license_code, is_editable_copy,
                          rights_status, license_notes, permission_statement, commercial_source,
                          can_be_shared_publicly, can_be_copied_by_others, language_code,
                          created_at, updated_at;
            `,
            sqlParams: [
                rpg2.param("plain", caseId),
                rpg2.param("plain", title),
                rpg2.param("plain", primaryAuthor.authorFirstname),
                rpg2.param("plain", primaryAuthor.authorLastname),
                rpg2.param("plain", primaryAuthor.authorEmail),
                rpg2.param("plain", pdfPath),
                rpg2.param("plain", req.session.uid),
                rpg2.param("plain", normalizedVisibility),
                rpg2.param("plain", normalizedLicenseCode),
                rpg2.param("plain", attributionText ?? attributionTextCamel ?? null),
                rpg2.param("plain", normalizedRightsStatus),
                rpg2.param("plain", licenseNotes ?? licenseNotesCamel ?? null),
                rpg2.param("plain", permissionStatement ?? permissionStatementCamel ?? null),
                rpg2.param("plain", commercialSource ?? commercialSourceCamel ?? null),
                rpg2.param("plain", sharingFlags.canBeSharedPublicly),
                rpg2.param("plain", sharingFlags.canBeCopiedByOthers),
                rpg2.param("plain", normalizeLanguageCode(languageCode ?? languageCodeCamel)),
            ],
        });
        await replaceCaseAuthors(caseId, authors);

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
        visibility,
        license_code: licenseCode,
        licenseCode: licenseCodeCamel,
        attribution_text: attributionText,
        attributionText: attributionTextCamel,
        rights_status: rightsStatus,
        rightsStatus: rightsStatusCamel,
        license_notes: licenseNotes,
        licenseNotes: licenseNotesCamel,
        permission_statement: permissionStatement,
        permissionStatement: permissionStatementCamel,
        commercial_source: commercialSource,
        commercialSource: commercialSourceCamel,
        can_be_shared_publicly: canBeSharedPublicly,
        canBeSharedPublicly: canBeSharedPubliclyCamel,
        can_be_copied_by_others: canBeCopiedByOthers,
        canBeCopiedByOthers: canBeCopiedByOthersCamel,
        language_code: languageCode,
        languageCode: languageCodeCamel,
    } = req.body;

    const authors = parseCaseAuthors(req.body);
    if (!title || !areCaseAuthorsValid(authors) || hasDuplicateCaseAuthorEmails(authors)) {
        await removeUploadedFile(req.file);
        return res.status(400).json({ status: "err", message: "Missing required fields." });
    }
    const primaryAuthor = authors[0];

    try {
        const existingCase = await rpg2.singleSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT id, pdf_path, visibility, license_code, attribution_text, rights_status,
                       license_notes, permission_statement, commercial_source,
                       can_be_shared_publicly, can_be_copied_by_others, language_code
                FROM ethical_cases
                WHERE id = $1 AND creator = $2;
            `,
            sqlParams: [rpg2.param("plain", caseId), rpg2.param("plain", req.session.uid)],
        });

        if (!existingCase || !existingCase.id) {
            await removeUploadedFile(req.file);
            return res.status(404).json({ status: "err", message: "Case not found." });
        }

        const hasPdf = req.file && req.file.mimetype === "application/pdf";
        const pdfPath = hasPdf ? `/uploads/cases/${caseId}/case.pdf` : existingCase.pdf_path;
        const normalizedLicenseCode = normalizeLicenseCode(licenseCode ?? licenseCodeCamel, existingCase.license_code || CASE_DEFAULT_LICENSE);
        const normalizedRightsStatus = normalizeRightsStatus(rightsStatus ?? rightsStatusCamel, existingCase.rights_status);
        const sharingFlags = deriveCaseSharingFlags({
            licenseCode:          normalizedLicenseCode,
            rightsStatus:         normalizedRightsStatus,
            canBeSharedPublicly:  canBeSharedPublicly ?? canBeSharedPubliclyCamel ?? existingCase.can_be_shared_publicly,
            canBeCopiedByOthers:  canBeCopiedByOthers ?? canBeCopiedByOthersCamel ?? existingCase.can_be_copied_by_others,
        });
        const normalizedVisibility = normalizeVisibility(visibility, existingCase.visibility || PRIVATE_VISIBILITY);
        if (normalizedVisibility === PUBLIC_VISIBILITY && !sharingFlags.canBeSharedPublicly) {
            await removeUploadedFile(req.file);
            return res.status(409).json({
                status:  "err",
                message: "This case needs explicit public sharing rights before it can be published.",
                code:    "CASE_PUBLIC_SHARING_RIGHTS_REQUIRED",
            });
        }

        const updatedCase = await rpg2.singleSQL({
            dbcon: config.dbconnString,
            sql: `
                UPDATE ethical_cases
                SET title = $1,
                    author_firstname = $2,
                    author_lastname = $3,
                    author_email = $4,
                    pdf_path = $5,
                    visibility = $8,
                    license_code = $9,
                    attribution_text = $10,
                    rights_status = $11,
                    license_notes = $12,
                    permission_statement = $13,
                    commercial_source = $14,
                    can_be_shared_publicly = $15,
                    can_be_copied_by_others = $16,
                    language_code = $17,
                    updated_at = NOW()
                WHERE id = $6 AND creator = $7
                RETURNING id, case_uuid, title, author_firstname, author_lastname, author_email,
                          pdf_path, creator, visibility, license_code, attribution_text,
                          original_case_id, imported_from_case_id, source_case_title,
                          source_case_author, source_case_license_code, is_editable_copy,
                          rights_status, license_notes, permission_statement, commercial_source,
                          can_be_shared_publicly, can_be_copied_by_others, language_code,
                          created_at, updated_at;
            `,
            sqlParams: [
                rpg2.param("plain", title),
                rpg2.param("plain", primaryAuthor.authorFirstname),
                rpg2.param("plain", primaryAuthor.authorLastname),
                rpg2.param("plain", primaryAuthor.authorEmail),
                rpg2.param("plain", pdfPath),
                rpg2.param("plain", caseId),
                rpg2.param("plain", req.session.uid),
                rpg2.param("plain", normalizedVisibility),
                rpg2.param("plain", normalizedLicenseCode),
                rpg2.param("plain", attributionText ?? attributionTextCamel ?? existingCase.attribution_text ?? null),
                rpg2.param("plain", normalizedRightsStatus),
                rpg2.param("plain", licenseNotes ?? licenseNotesCamel ?? existingCase.license_notes ?? null),
                rpg2.param("plain", permissionStatement ?? permissionStatementCamel ?? existingCase.permission_statement ?? null),
                rpg2.param("plain", commercialSource ?? commercialSourceCamel ?? existingCase.commercial_source ?? null),
                rpg2.param("plain", sharingFlags.canBeSharedPublicly),
                rpg2.param("plain", sharingFlags.canBeCopiedByOthers),
                rpg2.param("plain", normalizeLanguageCode(languageCode ?? languageCodeCamel, existingCase.language_code || DEFAULT_LANGUAGE_CODE)),
            ],
        });
        await replaceCaseAuthors(caseId, authors);

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

router.patch("/cases/:id/visibility", async (req, res) => {
    if (!requireRole(req, res, "P")) {
        return;
    }

    const caseId = parseCaseId(req.params.id);
    if (!caseId) {
        return res.status(400).json({ status: "err", message: "Invalid case id." });
    }

    const visibility = normalizeVisibility(req.body?.visibility);

    try {
        const updated = await rpg2.singleSQL({
            dbcon: config.dbconnString,
            sql: `
                UPDATE ethical_cases
                SET visibility = $1,
                    license_code = COALESCE(license_code, $4),
                    updated_at = NOW()
                WHERE id = $2
                  AND creator = $3
                  AND ($1 <> 'public' OR can_be_shared_publicly = true)
                RETURNING id, visibility, license_code, can_be_shared_publicly;
            `,
            sqlParams: [
                rpg2.param("plain", visibility),
                rpg2.param("plain", caseId),
                rpg2.param("plain", req.session.uid),
                rpg2.param("plain", CASE_DEFAULT_LICENSE),
            ],
        });

        if (!updated || !updated.id) {
            return res.status(409).json({
                status:  "err",
                message: visibility === PUBLIC_VISIBILITY
                    ? "This case needs explicit public sharing rights before it can be published."
                    : "Case not found.",
                code: visibility === PUBLIC_VISIBILITY ? "CASE_PUBLIC_SHARING_RIGHTS_REQUIRED" : "CASE_NOT_FOUND",
            });
        }

        return res.status(200).json({
            status: "ok",
            result: {
                id: updated.id,
                visibility: updated.visibility,
                public: updated.visibility === PUBLIC_VISIBILITY,
                licenseCode: updated.license_code,
                canBeSharedPublicly: canCaseBeSharedPublicly(updated),
            },
        });
    } catch (error) {
        console.error("Error updating case visibility:", error);
        return res.status(500).json({ status: "err", message: "Failed to update case visibility." });
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
