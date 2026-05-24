import fs from "fs/promises";
import {
    createPool,
    defaultTagTaxonomySeedDir,
    listTaxonomySeedFiles,
    parseArgs,
} from "./tag-taxonomy-seed-utils.js";

function getRequiredString(value, fieldPath) {
    const normalized = String(value || "").trim();
    if (!normalized) {
        throw new Error(`Missing required tag taxonomy field: ${fieldPath}`);
    }

    return normalized;
}

function normalizeBoolean(value) {
    return value === true;
}

function normalizeSortOrder(value) {
    const normalized = Number(value);
    return Number.isInteger(normalized) && normalized >= 0 ? normalized : 0;
}

function normalizeTranslationEntries(translations, fieldPath) {
    if (!translations || typeof translations !== "object" || Array.isArray(translations)) {
        throw new Error(`Missing translations map at ${fieldPath}`);
    }

    return Object.entries(translations).map(([locale, translation]) => ({
        locale:      getRequiredString(locale, `${fieldPath}.locale`),
        label:       getRequiredString(translation?.label, `${fieldPath}.${locale}.label`),
        description: translation?.description || null,
        searchKeywords: Array.isArray(translation?.searchKeywords)
            ? translation.searchKeywords.map(keyword => String(keyword).trim()).filter(Boolean)
            : [],
    }));
}

function validateScope(scope, fieldPath) {
    const usableForCases = normalizeBoolean(scope?.cases);
    const usableForDesigns = normalizeBoolean(scope?.designs);

    if (!usableForCases && !usableForDesigns) {
        throw new Error(`${fieldPath} must be usable for cases, designs, or both.`);
    }

    if (usableForCases && !usableForDesigns) {
        throw new Error(`${fieldPath} cannot be usable for cases without also being usable for designs.`);
    }

    return {
        usableForCases,
        usableForDesigns,
    };
}

function validateTaxonomy(taxonomy, filePath) {
    if (taxonomy?.schemaVersion !== "tag-taxonomy/v1") {
        throw new Error(`${filePath} must use schemaVersion tag-taxonomy/v1.`);
    }

    if (taxonomy?.kind !== "ethicapp_tag_taxonomy") {
        throw new Error(`${filePath} must use kind ethicapp_tag_taxonomy.`);
    }

    if (!Array.isArray(taxonomy?.categories) || taxonomy.categories.length === 0) {
        throw new Error(`${filePath} must include at least one tag category.`);
    }

    return taxonomy;
}

async function readTaxonomy(filePath) {
    const raw = await fs.readFile(filePath, "utf8");
    return validateTaxonomy(JSON.parse(raw), filePath);
}

async function upsertTaxonomy(client, taxonomy) {
    const metadata = taxonomy.metadata || {};
    const curation = metadata.curation || {};
    const result = await client.query(
        `
            INSERT INTO tag_taxonomies
                (code, schema_version, version, name, description, source,
                 generated_with, reviewed_by, reviewed_at, curation_notes, updated_at)
            VALUES
                ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
            ON CONFLICT (code) DO UPDATE
            SET schema_version = EXCLUDED.schema_version,
                version = EXCLUDED.version,
                name = EXCLUDED.name,
                description = EXCLUDED.description,
                source = EXCLUDED.source,
                generated_with = EXCLUDED.generated_with,
                reviewed_by = EXCLUDED.reviewed_by,
                reviewed_at = EXCLUDED.reviewed_at,
                curation_notes = EXCLUDED.curation_notes,
                updated_at = NOW()
            RETURNING code
        `,
        [
            getRequiredString(metadata.code, "metadata.code"),
            taxonomy.schemaVersion,
            getRequiredString(metadata.version, "metadata.version"),
            metadata.name || null,
            metadata.description || null,
            metadata.source || null,
            curation.generatedWith || null,
            curation.reviewedBy || null,
            curation.reviewedAt || null,
            curation.notes || null,
        ]
    );

    return result.rows[0].code;
}

async function upsertCategory(client, taxonomyCode, category) {
    const scope = validateScope(category.usableFor, `category ${category.code}.usableFor`);
    const result = await client.query(
        `
            INSERT INTO tag_categories
                (taxonomy_code, code, usable_for_cases, usable_for_designs,
                 sort_order, is_active, updated_at)
            VALUES
                ($1, $2, $3, $4, $5, $6, NOW())
            ON CONFLICT (taxonomy_code, code) DO UPDATE
            SET usable_for_cases = EXCLUDED.usable_for_cases,
                usable_for_designs = EXCLUDED.usable_for_designs,
                sort_order = EXCLUDED.sort_order,
                is_active = EXCLUDED.is_active,
                updated_at = NOW()
            RETURNING id
        `,
        [
            taxonomyCode,
            getRequiredString(category.code, "category.code"),
            scope.usableForCases,
            scope.usableForDesigns,
            normalizeSortOrder(category.sortOrder),
            category.isActive !== false,
        ]
    );

    return result.rows[0].id;
}

async function upsertCategoryTranslations(client, categoryId, category) {
    const translations = normalizeTranslationEntries(
        category.translations,
        `category ${category.code}.translations`
    );

    for (const translation of translations) {
        await client.query(
            `
                INSERT INTO tag_category_translations
                    (category_id, locale, label, description, updated_at)
                VALUES
                    ($1, $2, $3, $4, NOW())
                ON CONFLICT (category_id, locale) DO UPDATE
                SET label = EXCLUDED.label,
                    description = EXCLUDED.description,
                    updated_at = NOW()
            `,
            [categoryId, translation.locale, translation.label, translation.description]
        );
    }
}

async function upsertTag(client, categoryId, tag) {
    const scope = validateScope(tag.usableFor, `tag ${tag.code}.usableFor`);
    const result = await client.query(
        `
            INSERT INTO tags
                (category_id, code, usable_for_cases, usable_for_designs,
                 sort_order, is_active, updated_at)
            VALUES
                ($1, $2, $3, $4, $5, $6, NOW())
            ON CONFLICT (code) DO UPDATE
            SET category_id = EXCLUDED.category_id,
                usable_for_cases = EXCLUDED.usable_for_cases,
                usable_for_designs = EXCLUDED.usable_for_designs,
                sort_order = EXCLUDED.sort_order,
                is_active = EXCLUDED.is_active,
                updated_at = NOW()
            RETURNING id
        `,
        [
            categoryId,
            getRequiredString(tag.code, "tag.code"),
            scope.usableForCases,
            scope.usableForDesigns,
            normalizeSortOrder(tag.sortOrder),
            tag.isActive !== false,
        ]
    );

    return result.rows[0].id;
}

async function upsertTagTranslations(client, tagId, tag) {
    const translations = normalizeTranslationEntries(tag.translations, `tag ${tag.code}.translations`);

    for (const translation of translations) {
        await client.query(
            `
                INSERT INTO tag_translations
                    (tag_id, locale, label, description, search_keywords, updated_at)
                VALUES
                    ($1, $2, $3, $4, $5, NOW())
                ON CONFLICT (tag_id, locale) DO UPDATE
                SET label = EXCLUDED.label,
                    description = EXCLUDED.description,
                    search_keywords = EXCLUDED.search_keywords,
                    updated_at = NOW()
            `,
            [
                tagId,
                translation.locale,
                translation.label,
                translation.description,
                translation.searchKeywords,
            ]
        );
    }
}

async function replaceTagAliases(client, tagId, aliases = []) {
    await client.query("DELETE FROM tag_aliases WHERE tag_id = $1", [tagId]);

    for (const alias of aliases.map(value => String(value).trim()).filter(Boolean)) {
        await client.query(
            `
                INSERT INTO tag_aliases (tag_id, alias_code)
                VALUES ($1, $2)
                ON CONFLICT (tag_id, alias_code) DO NOTHING
            `,
            [tagId, alias]
        );
    }
}

async function seedTaxonomyFile(pool, filePath) {
    const taxonomy = await readTaxonomy(filePath);
    const client = await pool.connect();

    try {
        await client.query("BEGIN");
        const taxonomyCode = await upsertTaxonomy(client, taxonomy);

        for (const category of taxonomy.categories) {
            const categoryId = await upsertCategory(client, taxonomyCode, category);
            await upsertCategoryTranslations(client, categoryId, category);

            if (!Array.isArray(category.tags) || category.tags.length === 0) {
                throw new Error(`Category ${category.code} must include at least one tag.`);
            }

            for (const tag of category.tags) {
                const tagId = await upsertTag(client, categoryId, tag);
                await upsertTagTranslations(client, tagId, tag);
                await replaceTagAliases(client, tagId, tag.aliases || []);
            }
        }

        await client.query("COMMIT");
        console.info(`Seeded tag taxonomy from ${filePath}.`);
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const seedDir = args.seedDir || defaultTagTaxonomySeedDir;
    const files = await listTaxonomySeedFiles(seedDir);

    if (files.length === 0) {
        console.info(`No tag taxonomy seed files found in ${seedDir}. Skipping seed.`);
        return;
    }

    const pool = createPool();
    try {
        for (const filePath of files) {
            await seedTaxonomyFile(pool, filePath);
        }
    } finally {
        await pool.end();
    }
}

main().catch((error) => {
    console.error("Failed to seed tag taxonomies:", error);
    process.exitCode = 1;
});
