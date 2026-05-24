import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import {
    copyFileIfExists,
    createPool,
    defaultManifestPath,
    getDesignTitle,
    parseArgs,
    uploadsRoot,
} from "./canonical-activity-seed-utils.js";
import {
    CASE_DEFAULT_LICENSE,
    DEFAULT_LANGUAGE_CODE,
    DESIGN_DEFAULT_LICENSE,
    OPEN_LICENSE_RIGHTS_STATUS,
    OWN_WORK_RIGHTS_STATUS,
    PRIVATE_VISIBILITY,
    PUBLIC_VISIBILITY,
    normalizeLanguageCode,
    normalizeLicenseCode,
    normalizeRightsStatus,
    normalizeVisibility,
} from "../helpers/sharing-policy-helper.js";

function getCaseLicenseCode(activity) {
    return normalizeLicenseCode(
        activity.case?.licenseCode || activity.case?.license_code,
        CASE_DEFAULT_LICENSE
    );
}

function getCaseRightsStatus(activity) {
    const explicitStatus = activity.case?.rightsStatus || activity.case?.rights_status;
    if (explicitStatus) {
        return normalizeRightsStatus(explicitStatus);
    }

    return getCaseLicenseCode(activity).startsWith("CC-")
        ? OPEN_LICENSE_RIGHTS_STATUS
        : OWN_WORK_RIGHTS_STATUS;
}

function getCaseVisibility(activity) {
    return normalizeVisibility(
        activity.case?.visibility,
        activity.public === true ? PUBLIC_VISIBILITY : PRIVATE_VISIBILITY
    );
}

function getCaseLanguageCode(activity) {
    return normalizeLanguageCode(
        activity.case?.languageCode || activity.case?.language_code || activity.languageCode || activity.language_code,
        DEFAULT_LANGUAGE_CODE
    );
}

function getDesignVisibility(activity) {
    return normalizeVisibility(
        activity.visibility,
        activity.public === true ? PUBLIC_VISIBILITY : PRIVATE_VISIBILITY
    );
}

function getDesignLicenseCode(activity) {
    return normalizeLicenseCode(
        activity.licenseCode || activity.license_code,
        DESIGN_DEFAULT_LICENSE
    );
}

function getDesignLanguageCode(activity) {
    return normalizeLanguageCode(
        activity.languageCode || activity.language_code || activity.design?.languageCode || activity.design?.language_code || getCaseLanguageCode(activity),
        DEFAULT_LANGUAGE_CODE
    );
}

async function upsertCaseAuthors(pool, caseId, caseData) {
    if (!caseData?.authorEmail) {
        return;
    }

    await pool.query("DELETE FROM ethical_cases_authors WHERE case_id = $1", [caseId]);

    const authorResult = await pool.query(
        `
            INSERT INTO ethical_case_author (author_firstname, author_lastname, author_email)
            VALUES ($1, $2, $3)
            ON CONFLICT ((LOWER(author_email))) DO UPDATE
            SET author_firstname = EXCLUDED.author_firstname,
                author_lastname = EXCLUDED.author_lastname,
                author_email = EXCLUDED.author_email,
                updated_at = NOW()
            RETURNING id
        `,
        [caseData.authorFirstname, caseData.authorLastname, caseData.authorEmail]
    );
    const userResult = await pool.query(
        `
            SELECT id
            FROM users
            WHERE LOWER(mail) = LOWER($1)
            LIMIT 1
        `,
        [caseData.authorEmail]
    );

    await pool.query(
        `
            INSERT INTO ethical_cases_authors (case_id, author_id, user_id, author_order, is_primary)
            VALUES ($1, $2, $3, 1, true)
            ON CONFLICT (case_id, author_id) DO UPDATE
            SET user_id = EXCLUDED.user_id,
                author_order = EXCLUDED.author_order,
                is_primary = EXCLUDED.is_primary,
                updated_at = NOW()
        `,
        [caseId, authorResult.rows[0].id, userResult.rows[0]?.id || null]
    );
}

async function readManifest(manifestPath) {
    const raw = await fs.readFile(manifestPath, "utf8");
    const manifest = JSON.parse(raw);

    if (!Array.isArray(manifest.activities)) {
        throw new Error("Canonical activity manifest must contain an activities array.");
    }

    return manifest;
}

async function resolveOwnerId(pool, activity) {
    const ownerEmail = String(
        activity.ownerEmail || process.env.CANONICAL_SEED_OWNER_EMAIL || "profesor@test"
    ).trim().toLowerCase();

    const result = await pool.query(
        `
            SELECT id
            FROM users
            WHERE LOWER(mail) = $1
            LIMIT 1
        `,
        [ownerEmail]
    );

    if (result.rowCount === 0) {
        throw new Error(`Canonical seed owner does not exist: ${ownerEmail}`);
    }

    return result.rows[0].id;
}

async function copyCasePdf(activity, manifestDir) {
    if (!activity.case?.pdfAsset) {
        return activity.case?.sourcePdfPath || null;
    }

    const sourcePath = path.resolve(manifestDir, activity.case.pdfAsset);
    const destinationRelativePath = path.join("seed-assets", path.basename(activity.case.pdfAsset));
    const destinationPath = path.join(uploadsRoot, destinationRelativePath);
    const copied = await copyFileIfExists(sourcePath, destinationPath);

    if (!copied) {
        throw new Error(`Canonical case PDF asset not found: ${sourcePath}`);
    }

    return `/uploads/${destinationRelativePath.replaceAll("\\", "/")}`;
}

function publicUploadPathToFilePath(publicPath) {
    const relativePath = String(publicPath || "").replace(/^\/uploads\//, "");
    return path.join(uploadsRoot, relativePath);
}

async function getFileMetadata(filePath) {
    const [stat, buffer] = await Promise.all([
        fs.stat(filePath),
        fs.readFile(filePath),
    ]);

    return {
        byteCount: stat.size,
        sha256:    crypto.createHash("sha256").update(buffer).digest("hex"),
    };
}

function toIsoString(value) {
    if (!value) {
        return new Date().toISOString();
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    return new Date(value).toISOString();
}

async function upsertCase(pool, activity, ownerId, manifestDir) {
    if (!activity.case) {
        return null;
    }

    const pdfPath = await copyCasePdf(activity, manifestDir);
    const licenseCode = getCaseLicenseCode(activity);
    const rightsStatus = getCaseRightsStatus(activity);
    const visibility = getCaseVisibility(activity);
    const languageCode = getCaseLanguageCode(activity);
    const attributionText = activity.case.attributionText || activity.case.attribution_text || null;
    const licenseNotes = activity.case.licenseNotes || activity.case.license_notes || null;
    const permissionStatement = activity.case.permissionStatement || activity.case.permission_statement || null;
    const commercialSource = activity.case.commercialSource || activity.case.commercial_source || null;
    const existing = await pool.query(
        `
            SELECT id
            FROM ethical_cases
            WHERE creator = $1
              AND title = $2
              AND author_email IS NOT DISTINCT FROM $3
            LIMIT 1
        `,
        [ownerId, activity.case.title, activity.case.authorEmail]
    );

    if (existing.rowCount > 0) {
        const caseId = existing.rows[0].id;
        const updated = await pool.query(
            `
                UPDATE ethical_cases
                SET author_firstname = $2,
                    author_lastname = $3,
                    author_email = $4,
                    pdf_path = $5,
                    visibility = $6,
                    license_code = $7,
                    attribution_text = $8,
                    rights_status = $9,
                    license_notes = $10,
                    permission_statement = $11,
                    commercial_source = $12,
                    language_code = $13,
                    archived = false,
                    updated_at = NOW()
                WHERE id = $1
                RETURNING id, case_uuid, title, author_firstname, author_lastname,
                          author_email, pdf_path, created_at, updated_at
            `,
            [
                caseId,
                activity.case.authorFirstname,
                activity.case.authorLastname,
                activity.case.authorEmail,
                pdfPath,
                visibility,
                licenseCode,
                attributionText,
                rightsStatus,
                licenseNotes,
                permissionStatement,
                commercialSource,
                languageCode,
            ]
        );

        await upsertCaseAuthors(pool, caseId, activity.case);
        return updated.rows[0];
    }

    const inserted = await pool.query(
        `
            INSERT INTO ethical_cases
                (title, author_firstname, author_lastname, author_email, pdf_path, creator,
                 visibility, license_code, attribution_text, rights_status, license_notes,
                 permission_statement, commercial_source, language_code, archived)
            VALUES
                ($1, $2, $3, $4, $5, $6,
                 $7, $8, $9, $10, $11,
                 $12, $13, $14, false)
            RETURNING id, case_uuid, title, author_firstname, author_lastname,
                      author_email, pdf_path, created_at, updated_at
        `,
        [
            activity.case.title,
            activity.case.authorFirstname,
            activity.case.authorLastname,
            activity.case.authorEmail,
            pdfPath,
            ownerId,
            visibility,
            licenseCode,
            attributionText,
            rightsStatus,
            licenseNotes,
            permissionStatement,
            commercialSource,
            languageCode,
        ]
    );

    await upsertCaseAuthors(pool, inserted.rows[0].id, activity.case);
    return inserted.rows[0];
}

async function copyRenderedImages(renderedRepresentation, manifestDir, caseId) {
    const imageAssets = Array.isArray(renderedRepresentation.imageAssets)
        ? renderedRepresentation.imageAssets
        : [];

    if (imageAssets.length === 0) {
        return [];
    }

    const destinationDir = path.join(uploadsRoot, "cases", String(caseId), "rendered");
    await fs.rm(destinationDir, { recursive: true, force: true });
    await fs.mkdir(destinationDir, { recursive: true });

    const copiedImages = [];
    for (const [index, imageAsset] of imageAssets.entries()) {
        const sourcePath = path.resolve(manifestDir, imageAsset);
        const destinationFileName = `page-${index + 1}.png`;
        const destinationPath = path.join(destinationDir, destinationFileName);
        const copied = await copyFileIfExists(sourcePath, destinationPath);

        if (!copied) {
            throw new Error(`Canonical case rendered image asset not found: ${sourcePath}`);
        }

        copiedImages.push({
            sequenceNumber: index + 1,
            pageNumber:     index + 1,
            destinationPath,
            publicPath:      `/uploads/cases/${caseId}/rendered/${destinationFileName}`,
            packagePath:     `rendered/${destinationFileName}`,
        });
    }

    return copiedImages;
}

async function readRenderedManifest(renderedRepresentation, manifestDir) {
    if (!renderedRepresentation.manifestAsset) {
        return null;
    }

    const manifestPath = path.resolve(manifestDir, renderedRepresentation.manifestAsset);
    const raw = await fs.readFile(manifestPath, "utf8");
    return JSON.parse(raw);
}

async function writeRenderedManifest({ activity, caseObj, copiedImages, manifest, pdfMetadata }) {
    const pageCount = copiedImages.length;
    const now = new Date().toISOString();
    const contentImages = await Promise.all(copiedImages.map(async (image) => {
        const fileMetadata = await getFileMetadata(image.destinationPath);
        const sourceImage = manifest?.content?.images?.find((candidate) => {
            return Number(candidate.sequenceNumber) === image.sequenceNumber
                || Number(candidate.pageNumber) === image.pageNumber;
        }) || {};

        return {
            ...sourceImage,
            sequenceNumber: image.sequenceNumber,
            pageNumber:     image.pageNumber,
            contentType:    sourceImage.contentType || "image/png",
            url:            image.publicPath,
            packagePath:    image.packagePath,
            storagePath:    image.publicPath,
            sha256:         fileMetadata.sha256,
            byteCount:      fileMetadata.byteCount,
        };
    }));

    const rewrittenManifest = {
        ...(manifest || {}),
        schemaVersion: manifest?.schemaVersion || "case-document-representation/v1",
        kind:          manifest?.kind || "ethical_case_document",
        metadata:      {
            ...(manifest?.metadata || {}),
            caseUuid:  caseObj.case_uuid,
            title:     caseObj.title,
            author:    {
                firstname: caseObj.author_firstname,
                lastname:  caseObj.author_lastname,
                email:     caseObj.author_email,
            },
            createdAt: toIsoString(caseObj.created_at),
            updatedAt: toIsoString(caseObj.updated_at),
            source:    {
                ...(manifest?.metadata?.source || {}),
                format:      "pdf",
                contentType: "application/pdf",
                sha256:      pdfMetadata.sha256,
                byteCount:   pdfMetadata.byteCount,
                pageCount,
                storagePath: caseObj.pdf_path,
                packagePath: "source/case.pdf",
            },
            imageRepresentation: {
                ...(manifest?.metadata?.imageRepresentation || {}),
                status:     "completed",
                format:     "png",
                resolution: {
                    dpi:  Number(activity.case.renderedRepresentation?.dpi || manifest?.metadata?.imageRepresentation?.resolution?.dpi || 200),
                    unit: "dpi",
                },
                generatedAt: now,
                renderer:    manifest?.metadata?.imageRepresentation?.renderer || "poppler-utils pdftoppm",
            },
        },
        content: {
            ...(manifest?.content || {}),
            images: contentImages,
        },
    };

    const destinationRelativePath = path.join("cases", String(caseObj.id), "representation.json");
    const destinationPath = path.join(uploadsRoot, destinationRelativePath);
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.writeFile(destinationPath, `${JSON.stringify(rewrittenManifest, null, 2)}\n`, "utf8");

    return `/uploads/${destinationRelativePath.replaceAll("\\", "/")}`;
}

async function upsertCompletedPdfRenderJob(pool, caseObj, pdfMetadata, manifestPath, pageCount, dpi) {
    await pool.query(
        `
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
                'completed',
                NOW(),
                NOW(),
                NOW(),
                NOW(),
                1,
                $5,
                $6,
                NULL,
                $7::jsonb
            )
            ON CONFLICT (owner_type, owner_id)
            DO UPDATE SET
                source_path = EXCLUDED.source_path,
                source_sha256 = EXCLUDED.source_sha256,
                source_byte_count = EXCLUDED.source_byte_count,
                status = 'completed',
                requested_at = NOW(),
                next_attempt_at = NOW(),
                started_at = NOW(),
                completed_at = NOW(),
                attempt_count = 1,
                page_count = EXCLUDED.page_count,
                manifest_path = EXCLUDED.manifest_path,
                error_message = NULL,
                metadata = EXCLUDED.metadata;
        `,
        [
            caseObj.id,
            caseObj.pdf_path,
            pdfMetadata.sha256,
            pdfMetadata.byteCount,
            pageCount,
            manifestPath,
            JSON.stringify({
                reason:   "canonical_activity_seed",
                caseUuid: caseObj.case_uuid,
                renderer: {
                    dpi,
                    pageCount,
                    imageFormat:  "png",
                    completedAt:  new Date().toISOString(),
                    precomputed:  true,
                },
            }),
        ]
    );
}

async function upsertRenderedRepresentation(pool, activity, manifestDir, caseObj) {
    const renderedRepresentation = activity.case?.renderedRepresentation;
    if (!caseObj || !renderedRepresentation) {
        return;
    }

    const copiedImages = await copyRenderedImages(renderedRepresentation, manifestDir, caseObj.id);
    if (copiedImages.length === 0) {
        return;
    }

    const manifest = await readRenderedManifest(renderedRepresentation, manifestDir);
    const pdfMetadata = await getFileMetadata(publicUploadPathToFilePath(caseObj.pdf_path));
    const manifestPath = await writeRenderedManifest({
        activity,
        caseObj,
        copiedImages,
        manifest,
        pdfMetadata,
    });
    const dpi = Number(renderedRepresentation.dpi || manifest?.metadata?.imageRepresentation?.resolution?.dpi || 200);

    await upsertCompletedPdfRenderJob(
        pool,
        caseObj,
        pdfMetadata,
        manifestPath,
        copiedImages.length,
        dpi
    );
}

async function upsertDesign(pool, activity, ownerId, caseId) {
    const title = getDesignTitle(activity.design, activity.title || activity.key);
    const visibility = getDesignVisibility(activity);
    const seedDesign = {
        ...activity.design,
        public: visibility === PUBLIC_VISIBILITY,
        visibility,
        locked: activity.locked === true,
        caseId,
    };
    const licenseCode = getDesignLicenseCode(activity);
    const languageCode = getDesignLanguageCode(activity);
    const attributionText = activity.attributionText || activity.attribution_text || null;
    const existing = await pool.query(
        `
            SELECT id
            FROM designs
            WHERE creator = $1
              AND COALESCE(design #>> '{metainfo,title}', design ->> 'title', '') = $2
            LIMIT 1
        `,
        [ownerId, title]
    );

    if (existing.rowCount > 0) {
        const designId = existing.rows[0].id;
        await pool.query(
            `
                UPDATE designs
                SET design = $2,
                    public = $3,
                    visibility = $6,
                    locked = $4,
                    case_id = $5,
                    license_code = $7,
                    attribution_text = $8,
                    language_code = $9,
                    archived = false
                WHERE id = $1
            `,
            [
                designId,
                seedDesign,
                visibility === PUBLIC_VISIBILITY,
                activity.locked === true,
                caseId,
                visibility,
                licenseCode,
                attributionText,
                languageCode,
            ]
        );

        return designId;
    }

    const inserted = await pool.query(
        `
            INSERT INTO designs
                (creator, design, public, visibility, locked, case_id,
                 license_code, attribution_text, language_code, archived)
            VALUES
                ($1, $2, $3, $4, $5, $6,
                 $7, $8, $9, false)
            RETURNING id
        `,
        [
            ownerId,
            seedDesign,
            visibility === PUBLIC_VISIBILITY,
            visibility,
            activity.locked === true,
            caseId,
            licenseCode,
            attributionText,
            languageCode,
        ]
    );

    return inserted.rows[0].id;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const manifestPath = args.manifest ? path.resolve(String(args.manifest)) : defaultManifestPath;
    const manifestDir = path.dirname(manifestPath);
    const manifest = await readManifest(manifestPath);
    const pool = createPool();

    try {
        for (const activity of manifest.activities) {
            const ownerId = await resolveOwnerId(pool, activity);
            const caseObj = await upsertCase(pool, activity, ownerId, manifestDir);
            await upsertRenderedRepresentation(pool, activity, manifestDir, caseObj);
            const designId = await upsertDesign(pool, activity, ownerId, caseObj?.id || null);

            console.info(`Seeded canonical activity "${activity.key}" as design ${designId}.`);
        }
    } finally {
        await pool.end();
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
