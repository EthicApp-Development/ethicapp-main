import fs from "fs/promises";
import path from "path";
import {
    copyFileIfExists,
    createPool,
    defaultManifestPath,
    getDesignTitle,
    parseArgs,
    parseIdList,
    publicUploadPathToFilePath,
    slugify,
} from "./canonical-activity-seed-utils.js";

async function fetchCanonicalDesigns(pool, designIds) {
    if (designIds.length === 0) {
        throw new Error("Provide at least one design id with --design-ids=1,2,3.");
    }

    const result = await pool.query(
        `
            SELECT d.id AS design_id,
                   d.creator,
                   d.design,
                   d.public,
                   d.locked,
                   u.mail AS owner_email,
                   c.id AS case_id,
                   c.title AS case_title,
                   c.author_firstname,
                   c.author_lastname,
                   c.author_email,
                   c.pdf_path
            FROM designs AS d
            INNER JOIN users AS u
                ON u.id = d.creator
            LEFT JOIN ethical_cases AS c
                ON c.id = d.case_id
            WHERE d.id = ANY($1::integer[])
            ORDER BY d.id ASC
        `,
        [designIds]
    );

    return result.rows;
}

async function buildActivityEntry(row, usedKeys, assetsDir) {
    const title = getDesignTitle(row.design, `design-${row.design_id}`);
    const baseKey = slugify(title, `design-${row.design_id}`);
    let key = baseKey;
    let suffix = 2;

    while (usedKeys.has(key)) {
        key = `${baseKey}-${suffix}`;
        suffix += 1;
    }

    usedKeys.add(key);

    const activity = {
        key,
        sourceDesignId: row.design_id,
        ownerEmail: row.owner_email,
        title,
        public: row.public === true,
        locked: row.locked === true,
        design: row.design,
    };

    if (row.case_id) {
        const assetName = `${key}.pdf`;
        const sourcePath = publicUploadPathToFilePath(row.pdf_path);
        const destinationPath = path.join(assetsDir, assetName);
        const copied = sourcePath
            ? await copyFileIfExists(sourcePath, destinationPath)
            : false;

        if (!copied) {
            console.warn(`PDF asset could not be copied for "${title}" from ${row.pdf_path}.`);
        }

        activity.case = {
            sourceCaseId: row.case_id,
            title: row.case_title,
            authorFirstname: row.author_firstname,
            authorLastname: row.author_lastname,
            authorEmail: row.author_email,
            pdfAsset: copied ? `assets/${assetName}` : null,
            sourcePdfPath: row.pdf_path,
        };
    }

    return activity;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const designIds = parseIdList(args["design-ids"] || args.designIds);
    const manifestPath = args.out ? path.resolve(String(args.out)) : defaultManifestPath;
    const seedDir = path.dirname(manifestPath);
    const assetsDir = path.join(seedDir, "assets");
    const pool = createPool();

    try {
        const rows = await fetchCanonicalDesigns(pool, designIds);
        const foundDesignIds = new Set(rows.map(row => Number(row.design_id)));
        const missingDesignIds = designIds.filter(designId => !foundDesignIds.has(designId));

        if (missingDesignIds.length > 0) {
            throw new Error(`Design id(s) not found: ${missingDesignIds.join(", ")}`);
        }

        const usedKeys = new Set();
        const activities = [];

        await fs.mkdir(seedDir, { recursive: true });
        await fs.mkdir(assetsDir, { recursive: true });

        for (const row of rows) {
            activities.push(await buildActivityEntry(row, usedKeys, assetsDir));
        }

        const manifest = {
            version: 1,
            exportedAt: new Date().toISOString(),
            activities,
        };

        await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
        console.info(`Exported ${activities.length} canonical activity seed(s) to ${manifestPath}.`);
    } finally {
        await pool.end();
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
