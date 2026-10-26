import * as config from "../config/database.config.js";
import * as rpg2 from "../db/rest-pg-2.js";

/**
 * Waits for the text of a case document.
 *
 * Teachers upload a case as a PDF, and a separate worker extracts its text
 * asynchronously (pdf_render_jobs). Case hooks such as `case-created` fire
 * before that render finishes, so adapters that need the case text wait for it
 * here. Waiting happens in the web process and is best effort; if it is
 * interrupted, the teacher can request the work again from the case page.
 */

const RENDER_POLL_INTERVAL_MS = 3000;
// The render worker makes up to three attempts with retry back-off (about 21
// minutes in the worst case); slower renders fall back to the manual action.
const RENDER_WAIT_TIMEOUT_MS = 30 * 60 * 1000;

async function getRenderJobState(caseId) {
    const row = await rpg2.singleSQL({
        dbcon: config.dbconnString,
        sql:   `
            SELECT status, requested_at
            FROM pdf_render_jobs
            WHERE owner_type = 'case'
              AND owner_id = $1;
        `,
        sqlParams: [rpg2.param("plain", caseId)],
    });

    return row?.status ? row : null;
}

async function getCaseText(caseId) {
    // Lazy import: the content helper opens a Redis connection when loaded.
    const { getCaseDocumentRawText } = await import("./case-document-content-helper.js");
    // Bypass the cached text: it may belong to a previous version of the PDF.
    return getCaseDocumentRawText(caseId, { cache: null });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function toTimestamp(value) {
    const timestamp = new Date(value).getTime();
    return Number.isNaN(timestamp) ? null : timestamp;
}

export function createCaseDocumentRender(overrides = {}) {
    const dependencies = {
        getRenderJobState,
        getCaseText,
        sleep,
        now:            () => Date.now(),
        pollIntervalMs: RENDER_POLL_INTERVAL_MS,
        waitTimeoutMs:  RENDER_WAIT_TIMEOUT_MS,
        ...overrides,
    };

    /**
     * Waits until the current render of the case document completes and
     * returns its text.
     *
     * @param {number} caseId
     * @returns {Promise<{status: string, text?: string}>} `ready` with the
     *   text, or `no-document`, `render-failed`, `superseded` (a newer PDF
     *   replaced the document while waiting) or `timeout`.
     */
    async function waitForCaseDocumentText(caseId) {
        const deadline = dependencies.now() + dependencies.waitTimeoutMs;
        let expectedRequestedAt = null;

        while (dependencies.now() < deadline) {
            const renderJob = await dependencies.getRenderJobState(caseId);
            if (!renderJob) {
                return { status: "no-document" };
            }

            const requestedAt = toTimestamp(renderJob.requested_at);
            expectedRequestedAt ??= requestedAt;
            if (requestedAt !== expectedRequestedAt) {
                return { status: "superseded" };
            }
            if (renderJob.status === "completed") {
                return { status: "ready", text: await dependencies.getCaseText(caseId) };
            }
            if (renderJob.status === "failed") {
                return { status: "render-failed" };
            }

            await dependencies.sleep(dependencies.pollIntervalMs);
        }

        console.warn(`[case-document-render] Case ${caseId} document was not rendered in time.`);
        return { status: "timeout" };
    }

    return { waitForCaseDocumentText };
}

export const { waitForCaseDocumentText } = createCaseDocumentRender();
