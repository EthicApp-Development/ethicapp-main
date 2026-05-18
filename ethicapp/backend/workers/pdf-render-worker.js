import { execFile } from "child_process";
import pg from "pg";
import { promisify } from "util";
import { dbconnString } from "../config/database.config.js";

const execFileAsync = promisify(execFile);
const { Pool } = pg;

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
                ORDER BY requested_at ASC, id ASC
                LIMIT 1
                FOR UPDATE SKIP LOCKED
            )
            UPDATE pdf_render_jobs AS job
            SET status = 'processing',
                started_at = now(),
                completed_at = NULL,
                error_message = NULL
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

async function requeueClaimedJobUntilRendererLands(job) {
    const delaySeconds = Math.max(Math.ceil(config.pollIntervalMs / 1000), 300);
    await pool.query(`
        UPDATE pdf_render_jobs
        SET status = 'pending',
            started_at = NULL,
            next_attempt_at = now() + ($2::int * interval '1 second'),
            error_message = $3,
            metadata = metadata || jsonb_build_object(
                'lastWorkerObservation',
                jsonb_build_object(
                    'code', 'renderer_pending_implementation',
                    'observedAt', now()
                )
            )
        WHERE id = $1;
    `, [
        job.id,
        delaySeconds,
        "PDF render worker claimed the job; rendering implementation is pending.",
    ]);
}

async function processClaimedJob(job) {
    console.info("[pdf-render-worker] Claimed PDF render job.", {
        jobId:     job.id,
        ownerType: job.owner_type,
        ownerId:   job.owner_id,
        source:    job.source_path,
    });

    await requeueClaimedJobUntilRendererLands(job);

    console.info("[pdf-render-worker] Requeued claimed job until rendering is implemented.", {
        jobId: job.id,
    });
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
