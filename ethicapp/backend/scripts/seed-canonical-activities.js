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
        await pool.query(
            `
                UPDATE ethical_cases
                SET author_firstname = $2,
                    author_lastname = $3,
                    pdf_path = $4,
                    updated_at = NOW()
                WHERE id = $1
            `,
            [
                caseId,
                activity.case.authorFirstname,
                activity.case.authorLastname,
                pdfPath,
            ]
        );

        return caseId;
    }

    const inserted = await pool.query(
        `
            INSERT INTO ethical_cases
                (title, author_firstname, author_lastname, author_email, pdf_path, creator)
            VALUES
                ($1, $2, $3, $4, $5, $6)
            RETURNING id
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

    return inserted.rows[0].id;
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
            ]
        );

        return designId;
    }

    const inserted = await pool.query(
        `
            INSERT INTO designs (creator, design, public, locked, case_id)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id
        `,
        [
            ownerId,
            activity.design,
            activity.public === true,
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
            const caseId = await upsertCase(pool, activity, ownerId, manifestDir);
            const designId = await upsertDesign(pool, activity, ownerId, caseId);

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
