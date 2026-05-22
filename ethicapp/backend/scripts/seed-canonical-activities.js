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
                    pdf_path = $4,
                    updated_at = NOW()
                WHERE id = $1
                RETURNING id, case_uuid, title, author_firstname, author_lastname,
                          author_email, pdf_path, created_at, updated_at
            `,
            [
                caseId,
                activity.case.authorFirstname,
                activity.case.authorLastname,
                pdfPath,
            ]
        );

        return updated.rows[0];
    }

    const inserted = await pool.query(
        `
            INSERT INTO ethical_cases
                (title, author_firstname, author_lastname, author_email, pdf_path, creator)
            VALUES
                ($1, $2, $3, $4, $5, $6)
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
        ]
    );

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
                    case_id = $5
                WHERE id = $1
            `,
            [
                designId,
                activity.design,
                activity.public === true,
                activity.locked === true,
                caseId,
                activity.public === true ? "public" : "private",
            ]
        );

        return designId;
    }

    const inserted = await pool.query(
        `
            INSERT INTO designs (creator, design, public, visibility, locked, case_id)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id
        `,
        [
            ownerId,
            activity.design,
            activity.public === true,
            activity.public === true ? "public" : "private",
            activity.locked === true,
            caseId,
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
