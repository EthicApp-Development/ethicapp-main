import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const config = {
    pollIntervalMs: Number(process.env.PDF_RENDER_WORKER_POLL_INTERVAL_MS || 2000),
    concurrency: Number(process.env.PDF_RENDER_WORKER_CONCURRENCY || 1),
    dpi: Number(process.env.PDF_RENDER_DPI || 150),
    maxPages: Number(process.env.PDF_RENDER_MAX_PAGES || 50),
    timeoutMs: Number(process.env.PDF_RENDER_TIMEOUT_MS || 120000),
};

let shuttingDown = false;

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

async function pollOnce() {
    // Job claiming/rendering will be wired when pdf_render_jobs lands.
    return null;
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
        await pollOnce();
        await sleep(config.pollIntervalMs);
    }

    console.info("[pdf-render-worker] Stopped.");
}

main().catch(error => {
    console.error("[pdf-render-worker] Fatal startup error:", error);
    process.exit(1);
});
