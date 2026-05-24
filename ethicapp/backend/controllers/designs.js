"use strict";

import express from "express";
import fs from "fs/promises";
import path from "path";
import * as config from "../config/database.config.js";
import { uploadsPath } from "../config/uploads.config.js";
import * as rpg2 from "../db/rest-pg-2.js";
import { hasTheUserRoleById } from '../helpers/users-helper.js';
import { requireRole } from "../helpers/auth-helper.js";
import {
    CASE_DEFAULT_LICENSE,
    DEFAULT_LANGUAGE_CODE,
    DESIGN_DEFAULT_LICENSE,
    PRIVATE_VISIBILITY,
    PUBLIC_VISIBILITY,
    buildAttributionText,
    buildLocalizedCopyTitle,
    getCaseAuthorName,
    getDesignTitle,
    getUserDisplayName,
    isPublicVisibility,
    normalizeLicenseCode,
    normalizeLanguageCode,
    normalizeVisibility,
} from "../helpers/sharing-policy-helper.js";

const router = express.Router();
const uploadsRoot = path.resolve(process.cwd(), uploadsPath);
const MAX_SEMANTIC_TAGS = 5;

function sameId(left, right) {
    return Number(left) === Number(right);
}

function parseTagIds(value) {
    if (!value) {
        return [];
    }

    const parsed = Array.isArray(value) ? value : [];
    return Array.from(new Set(parsed.map(tagId => Number(tagId)).filter(Number.isSafeInteger)));
}

function areTagIdsValid(tagIds) {
    return tagIds.length <= MAX_SEMANTIC_TAGS;
}

async function replaceDesignTags(designId, tagIds, assignedBy, client = null) {
    const db = client ? null : await rpg2.getDBInstance(config.dbconnString);
    const localClient = client || await db.connect();

    try {
        if (!client) {
            await localClient.query("BEGIN");
        }

        await localClient.query("DELETE FROM designs_tags WHERE design_id = $1;", [designId]);
        for (const tagId of tagIds) {
            await localClient.query(`
                INSERT INTO designs_tags (design_id, tag_id, assigned_by)
                VALUES ($1, $2, $3)
                ON CONFLICT (design_id, tag_id) DO UPDATE
                SET assigned_by = EXCLUDED.assigned_by;
            `, [designId, tagId, assignedBy]);
        }

        if (!client) {
            await localClient.query("COMMIT");
        }
    } catch (error) {
        if (!client) {
            await localClient.query("ROLLBACK");
        }
        throw error;
    } finally {
        if (!client) {
            localClient.release();
        }
    }
}

router.get("/licenses", async (req, res) => {
    if (!requireRole(req, res, ["P", "A"])) {
        return;
    }

    try {
        const licenses = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT code, name, url, allows_derivatives, requires_attribution,
                       share_alike, non_commercial
                FROM licenses
                ORDER BY code;
            `,
        });

        return res.status(200).json({ status: "ok", result: licenses });
    } catch (error) {
        console.error("Error loading licenses:", error);
        return res.status(500).json({ status: "err", message: "Failed to load licenses." });
    }
});

router.get("/languages", async (req, res) => {
    if (!requireRole(req, res, ["P", "A"])) {
        return;
    }

    try {
        const languages = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT code, name, native_name, sort_order
                FROM languages
                ORDER BY sort_order, native_name;
            `,
        });

        return res.status(200).json({ status: "ok", result: languages });
    } catch (error) {
        console.error("Error loading languages:", error);
        return res.status(500).json({ status: "err", message: "Failed to load languages." });
    }
});

function normalizeDesignRow(row) {
    const creatorName = getUserDisplayName({
        firstname: row.creator_firstname,
        lastname:  row.creator_lastname,
        name:      row.creator_name,
        mail:      row.creator_email,
    });
    const visibility = normalizeVisibility(row.visibility, row.public ? PUBLIC_VISIBILITY : PRIVATE_VISIBILITY);
    const design = {
        ...row.design,
        id: row.id,
        public: isPublicVisibility(visibility),
        visibility,
        locked: row.locked,
        archived: row.archived === true,
        licenseCode: row.license_code || DESIGN_DEFAULT_LICENSE,
        languageCode: row.language_code || DEFAULT_LANGUAGE_CODE,
        attributionText: row.attribution_text,
        originalDesignId: row.original_design_id,
        importedFromDesignId: row.imported_from_design_id,
        sourceDesignTitle: row.source_design_title,
        sourceDesignAuthor: row.source_design_author,
        sourceDesignLicenseCode: row.source_design_license_code,
        isEditableCopy: row.is_editable_copy !== false,
        caseId: row.case_id,
        tags: Array.isArray(row.tags) ? row.tags : [],
        associatedCase: row.case_id ? {
            id: row.case_id,
            title: row.case_title,
            authorFirstname: row.case_author_firstname,
            authorLastname: row.case_author_lastname,
            authorEmail: row.case_author_email,
            visibility: row.case_visibility || PRIVATE_VISIBILITY,
            licenseCode: row.case_license_code || CASE_DEFAULT_LICENSE,
            languageCode: row.case_language_code || DEFAULT_LANGUAGE_CODE,
            archived: row.case_archived === true,
            attributionText: row.case_attribution_text,
            originalCaseId: row.case_original_case_id,
            importedFromCaseId: row.case_imported_from_case_id,
            sourceCaseTitle: row.case_source_case_title,
            sourceCaseAuthor: row.case_source_case_author,
            sourceCaseLicenseCode: row.case_source_case_license_code,
            isEditableCopy: row.case_is_editable_copy !== false,
            rightsStatus: row.case_rights_status,
            licenseNotes: row.case_license_notes,
            permissionStatement: row.case_permission_statement,
            commercialSource: row.case_commercial_source,
        } : null,
        userOwned: row.user_owned,
    };

    if (!row.user_owned && creatorName) {
        design.metainfo = {
            ...(design.metainfo || {}),
            authorName: creatorName,
            email: row.creator_email || design.metainfo?.email,
        };
    }

    return design;
}

function uploadPublicPathToAbsolute(publicPath) {
    const normalized = String(publicPath || "").replaceAll("\\", "/").replace(/^\/+/, "");
    const relativePath = normalized.startsWith("uploads/")
        ? normalized.slice("uploads/".length)
        : normalized.startsWith("assets/uploads/")
            ? normalized.slice("assets/uploads/".length)
            : normalized;

    if (!relativePath || relativePath.startsWith("../") || relativePath.includes("/../")) {
        return null;
    }

    return path.resolve(uploadsRoot, relativePath);
}

async function copyCasePdfIfPresent(sourcePdfPath, destinationPdfPath) {
    const sourcePath = uploadPublicPathToAbsolute(sourcePdfPath);
    const destinationPath = uploadPublicPathToAbsolute(destinationPdfPath);
    if (!sourcePath || !destinationPath) {
        return false;
    }

    try {
        await fs.mkdir(path.dirname(destinationPath), { recursive: true });
        await fs.copyFile(sourcePath, destinationPath);
        return true;
    } catch (error) {
        console.warn("Unable to copy imported case PDF; retaining source PDF path.", {
            sourcePdfPath,
            destinationPdfPath,
            error: error.message,
        });
        return false;
    }
}

async function getUniqueDesignCopyTitle(client, userId, baseTitle, languageCode) {
    for (let copyIndex = 0; copyIndex < 1000; copyIndex += 1) {
        const candidateTitle = buildLocalizedCopyTitle(baseTitle, languageCode, copyIndex);
        const existingResult = await client.query(`
            SELECT id
            FROM designs
            WHERE creator = $1
              AND COALESCE(design #>> '{metainfo,title}', design ->> 'title') = $2
            LIMIT 1;
        `, [userId, candidateTitle]);

        if (!existingResult.rows[0]) {
            return candidateTitle;
        }
    }

    return buildLocalizedCopyTitle(baseTitle, languageCode, Date.now());
}

async function copyCaseForUser(client, sourceCaseId, userId, visibility = PRIVATE_VISIBILITY, options = {}) {
    if (!sourceCaseId) {
        return null;
    }

    const sourceResult = await client.query(`
        SELECT id, title, author_firstname, author_lastname, author_email, pdf_path, creator,
               visibility, license_code, attribution_text, original_case_id, archived,
               language_code
        FROM ethical_cases
        WHERE id = $1
          AND (
            creator = $2
            OR visibility = 'public'
            OR EXISTS (
                SELECT 1
                FROM designs d
                WHERE d.case_id = ethical_cases.id
                  AND (d.creator = $2 OR d.visibility = 'public')
            )
          )
        LIMIT 1;
    `, [sourceCaseId, userId]);
    const sourceCase = sourceResult.rows[0];
    if (!sourceCase) {
        return null;
    }

    if (
        !sameId(sourceCase.creator, userId) &&
        (!isPublicVisibility(sourceCase.visibility) || sourceCase.archived === true)
    ) {
        return null;
    }

    const rootCaseId = sourceCase.original_case_id || sourceCase.id;
    const existingResult = await client.query(`
        SELECT id
        FROM ethical_cases
        WHERE creator = $1
          AND (id = $2 OR original_case_id = $3)
        ORDER BY CASE WHEN id = $2 THEN 0 ELSE 1 END, id DESC
        LIMIT 1;
    `, [userId, sourceCase.id, rootCaseId]);
    if (!options.forceNew && existingResult.rows[0]?.id) {
        return existingResult.rows[0].id;
    }

    const nextIdResult = await client.query("SELECT nextval(pg_get_serial_sequence('ethical_cases', 'id')) AS id;");
    const caseId = Number(nextIdResult.rows[0].id);
    const destinationPdfPath = `/uploads/cases/${caseId}/case.pdf`;
    const pdfCopied = await copyCasePdfIfPresent(sourceCase.pdf_path, destinationPdfPath);
    const sourceAuthor = getCaseAuthorName(sourceCase);
    const sourceLicenseCode = sourceCase.license_code || CASE_DEFAULT_LICENSE;

    const inserted = await client.query(`
        INSERT INTO ethical_cases
            (id, title, author_firstname, author_lastname, author_email, pdf_path, creator,
             visibility, license_code, attribution_text, original_case_id, imported_from_case_id,
             source_case_title, source_case_author, source_case_license_code, is_editable_copy,
             language_code)
        VALUES
            ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, $11), $12, $13, $14, $15, $16, true, $17)
        RETURNING id;
    `, [
        caseId,
        sourceCase.title,
        sourceCase.author_firstname,
        sourceCase.author_lastname,
        sourceCase.author_email,
        pdfCopied ? destinationPdfPath : sourceCase.pdf_path,
        userId,
        normalizeVisibility(visibility),
        CASE_DEFAULT_LICENSE,
        sourceCase.attribution_text,
        buildAttributionText({
            title:       sourceCase.title,
            author:      sourceAuthor,
            licenseCode: sourceLicenseCode,
        }),
        rootCaseId,
        sourceCase.id,
        sourceCase.title,
        sourceAuthor,
        sourceLicenseCode,
        normalizeLanguageCode(sourceCase.language_code),
    ]);

    await client.query(`
        INSERT INTO ethical_cases_authors (case_id, author_id, user_id, author_order, is_primary)
        SELECT $1,
               ca.author_id,
               u.id,
               ca.author_order,
               ca.is_primary
        FROM ethical_cases_authors ca
        INNER JOIN ethical_case_author a
            ON a.id = ca.author_id
        LEFT JOIN users u
            ON LOWER(u.mail) = LOWER(a.author_email)
        WHERE ca.case_id = $2
        ON CONFLICT (case_id, author_id) DO UPDATE
        SET user_id = EXCLUDED.user_id,
            author_order = EXCLUDED.author_order,
            is_primary = EXCLUDED.is_primary,
            updated_at = NOW();
    `, [caseId, sourceCase.id]);

    await client.query(`
        INSERT INTO ethical_cases_tags (case_id, tag_id, assigned_by)
        SELECT $1, ect.tag_id, $3
        FROM ethical_cases_tags ect
        WHERE ect.case_id = $2
        ON CONFLICT (case_id, tag_id) DO UPDATE
        SET assigned_by = EXCLUDED.assigned_by;
    `, [caseId, sourceCase.id, userId]);

    return inserted.rows[0].id;
}

router.get("/designs/:id", async (req, res) => {
    try {
        // Extract the design ID from request parameters
        const designId = req.params.id;

        // Validate input
        if (!designId) {
            return res.status(400).json({ status: "err", message: "Design ID is required" });
        }

        // Execute the SQL query to fetch the design
        const result = await rpg2.singleSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT design
                FROM designs
                WHERE id = $1
                  AND (
                    creator = $2
                    OR visibility = 'public'
                    OR $3 = 'A'
                  )
            `,
            sqlParams: [
                rpg2.param("plain", designId),
                rpg2.param("plain", req.session?.uid || null),
                rpg2.param("plain", req.session?.role || ""),
            ],
        });

        // Check if the design was found
        if (result && result.design) {
            return res.json({ status: "ok", result: JSON.stringify(result.design) });
        } else {
            return res.status(404).json({ status: "err", message: "Design not found" });
        }
    } catch (err) {
        console.error("Error fetching design:", err);
        return res.status(500).json({ status: "err", message: "Internal Server Error" });
    }
});

router.post("/designs", async (req, res) => {
    try {
        const sessionUid = req.session?.uid;
        const {
            design,
            caseId = null,
            visibility,
            licenseCode,
            license_code: licenseCodeSnake,
            attributionText,
            attribution_text: attributionTextSnake,
            languageCode,
            language_code: languageCodeSnake,
            tagIds = [],
            tag_ids: tagIdsSnake = [],
        } = req.body;

        // Validate session
        if (!sessionUid) {
            return res.status(403).json({ status: "err", message: "Forbidden: You must be logged in to create a design." });
        }

        // Validate input
        if (!design) {
            return res.status(400).json({ status: "err", message: "Invalid input: Design data is required." });
        }

        const parsedTagIds = parseTagIds(tagIdsSnake.length ? tagIdsSnake : tagIds);
        if (!areTagIdsValid(parsedTagIds)) {
            return res.status(400).json({ status: "err", message: "A design can have at most five semantic tags." });
        }

        let { id, ...designNoId } = design;
        const nextVisibility = normalizeVisibility(visibility);
        if (nextVisibility === PUBLIC_VISIBILITY && caseId) {
            const associatedCase = await rpg2.singleSQL({
                dbcon: config.dbconnString,
                sql: `
                    SELECT id, creator, visibility, license_code
                    FROM ethical_cases
                    WHERE id = $1;
                `,
                sqlParams: [rpg2.param("plain", caseId)],
            });

            if (!associatedCase || !associatedCase.license_code) {
                return res.status(400).json({ status: "err", message: "A public design needs an associated case with a license." });
            }

            if (!isPublicVisibility(associatedCase.visibility)) {
                return res.status(409).json({
                    status:  "err",
                    message: "The associated case must be public before publishing this design.",
                    code:    "CASE_VISIBILITY_REQUIRED",
                });
            }
        }

        // Insert the new design into the database
        const result = await rpg2.singleSQL({
            dbcon: config.dbconnString,
            sql: `
                INSERT INTO designs (creator, design, case_id, visibility, public, license_code, attribution_text, language_code)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING id
            `,
            sqlParams: [
                rpg2.param("plain", sessionUid), // Pass the session user ID as creator
                rpg2.param("plain", JSON.stringify(designNoId)), // Serialize the design object
                rpg2.param("plain", caseId),
                rpg2.param("plain", nextVisibility),
                rpg2.param("plain", isPublicVisibility(nextVisibility)),
                rpg2.param("plain", normalizeLicenseCode(licenseCode ?? licenseCodeSnake, DESIGN_DEFAULT_LICENSE)),
                rpg2.param("plain", attributionText ?? attributionTextSnake ?? null),
                rpg2.param("plain", normalizeLanguageCode(languageCode ?? languageCodeSnake)),
            ],
        });

        // Check if the design was successfully created
        if (result && result.id) {
            await replaceDesignTags(result.id, parsedTagIds, sessionUid);
            return res.json({ status: "ok", id: result.id });
        } else {
            return res.status(500).json({ status: "err", message: "Failed to create design." });
        }
    } catch (err) {
        console.error("Error in POST /designs:", err);
        return res.status(500).json({ status: "err", message: "Internal Server Error" });
    }
});

router.patch("/designs/:id", async (req, res) => {
    try {
        const sessionUid = req.session?.uid;
        const designId = parseInt(req.params.id, 10); // Convert designId to an integer
        const {
            design,
            caseId = null,
            visibility,
            licenseCode,
            license_code: licenseCodeSnake,
            attributionText,
            attribution_text: attributionTextSnake,
            languageCode,
            language_code: languageCodeSnake,
            tagIds = [],
            tag_ids: tagIdsSnake = [],
        } = req.body;

        // Validate session
        if (!sessionUid) {
            return res.status(401).json({ status: "err", message: "Unauthorized" });
        }

        // Validate input
        if (!designId || !design) {
            return res.status(400).json({ status: "err", message: "Invalid input" });
        }

        const parsedTagIds = parseTagIds(tagIdsSnake.length ? tagIdsSnake : tagIds);
        if (!areTagIdsValid(parsedTagIds)) {
            return res.status(400).json({ status: "err", message: "A design can have at most five semantic tags." });
        }

        // Fetch the design and check permissions
        const existingDesign = await rpg2.singleSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT id, creator, visibility, license_code, attribution_text, language_code
                FROM designs
                WHERE id = $1
            `,
            sqlParams: [rpg2.param("plain", designId)],
        });

        if (!existingDesign) {
            return res.status(404).json({ status: "err", message: "Design not found" });
        }

        const isAdmin = await hasTheUserRoleById(sessionUid, 'A');
        if (!isAdmin && !sameId(sessionUid, existingDesign.creator)) {
            return res.status(403).json({ status: "err", message: "Forbidden: You do not have permission to update this design." });
        }

        let {id, ...designNoId} = design;
        designNoId = JSON.stringify(designNoId);
        const nextVisibility = normalizeVisibility(visibility, existingDesign.visibility || PRIVATE_VISIBILITY);
        if (nextVisibility === PUBLIC_VISIBILITY && caseId) {
            const associatedCase = await rpg2.singleSQL({
                dbcon: config.dbconnString,
                sql: `
                    SELECT id, visibility, license_code
                    FROM ethical_cases
                    WHERE id = $1;
                `,
                sqlParams: [rpg2.param("plain", caseId)],
            });

            if (!associatedCase || !associatedCase.license_code) {
                return res.status(400).json({ status: "err", message: "A public design needs an associated case with a license." });
            }

            if (!isPublicVisibility(associatedCase.visibility)) {
                return res.status(409).json({
                    status:  "err",
                    message: "The associated case must be public before publishing this design.",
                    code:    "CASE_VISIBILITY_REQUIRED",
                });
            }
        }

        // Update the design
        await rpg2.singleSQL({
            dbcon: config.dbconnString,
            sql: `
                UPDATE designs
                SET design = $1,
                    case_id = $2,
                    visibility = $4,
                    public = $5,
                    license_code = $6,
                    attribution_text = $7,
                    language_code = $8
                WHERE id = $3
            `,
            sqlParams: [
                rpg2.param("plain", designNoId),
                rpg2.param("plain", caseId),
                rpg2.param("plain", designId),
                rpg2.param("plain", nextVisibility),
                rpg2.param("plain", isPublicVisibility(nextVisibility)),
                rpg2.param("plain", normalizeLicenseCode(licenseCode ?? licenseCodeSnake, existingDesign.license_code || DESIGN_DEFAULT_LICENSE)),
                rpg2.param("plain", attributionText ?? attributionTextSnake ?? existingDesign.attribution_text ?? null),
                rpg2.param("plain", normalizeLanguageCode(languageCode ?? languageCodeSnake, existingDesign.language_code || DEFAULT_LANGUAGE_CODE)),
            ],
        });
        await replaceDesignTags(designId, parsedTagIds, sessionUid);

        return res.json({ status: "ok", message: "Design updated successfully" });
    } catch (err) {
        console.error("Error in /designs/:id PATCH:", err);
        return res.status(500).json({ status: "err", message: "Internal Server Error" });
    }
});

router.put("/designs/:id", async (req, res) => {
    try {
        const sessionUid = req.session?.uid; // Get the user ID from the session
        const designId = req.params.id; // Get the design ID from the path
        const updatedDesign = req.body.design; // Get the updated design from the request body

        // Validate session
        if (!sessionUid) {
            return res.status(401).json({ status: "err", message: "Unauthorized" });
        }

        // Validate input
        if (!designId || !updatedDesign) {
            return res.status(400).json({ status: "err", message: "Design ID and updated design data are required" });
        }

        let {id, ...designNoId} = JSON.parse(updatedDesign);
        designNoId = JSON.stringify(designNoId);

        // Execute SQL to update the design
        const result = await singleSQL({
            dbcon: pass.dbcon,
            sql: `
                UPDATE designs
                SET design = $1
                WHERE creator = $2 AND id = $3
            `,
            sqlParams: [designNoId, sessionUid, designId],
        });

        // Check if the update was successful
        if (result) {
            return res.json({ status: "ok" });
        } else {
            return res.status(404).json({ status: "err", message: "Design not found or not owned by the user" });
        }
    } catch (err) {
        console.error("Error in /designs/:id PUT endpoint:", err);
        return res.status(500).json({ status: "err", message: "Internal Server Error" });
    }
});

router.get("/users/:id/designs", async (req, res) => {
    try {
        const userId = req.params.id; // Extract user ID from the path
        const sessionUid = req.session?.uid; // Get session user ID

        // Validate session
        if (!sessionUid) {
            return res.status(401).json({ status: "err", message: "Unauthorized" });
        }

        // Check if the user is allowed to access this data
        const isAdmin = await hasTheUserRoleById(sessionUid, 'A');
        if (!sameId(sessionUid, userId) && !isAdmin) {
            return res.status(403).json({ status: "err", message: "Forbidden" });
        }

        // Execute SQL to fetch the designs
        const designs = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT d.id, d.design, d.public, d.visibility, d.locked, d.archived, d.license_code,
                       d.language_code,
                       d.attribution_text, d.original_design_id, d.imported_from_design_id,
                       d.source_design_title, d.source_design_author, d.source_design_license_code,
                       d.is_editable_copy,
                       d.case_id,
                       c.title AS case_title,
                       c.author_firstname AS case_author_firstname,
                       c.author_lastname AS case_author_lastname,
                       c.author_email AS case_author_email,
                       c.visibility AS case_visibility,
                       c.license_code AS case_license_code,
                       c.language_code AS case_language_code,
                       c.archived AS case_archived,
                       c.attribution_text AS case_attribution_text,
                       c.original_case_id AS case_original_case_id,
                       c.imported_from_case_id AS case_imported_from_case_id,
                       c.source_case_title AS case_source_case_title,
                       c.source_case_author AS case_source_case_author,
                       c.source_case_license_code AS case_source_case_license_code,
                       c.is_editable_copy AS case_is_editable_copy,
                       c.rights_status AS case_rights_status,
                       c.license_notes AS case_license_notes,
                       c.permission_statement AS case_permission_statement,
                       c.commercial_source AS case_commercial_source,
                       COALESCE((
                           SELECT json_agg(json_build_object(
                               'id', t.id,
                               'code', t.code,
                               'label', COALESCE(tt.label, fallback_tt.label, t.code),
                               'description', COALESCE(tt.description, fallback_tt.description),
                               'categoryCode', tc.code,
                               'categoryLabel', COALESCE(tct.label, fallback_tct.label, tc.code)
                           ) ORDER BY tc.sort_order, t.sort_order, t.id)
                           FROM designs_tags dt
                           INNER JOIN tags t ON t.id = dt.tag_id
                           INNER JOIN tag_categories tc ON tc.id = t.category_id
                           LEFT JOIN tag_translations tt
                               ON tt.tag_id = t.id
                              AND tt.locale = d.language_code
                           LEFT JOIN tag_translations fallback_tt
                               ON fallback_tt.tag_id = t.id
                              AND fallback_tt.locale = 'en_US'
                           LEFT JOIN tag_category_translations tct
                               ON tct.category_id = tc.id
                              AND tct.locale = d.language_code
                           LEFT JOIN tag_category_translations fallback_tct
                               ON fallback_tct.category_id = tc.id
                              AND fallback_tct.locale = 'en_US'
                           WHERE dt.design_id = d.id
                       ), '[]'::json) AS tags,
                       TRUE AS user_owned
                FROM designs d
                LEFT JOIN ethical_cases c ON c.id = d.case_id
                WHERE d.creator = $1
                ORDER BY d.id DESC;
            `,
            sqlParams: [userId], // Pass the user ID as a parameter
        });

        // Transform the result into the desired format
        const result = designs.map(normalizeDesignRow);

        // Return the formatted designs
        return res.json({ status: "ok", result });
    } catch (err) {
        console.error("Error in /users/:id/designs:", err);
        return res.status(500).json({ status: "err", message: "Internal Server Error" });
    }
});

router.get("/designs", async (req, res) => {
    try {
        // Validate session
        const sessionUid = req.session?.uid;
        if (!sessionUid) {
            return res.status(401).json({ status: "err", message: "Unauthorized" });
        }

        // Execute SQL query to fetch designs
        const rows = await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT DISTINCT ON (d.id) d.id, d.design, d.public, d.visibility, d.locked, d.archived, d.license_code,
                       d.language_code,
                       d.attribution_text, d.original_design_id, d.imported_from_design_id,
                       d.source_design_title, d.source_design_author, d.source_design_license_code,
                       d.is_editable_copy,
                       d.case_id,
                       c.title AS case_title,
                       c.author_firstname AS case_author_firstname,
                       c.author_lastname AS case_author_lastname,
                       c.author_email AS case_author_email,
                       c.visibility AS case_visibility,
                       c.license_code AS case_license_code,
                       c.language_code AS case_language_code,
                       c.archived AS case_archived,
                       c.attribution_text AS case_attribution_text,
                       c.original_case_id AS case_original_case_id,
                       c.imported_from_case_id AS case_imported_from_case_id,
                       c.source_case_title AS case_source_case_title,
                       c.source_case_author AS case_source_case_author,
                       c.source_case_license_code AS case_source_case_license_code,
                       c.is_editable_copy AS case_is_editable_copy,
                       c.rights_status AS case_rights_status,
                       c.license_notes AS case_license_notes,
                       c.permission_statement AS case_permission_statement,
                       c.commercial_source AS case_commercial_source,
                       COALESCE((
                           SELECT json_agg(json_build_object(
                               'id', t.id,
                               'code', t.code,
                               'label', COALESCE(tt.label, fallback_tt.label, t.code),
                               'description', COALESCE(tt.description, fallback_tt.description),
                               'categoryCode', tc.code,
                               'categoryLabel', COALESCE(tct.label, fallback_tct.label, tc.code)
                           ) ORDER BY tc.sort_order, t.sort_order, t.id)
                           FROM designs_tags dt
                           INNER JOIN tags t ON t.id = dt.tag_id
                           INNER JOIN tag_categories tc ON tc.id = t.category_id
                           LEFT JOIN tag_translations tt
                               ON tt.tag_id = t.id
                              AND tt.locale = d.language_code
                           LEFT JOIN tag_translations fallback_tt
                               ON fallback_tt.tag_id = t.id
                              AND fallback_tt.locale = 'en_US'
                           LEFT JOIN tag_category_translations tct
                               ON tct.category_id = tc.id
                              AND tct.locale = d.language_code
                           LEFT JOIN tag_category_translations fallback_tct
                               ON fallback_tct.category_id = tc.id
                              AND fallback_tct.locale = 'en_US'
                           WHERE dt.design_id = d.id
                       ), '[]'::json) AS tags,
                       u.firstname AS creator_firstname,
                       u.lastname AS creator_lastname,
                       u.name AS creator_name,
                       u.mail AS creator_email,
                       CASE WHEN d.creator = $1 THEN TRUE ELSE FALSE END AS user_owned
                FROM designs d
                LEFT JOIN ethical_cases c ON c.id = d.case_id
                LEFT JOIN users u ON u.id = d.creator
                WHERE d.creator = $1 OR (d.visibility = 'public' AND COALESCE(d.archived, false) = false)
                ORDER BY d.id DESC, user_owned DESC;
            `,
            sqlParams: [sessionUid], // Pass session user ID as the parameter
        });

        // Process the rows to map to the desired structure
        const designs = rows.map(normalizeDesignRow);

        // Respond with the processed designs
        return res.json({ status: "ok", result: designs });
    } catch (err) {
        console.error("Error in /designs query:", err);
        return res.status(500).json({ status: "err", message: "Internal Server Error" });
    }
});

router.patch("/designs/:id/toggle_public", async (req, res) => {
    try {
        const sessionUid = req.session?.uid;
        const designId = parseInt(req.params.id, 10);

        if (!sessionUid) {
            return res.status(401).json({ status: "err", message: "Unauthorized" });
        }

        // Validate input
        if (!designId) {
            return res.status(400).json({ status: "err", message: "Design ID is required" });
        }

        const db = await rpg2.getDBInstance(config.dbconnString);
        const client = await db.connect();
        try {
            await client.query("BEGIN");

            const result = await client.query(`
                SELECT d.id, d.creator, d.visibility, d.license_code, d.case_id,
                       c.creator AS case_creator, c.visibility AS case_visibility,
                       c.license_code AS case_license_code
                FROM designs d
                LEFT JOIN ethical_cases c ON c.id = d.case_id
                WHERE d.id = $1
                FOR UPDATE OF d;
            `, [designId]);
            const design = result.rows[0];
            if (!design) {
                await client.query("ROLLBACK");
                return res.status(404).json({ status: "err", message: "Design not found" });
            }

            const isAdmin = await hasTheUserRoleById(sessionUid, 'A');
            if (!isAdmin && !sameId(sessionUid, design.creator)) {
                await client.query("ROLLBACK");
                return res.status(403).json({ status: "err", message: "Forbidden: You do not have permission to publish this design." });
            }

            const nextVisibility = isPublicVisibility(design.visibility) ? PRIVATE_VISIBILITY : PUBLIC_VISIBILITY;
            let nextCaseId = design.case_id;

            if (nextVisibility === PUBLIC_VISIBILITY) {
                if (!design.license_code) {
                    await client.query("ROLLBACK");
                    return res.status(400).json({ status: "err", message: "A license is required before publishing a design." });
                }

                if (design.case_id) {
                    if (!design.case_license_code) {
                        await client.query("ROLLBACK");
                        return res.status(400).json({ status: "err", message: "The associated case needs a license before the design can be published." });
                    }

                    if (!isPublicVisibility(design.case_visibility)) {
                        if (
                            req.body?.publishCase === true
                            && sameId(design.case_creator, sessionUid)
                        ) {
                            await client.query(`
                                UPDATE ethical_cases
                                SET visibility = 'public',
                                    updated_at = NOW()
                                WHERE id = $1 AND creator = $2;
                            `, [design.case_id, sessionUid]);
                        } else if (req.body?.publishCaseCopy === true) {
                            nextCaseId = await copyCaseForUser(client, design.case_id, sessionUid, PUBLIC_VISIBILITY, { forceNew: true });
                            if (!nextCaseId) {
                                await client.query("ROLLBACK");
                            return res.status(409).json({
                                status:  "err",
                                message: "The associated case cannot be copied publicly. Publish the design with a different public case.",
                                code:    "CASE_COPY_RIGHTS_REQUIRED",
                                });
                            }
                        } else {
                            await client.query("ROLLBACK");
                            return res.status(409).json({
                                status:  "err",
                                message: "The associated case must be public before publishing this design.",
                                code:    "CASE_VISIBILITY_REQUIRED",
                            });
                        }
                    }
                }
            }

            await client.query(`
                UPDATE designs
                SET visibility = $1,
                    public = $2,
                    case_id = $3
                WHERE id = $4;
            `, [nextVisibility, nextVisibility === PUBLIC_VISIBILITY, nextCaseId, designId]);
            await client.query("COMMIT");

            return res.json({
                status: "ok",
                result: {
                    id: designId,
                    visibility: nextVisibility,
                    public: nextVisibility === PUBLIC_VISIBILITY,
                    caseId: nextCaseId,
                },
            });
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }

    } catch (err) {
        console.error("Error in /designs/:id/toggle_public:", err);
        return res.status(500).json({ status: "err", message: "Internal Server Error" });
    }
});

router.patch("/designs/:id/lock", async (req, res) => {
    try {
        const designId = req.params.id;

        // Validate input
        if (!designId) {
            return res.status(400).json({ status: "err", message: "Design ID is required" });
        }

        // Execute SQL to toggle the locked field
        await rpg2.execSQL({
            dbcon: config.dbconnString,
            sql: `
                UPDATE designs
                SET locked = true
                WHERE id = $1;
            `,
            sqlParams: [designId],
        });

        return res.json({ status: "ok", message: "Design locked successfully" });
    } catch (err) {
        console.error("Error in /designs/:id/lock:", err);
        return res.status(500).json({ status: "err", message: "Internal Server Error" });
    }
});

router.patch("/designs/:id/archive", async (req, res) => {
    try {
        const sessionUid = req.session?.uid;
        const designId = parseInt(req.params.id, 10);

        if (!sessionUid) {
            return res.status(401).json({ status: "err", message: "Unauthorized" });
        }

        if (!designId) {
            return res.status(400).json({ status: "err", message: "Design ID is required" });
        }

        const design = await rpg2.singleSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT id, creator
                FROM designs
                WHERE id = $1;
            `,
            sqlParams: [rpg2.param("plain", designId)],
        });

        if (!design) {
            return res.status(404).json({ status: "err", message: "Design not found" });
        }

        const isAdmin = await hasTheUserRoleById(sessionUid, 'A');
        if (!isAdmin && !sameId(sessionUid, design.creator)) {
            return res.status(403).json({ status: "err", message: "Forbidden: You do not have permission to archive this design." });
        }

        const archived = req.body?.archived === true;
        const updated = await rpg2.singleSQL({
            dbcon: config.dbconnString,
            sql: `
                UPDATE designs
                SET archived = $1
                WHERE id = $2
                RETURNING id, archived;
            `,
            sqlParams: [
                rpg2.param("plain", archived),
                rpg2.param("plain", designId),
            ],
        });

        return res.json({
            status: "ok",
            result: {
                id: updated.id,
                archived: updated.archived === true,
            },
        });
    } catch (err) {
        console.error("Error in /designs/:id/archive:", err);
        return res.status(500).json({ status: "err", message: "Internal Server Error" });
    }
});

router.post("/designs/:id/duplicate", async (req, res) => {
    try {
        const sessionUid = req.session?.uid;
        const designId = parseInt(req.params.id, 10); // Convert designId to an integer

        if (!sessionUid) {
            return res.status(401).json({ status: "err", message: "Unauthorized" });
        }

        if (!designId) {
            return res.status(400).json({ status: "err", message: "Design ID is required" });
        }

        console.log(`[/designs/:id/duplicate] designId: '${designId}'`);

        const db = await rpg2.getDBInstance(config.dbconnString);
        const client = await db.connect();
        try {
            await client.query("BEGIN");
            const designResult = await client.query(`
                SELECT d.id, d.creator, d.design, d.visibility, d.license_code, d.attribution_text,
                       d.language_code, d.archived,
                       d.case_id, d.original_design_id,
                       c.language_code AS case_language_code,
                       u.firstname AS creator_firstname, u.lastname AS creator_lastname,
                       u.name AS creator_name, u.mail AS creator_email
                FROM designs d
                LEFT JOIN ethical_cases c ON c.id = d.case_id
                LEFT JOIN users u ON u.id = d.creator
                WHERE d.id = $1
                LIMIT 1;
            `, [designId]);
            const design = designResult.rows[0];

            if (!design) {
                await client.query("ROLLBACK");
                return res.status(404).json({ status: "err", message: "Design not found" });
            }

            if (!sameId(sessionUid, design.creator) && (!isPublicVisibility(design.visibility) || design.archived === true)) {
                await client.query("ROLLBACK");
                return res.status(403).json({ status: "err", message: "Forbidden: You cannot clone a private design you do not own." });
            }

            const { id, ...designNoId } = design.design;
            designNoId.public = false;
            designNoId.visibility = PRIVATE_VISIBILITY;
            designNoId.locked = false;
            designNoId.metainfo = {
                ...(designNoId.metainfo || {}),
                title: await getUniqueDesignCopyTitle(
                    client,
                    sessionUid,
                    getDesignTitle(design.design),
                    design.case_language_code || design.language_code
                ),
            };

            const copiedCaseId = design.case_id
                ? await copyCaseForUser(client, design.case_id, sessionUid, PRIVATE_VISIBILITY)
                : null;
            if (design.case_id && !copiedCaseId) {
                await client.query("ROLLBACK");
                return res.status(409).json({
                    status:  "err",
                    message: "This design cannot be imported because its associated case is no longer publicly shareable.",
                    code:    "DESIGN_CASE_NOT_IMPORTABLE",
                });
            }

            const sourceTitle = getDesignTitle(design.design);
            const sourceAuthor = getUserDisplayName({
                firstname: design.creator_firstname,
                lastname:  design.creator_lastname,
                name:      design.creator_name,
                mail:      design.creator_email,
            });
            const sourceLicenseCode = design.license_code || DESIGN_DEFAULT_LICENSE;
            const result = await client.query(`
                INSERT INTO designs
                    (creator, design, case_id, visibility, public, locked, license_code, attribution_text,
                     original_design_id, imported_from_design_id, source_design_title,
                     source_design_author, source_design_license_code, is_editable_copy, language_code,
                     archived)
                VALUES
                    ($1, $2, $3, 'private', false, false, $4, COALESCE($5, $6),
                     $7, $8, $9, $10, $11, true, $12,
                     false)
                RETURNING id;
            `, [
                sessionUid,
                designNoId,
                copiedCaseId,
                DESIGN_DEFAULT_LICENSE,
                design.attribution_text,
                buildAttributionText({
                    title:       sourceTitle,
                    author:      sourceAuthor,
                    licenseCode: sourceLicenseCode,
                }),
                design.original_design_id || design.id,
                design.id,
                sourceTitle,
                sourceAuthor,
                sourceLicenseCode,
                normalizeLanguageCode(design.language_code),
            ]);

            await client.query(`
                INSERT INTO designs_tags (design_id, tag_id, assigned_by)
                SELECT $1, dt.tag_id, $3
                FROM designs_tags dt
                WHERE dt.design_id = $2
                ON CONFLICT (design_id, tag_id) DO UPDATE
                SET assigned_by = EXCLUDED.assigned_by;
            `, [result.rows[0].id, design.id, sessionUid]);
            await client.query("COMMIT");

            if (result.rows[0]?.id) {
                return res.json({ status: "ok", id: result.rows[0].id, caseId: copiedCaseId });
            }

            return res.status(500).json({ status: "err", message: "Failed to duplicate design" });
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error("Error in /designs/:id/duplicate:", err);
        return res.status(500).json({ status: "err", message: "Internal Server Error" });
    }
});

router.delete("/designs/:id", async (req, res) => {
    try {
        const sessionUid = req.session?.uid;
        const designId = parseInt(req.params.id, 10); // Convert designId to an integer

        // Validate session
        if (!sessionUid) {
            return res.status(401).json({ status: "err", message: "Unauthorized" });
        }

        // Validate input
        if (!designId) {
            return res.status(400).json({ status: "err", message: "Design ID is required" });
        }

        // Fetch the design
        const design = await rpg2.singleSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT id, creator
                FROM designs
                WHERE id = $1
            `,
            sqlParams: [rpg2.param("plain", designId)],
        });

        if (!design) {
            return res.status(404).json({ status: "err", message: "Design not found" });
        }

        // Check if the user is an admin or the creator of the design
        const isAdmin = await hasTheUserRoleById(sessionUid, 'A');
        if (!isAdmin && !sameId(sessionUid, design.creator)) {
            return res.status(403).json({ status: "err", message: "Forbidden: You do not have permission to delete this design." });
        }

        // Delete the design
        await rpg2.singleSQL({
            dbcon: config.dbconnString,
            sql: `
                DELETE FROM designs
                WHERE id = $1
            `,
            sqlParams: [rpg2.param("plain", designId)],
        });

        // Return success response
        return res.json({ status: "ok", message: "Design deleted successfully" });
    } catch (err) {
        console.error("Error in /designs/:id DELETE:", err);
        return res.status(500).json({ status: "err", message: "Internal Server Error" });
    }
});

// Endpoint to check the validity of a design
router.get('/designs/:id/valid', async (req, res) => {
    try {
        const designId = parseInt(req.params.id, 10);

        // Validate input
        if (isNaN(designId)) {
            return res.status(400).json({ status: 'err', message: 'Invalid design ID' });
        }

        // Query the database for the design's valid flag
        const result = await rpg2.singleSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT design ->> 'valid' AS valid
                FROM designs
                WHERE id = $1
            `,
            sqlParams: [rpg2.param("plain", designId)],
        });

        // Check if the design exists
        if (!result) {
            return res.status(404).json({ status: 'err', message: 'Design not found' });
        }

        // Convert 'valid' to a boolean
        const isValid = result.valid === 'true';
        return res.status(200).json({ status: 'ok', valid: isValid });

    } catch (err) {
        console.error('Error in GET /designs/:id/valid:', err);
        return res.status(500).json({ status: 'err', message: 'Internal Server Error' });
    }
});

router.get("/designs/:id/case", async (req, res) => {
    if (!requireRole(req, res, ["P", "A", "S"])) {
        return;
    }

    try {
        const designId = parseInt(req.params.id, 10);
        if (isNaN(designId)) {
            return res.status(400).json({ status: "err", message: "Invalid design ID" });
        }

        const result = await rpg2.singleSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT d.id AS design_id,
                       c.id,
                       c.title,
                       c.author_firstname,
                       c.author_lastname,
                       c.author_email,
                       c.visibility,
                       c.license_code,
                       c.attribution_text,
                       c.rights_status,
                       c.license_notes,
                       c.permission_statement,
                       c.commercial_source,
                       c.language_code
                FROM designs d
                LEFT JOIN ethical_cases c ON c.id = d.case_id
                WHERE d.id = $1
                  AND (
                    $3 = 'A'
                    OR d.creator = $2
                    OR d.visibility = 'public'
                    OR EXISTS (
                        SELECT 1
                        FROM activity a
                        INNER JOIN sessions s ON s.id = a.session
                        WHERE a.design = d.id
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
                rpg2.param("plain", designId),
                rpg2.param("plain", req.session.uid),
                rpg2.param("plain", req.session.role || ""),
            ],
        });

        if (!result || !result.design_id) {
            return res.status(404).json({ status: "err", message: "Design not found" });
        }

        if (!result.id) {
            return res.status(200).json({ status: "ok", result: null });
        }

        return res.status(200).json({
            status: "ok",
            result: {
                id: result.id,
                title: result.title,
                authorFirstname: result.author_firstname,
                authorLastname: result.author_lastname,
                authorEmail: result.author_email,
                visibility: result.visibility || PRIVATE_VISIBILITY,
                licenseCode: result.license_code || CASE_DEFAULT_LICENSE,
                attributionText: result.attribution_text,
                rightsStatus: result.rights_status,
                licenseNotes: result.license_notes,
                permissionStatement: result.permission_statement,
                commercialSource: result.commercial_source,
            },
        });
    } catch (err) {
        console.error("Error in GET /designs/:id/case:", err);
        return res.status(500).json({ status: "err", message: "Internal Server Error" });
    }
});

export default router;
