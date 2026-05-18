import { execFile } from "child_process";
import crypto from "crypto";
import fs from "fs";
import pg from "pg";
import path from "path";
import { promisify } from "util";
import { dbconnString } from "../config/database.config.js";
import { uploadsPath } from "../config/uploads.config.js";

const execFileAsync = promisify(execFile);
const { Pool } = pg;
const uploadsRoot = path.resolve(process.cwd(), uploadsPath);

const config = {
    pollIntervalMs: Number(process.env.PDF_RENDER_WORKER_POLL_INTERVAL_MS || 2000),
    concurrency: Number(process.env.PDF_RENDER_WORKER_CONCURRENCY || 1),
    dpi: Number(process.env.PDF_RENDER_DPI || 150),
    maxPages: Number(process.env.PDF_RENDER_MAX_PAGES || 50),
    timeoutMs: Number(process.env.PDF_RENDER_TIMEOUT_MS || 120000),
};

let shuttingDown = false;
const pool = new Pool({
    connectionString: dbconnString,
});

function sleep(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

function assertPositiveInteger(name, value) {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer.`);
    }
}

async function assertCommandAvailable(command, args) {
    try {
        await execFileAsync(command, args, { timeout: 5000 });
    } catch (error) {
        throw new Error(`Required PDF rendering command is unavailable: ${command}. ${error.message}`);
    }
}

async function assertRuntimeReady() {
    assertPositiveInteger("PDF_RENDER_WORKER_POLL_INTERVAL_MS", config.pollIntervalMs);
    assertPositiveInteger("PDF_RENDER_WORKER_CONCURRENCY", config.concurrency);
    assertPositiveInteger("PDF_RENDER_DPI", config.dpi);
    assertPositiveInteger("PDF_RENDER_MAX_PAGES", config.maxPages);
    assertPositiveInteger("PDF_RENDER_TIMEOUT_MS", config.timeoutMs);

    await assertCommandAvailable("pdfinfo", ["-v"]);
    await assertCommandAvailable("pdftoppm", ["-v"]);
    await assertCommandAvailable("pdftotext", ["-v"]);
}

function getRelativeUploadPath(publicPath) {
    const normalizedPath = String(publicPath || "").replaceAll("\\", "/").replace(/^\/+/, "");

    if (normalizedPath.startsWith("assets/uploads/")) {
        return normalizedPath.slice("assets/uploads/".length);
    }

    if (normalizedPath.startsWith("uploads/")) {
        return normalizedPath.slice("uploads/".length);
    }

    throw new Error(`Invalid upload public path: ${publicPath}`);
}

function getAbsoluteUploadPath(publicPath) {
    return path.join(uploadsRoot, getRelativeUploadPath(publicPath));
}

function getPublicUploadPath(relativePath) {
    return `/uploads/${relativePath.replaceAll("\\", "/").replace(/^\/+/, "")}`;
}

async function getCaseMetadata(caseId) {
    const result = await pool.query(`
        SELECT id, case_uuid, title, author_firstname, author_lastname, author_email,
               pdf_path, created_at, updated_at
        FROM ethical_cases
        WHERE id = $1;
    `, [caseId]);

    return result.rows[0] || null;
}

function parsePageCount(pdfInfoOutput) {
    const match = String(pdfInfoOutput || "").match(/^Pages:\s+(\d+)/m);
    if (!match) {
        throw new Error("Unable to determine PDF page count.");
    }

    return Number(match[1]);
}

async function getPdfPageCount(sourcePath) {
    const result = await execFileAsync("pdfinfo", [sourcePath], {
        timeout:   config.timeoutMs,
        maxBuffer: 1024 * 1024,
    });

    return parsePageCount(result.stdout);
}

async function extractPdfText(sourcePath) {
    const result = await execFileAsync("pdftotext", ["-layout", sourcePath, "-"], {
        timeout:   config.timeoutMs,
        maxBuffer: 20 * 1024 * 1024,
    });

    return result.stdout || "";
}

async function renderPdfImages(sourcePath, renderedDirectory, pageCount) {
    await fs.promises.rm(renderedDirectory, { recursive: true, force: true });
    await fs.promises.mkdir(renderedDirectory, { recursive: true });

    const outputPrefix = path.join(renderedDirectory, "page");
    await execFileAsync("pdftoppm", [
        "-png",
        "-r",
        String(config.dpi),
        "-f",
        "1",
        "-l",
        String(pageCount),
        sourcePath,
        outputPrefix,
    ], {
        timeout:   config.timeoutMs,
        maxBuffer: 1024 * 1024,
    });
}

async function sha256File(filePath) {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);

    for await (const chunk of stream) {
        hash.update(chunk);
    }

    return hash.digest("hex");
}

function readPngDimensions(buffer) {
    const pngSignature = "89504e470d0a1a0a";
    if (!buffer || buffer.length < 24 || buffer.subarray(0, 8).toString("hex") !== pngSignature) {
        throw new Error("Rendered image is not a valid PNG.");
    }

    return {
        width:  buffer.readUInt32BE(16),
        height: buffer.readUInt32BE(20),
    };
}

async function collectRenderedImages(renderedDirectory, caseId, pageCount) {
    const files = await fs.promises.readdir(renderedDirectory);
    const images = [];

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        const fileName = files.find((candidate) => {
            return candidate === `page-${pageNumber}.png` || candidate === `page-${String(pageNumber).padStart(2, "0")}.png`;
        });

        if (!fileName) {
            throw new Error(`Rendered image for page ${pageNumber} was not produced.`);
        }

        const canonicalFileName = `page-${pageNumber}.png`;
        let absolutePath = path.join(renderedDirectory, fileName);
        if (fileName !== canonicalFileName) {
            const canonicalPath = path.join(renderedDirectory, canonicalFileName);
            await fs.promises.rename(absolutePath, canonicalPath);
            absolutePath = canonicalPath;
        }

        const relativePath = `cases/${caseId}/rendered/${canonicalFileName}`;
        const [stat, header, sha256] = await Promise.all([
            fs.promises.stat(absolutePath),
            fs.promises.readFile(absolutePath).then(buffer => buffer.subarray(0, 24)),
            sha256File(absolutePath),
        ]);
        const dimensions = readPngDimensions(header);

        images.push({
            sequenceNumber: pageNumber,
            pageNumber,
            contentType:    "image/png",
            width:          dimensions.width,
            height:         dimensions.height,
            url:            getPublicUploadPath(relativePath),
            packagePath:    `rendered/${canonicalFileName}`,
            storagePath:    getPublicUploadPath(relativePath),
            sha256,
            byteCount:      stat.size,
        });
    }

    return images;
}

function buildManifest({ caseObj, job, pageCount, textContent, images }) {
    const now = new Date().toISOString();
    const textSha256 = crypto.createHash("sha256").update(textContent).digest("hex");

    return {
        schemaVersion: "case-document-representation/v1",
        kind:          "ethical_case_document",
        metadata:      {
            caseUuid:  caseObj.case_uuid,
            title:     caseObj.title,
            author:    {
                firstname: caseObj.author_firstname,
                lastname:  caseObj.author_lastname,
                email:     caseObj.author_email,
            },
            createdAt: caseObj.created_at?.toISOString?.() || new Date(caseObj.created_at).toISOString(),
            updatedAt: caseObj.updated_at?.toISOString?.() || new Date(caseObj.updated_at).toISOString(),
            source:    {
                format:      "pdf",
                contentType: "application/pdf",
                sha256:      job.source_sha256,
                byteCount:   Number(job.source_byte_count),
                pageCount,
                storagePath: job.source_path,
                packagePath: "source/case.pdf",
            },
            imageRepresentation: {
                status:      "completed",
                format:      "png",
                resolution:  {
                    dpi:  config.dpi,
                    unit: "dpi",
                },
                generatedAt: now,
                renderer:    "poppler-utils pdftoppm",
            },
        },
        content: {
            text: {
                contentType: "text/plain",
                content:     textContent,
                extractedAt: now,
                extractor:   "poppler-utils pdftotext -layout",
                sha256:      textSha256,
            },
            images,
        },
    };
}

async function writeManifest(caseId, manifest) {
    const relativePath = `cases/${caseId}/representation.json`;
    const absolutePath = path.join(uploadsRoot, relativePath);

    await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.promises.writeFile(absolutePath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    return getPublicUploadPath(relativePath);
}

async function claimNextPendingJob() {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const result = await client.query(`
            WITH next_job AS (
                SELECT id
                FROM pdf_render_jobs
                WHERE status = 'pending'
                  AND next_attempt_at <= now()
                  AND attempt_count < max_attempts
                ORDER BY requested_at ASC, id ASC
                LIMIT 1
                FOR UPDATE SKIP LOCKED
            )
            UPDATE pdf_render_jobs AS job
            SET status = 'processing',
                started_at = now(),
                completed_at = NULL,
                error_message = NULL,
                attempt_count = job.attempt_count + 1
            FROM next_job
            WHERE job.id = next_job.id
            RETURNING job.*;
        `);

        await client.query("COMMIT");
        return result.rows[0] || null;
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

function getRetryDelaySeconds(job) {
    const attemptCount = Number(job.attempt_count || 1);
    return Math.min(60 * attemptCount, 15 * 60);
}

async function markJobCompleted(job, { pageCount, manifestPath, metadata }) {
    await pool.query(`
        UPDATE pdf_render_jobs
        SET status = 'completed',
            completed_at = now(),
            next_attempt_at = now(),
            page_count = $2,
            manifest_path = $3,
            error_message = NULL,
            metadata = metadata || $4::jsonb
        WHERE id = $1;
    `, [
        job.id,
        pageCount,
        manifestPath,
        JSON.stringify(metadata),
    ]);
}

async function markJobFailedOrPending(job, error) {
    const hasAttemptsLeft = Number(job.attempt_count) < Number(job.max_attempts);
    const nextStatus = hasAttemptsLeft ? "pending" : "failed";
    const delaySeconds = hasAttemptsLeft ? getRetryDelaySeconds(job) : 0;

    await pool.query(`
        UPDATE pdf_render_jobs
        SET status = $2,
            started_at = NULL,
            completed_at = CASE WHEN $2 = 'failed' THEN now() ELSE NULL END,
            next_attempt_at = now() + ($3::int * interval '1 second'),
            error_message = $4,
            metadata = metadata || $5::jsonb
        WHERE id = $1;
    `, [
        job.id,
        nextStatus,
        delaySeconds,
        error.message || "PDF render failed.",
        JSON.stringify({
            lastWorkerError: {
                message:    error.message || "PDF render failed.",
                observedAt: new Date().toISOString(),
            },
        }),
    ]);
}

async function processClaimedJob(job) {
    console.info("[pdf-render-worker] Claimed PDF render job.", {
        jobId:     job.id,
        ownerType: job.owner_type,
        ownerId:   job.owner_id,
        source:    job.source_path,
    });

    try {
        if (job.owner_type !== "case") {
            throw new Error(`Unsupported PDF render job owner type: ${job.owner_type}`);
        }

        const caseObj = await getCaseMetadata(job.owner_id);
        if (!caseObj) {
            throw new Error(`Case ${job.owner_id} was not found.`);
        }

        const sourcePath = getAbsoluteUploadPath(job.source_path);
        const renderedDirectory = path.join(uploadsRoot, "cases", String(job.owner_id), "rendered");
        const pageCount = await getPdfPageCount(sourcePath);
        if (pageCount > config.maxPages) {
            throw new Error(`PDF has ${pageCount} pages, above PDF_RENDER_MAX_PAGES=${config.maxPages}.`);
        }

        const textContent = await extractPdfText(sourcePath);
        await renderPdfImages(sourcePath, renderedDirectory, pageCount);
        const images = await collectRenderedImages(renderedDirectory, job.owner_id, pageCount);
        const manifest = buildManifest({
            caseObj,
            job,
            pageCount,
            textContent,
            images,
        });
        const manifestPath = await writeManifest(job.owner_id, manifest);

        await markJobCompleted(job, {
            pageCount,
            manifestPath,
            metadata: {
                renderer: {
                    dpi:         config.dpi,
                    pageCount,
                    imageFormat: "png",
                    completedAt: new Date().toISOString(),
                },
            },
        });

        console.info("[pdf-render-worker] Completed PDF render job.", {
            jobId: job.id,
            pageCount,
            manifestPath,
        });
    } catch (error) {
        await markJobFailedOrPending(job, error);
        console.error("[pdf-render-worker] Failed PDF render job.", {
            jobId:   job.id,
            attempts: `${job.attempt_count}/${job.max_attempts}`,
            error,
        });
    }
}

async function pollOnce() {
    const job = await claimNextPendingJob();
    if (!job) {
        return false;
    }

    await processClaimedJob(job);
    return true;
}

function handleShutdown(signal) {
    console.info(`[pdf-render-worker] Received ${signal}; shutting down after current poll.`);
    shuttingDown = true;
}

process.on("SIGINT", () => handleShutdown("SIGINT"));
process.on("SIGTERM", () => handleShutdown("SIGTERM"));

async function main() {
    await assertRuntimeReady();

    console.info("[pdf-render-worker] Started.", {
        pollIntervalMs: config.pollIntervalMs,
        concurrency:   config.concurrency,
        dpi:           config.dpi,
        maxPages:      config.maxPages,
        timeoutMs:     config.timeoutMs,
    });

    while (!shuttingDown) {
        try {
            await pollOnce();
        } catch (error) {
            console.error("[pdf-render-worker] Poll failed:", error);
        }
        await sleep(config.pollIntervalMs);
    }

    await pool.end();
    console.info("[pdf-render-worker] Stopped.");
}

main().catch(error => {
    console.error("[pdf-render-worker] Fatal startup error:", error);
    process.exit(1);
});
