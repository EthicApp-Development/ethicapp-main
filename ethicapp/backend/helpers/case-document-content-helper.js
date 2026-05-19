import fs from "fs/promises";
import path from "path";
import * as config from "../config/database.config.js";
import { uploadsPath } from "../config/uploads.config.js";
import redisClient from "../db/redis.js";
import * as rpg2 from "../db/rest-pg-2.js";

export const CASE_DOCUMENT_CONTENT_CACHE_TTL_SECONDS = 60 * 60 * 12;

const defaultUploadsRoot = path.resolve(process.cwd(), uploadsPath);

function assertPositiveCaseId(caseId) {
    const parsedCaseId = Number(caseId);
    if (!Number.isSafeInteger(parsedCaseId) || parsedCaseId <= 0) {
        throw new Error("caseId must be a positive integer.");
    }

    return parsedCaseId;
}

function getCacheKey(caseId) {
    return `case:${caseId}:document_content:v1`;
}

function publicUploadPathToFilePath(publicPath, uploadsRoot = defaultUploadsRoot) {
    const normalizedPath = String(publicPath || "").replaceAll("\\", "/").replace(/^\/+/, "");

    if (!normalizedPath.startsWith("uploads/")) {
        throw new Error(`Invalid case document representation path: ${publicPath}`);
    }

    return path.join(uploadsRoot, normalizedPath.slice("uploads/".length));
}

async function getManifestPublicPath(caseId) {
    const result = await rpg2.singleSQL({
        dbcon: config.dbconnString,
        sql: `
            SELECT manifest_path
            FROM pdf_render_jobs
            WHERE owner_type = 'case'
              AND owner_id = $1
              AND status = 'completed'
              AND manifest_path IS NOT NULL
            LIMIT 1;
        `,
        sqlParams: [rpg2.param("plain", caseId)],
    });

    return result?.manifest_path || `/uploads/cases/${caseId}/representation.json`;
}

async function readCachedContent(cache, cacheKey) {
    if (!cache) {
        return null;
    }

    try {
        const cachedValue = await cache.get(cacheKey);
        return cachedValue ? JSON.parse(cachedValue) : null;
    } catch (error) {
        console.warn("[case-document-content-helper] Unable to read cached case document content.", {
            cacheKey,
            error,
        });
        return null;
    }
}

async function writeCachedContent(cache, cacheKey, content, ttlSeconds) {
    if (!cache) {
        return;
    }

    try {
        await cache.set(cacheKey, JSON.stringify(content), "EX", ttlSeconds);
    } catch (error) {
        console.warn("[case-document-content-helper] Unable to cache case document content.", {
            cacheKey,
            error,
        });
    }
}

async function readManifestContent(manifestFilePath) {
    const rawManifest = await fs.readFile(manifestFilePath, "utf8");
    const manifest = JSON.parse(rawManifest);

    if (!manifest?.content || typeof manifest.content !== "object") {
        throw new Error(`Case document representation has no content object: ${manifestFilePath}`);
    }

    return manifest.content;
}

export async function getCaseDocumentContent(caseId, options = {}) {
    const parsedCaseId = assertPositiveCaseId(caseId);
    const cache = options.cache === undefined ? redisClient : options.cache;
    const ttlSeconds = Number(options.ttlSeconds || CASE_DOCUMENT_CONTENT_CACHE_TTL_SECONDS);
    const cacheKey = options.cacheKey || getCacheKey(parsedCaseId);
    const cachedContent = await readCachedContent(cache, cacheKey);

    if (cachedContent) {
        return cachedContent;
    }

    const manifestPublicPath = options.manifestPublicPath || await getManifestPublicPath(parsedCaseId);
    const uploadsRoot = options.uploadsRoot || defaultUploadsRoot;
    const manifestFilePath = options.manifestFilePath
        || publicUploadPathToFilePath(manifestPublicPath, uploadsRoot);
    const content = await readManifestContent(manifestFilePath);

    await writeCachedContent(cache, cacheKey, content, ttlSeconds);

    return content;
}

export async function getCaseDocumentRawText(caseId, options = {}) {
    const content = await getCaseDocumentContent(caseId, options);
    return content?.text?.content || "";
}
