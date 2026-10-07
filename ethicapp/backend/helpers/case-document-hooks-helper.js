import * as config from "../config/database.config.js";
import * as rpg2 from "../db/rest-pg-2.js";

/**
 * External-service hooks for ethical case documents.
 *
 * Teachers upload a case as a PDF, and a separate worker extracts its text
 * asynchronously (pdf_render_jobs). The `case-document-ready` hook is
 * therefore started when a case document is queued for rendering (create,
 * PDF replacement, import, duplicate) but dispatched only once the render has
 * completed, so subscribers always receive the text of the current document.
 *
 * Case hooks have no phase design: recipients are the enabled manifest
 * services that subscribe to the hook. Waiting happens in the web process and
 * is best effort; if it is interrupted, the teacher can request the analysis
 * again from the case page.
 */

export const CASE_DOCUMENT_READY_HOOK = "case-document-ready";

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

async function getCaseDocumentContext(caseId) {
    const row = await rpg2.singleSQL({
        dbcon: config.dbconnString,
        sql:   `
            SELECT id, case_uuid, title, language_code, creator
            FROM ethical_cases
            WHERE id = $1;
        `,
        sqlParams: [rpg2.param("plain", caseId)],
    });

    return row?.id ? row : null;
}

async function getCaseText(caseId) {
    // Lazy import: the content helper opens a Redis connection when loaded.
    const { getCaseDocumentRawText } = await import("./case-document-content-helper.js");
    // Bypass the cached text: it may belong to a previous version of the PDF.
    return getCaseDocumentRawText(caseId, { cache: null });
}

async function getRegistry() {
    const registryModule = await import("../services/external-services.service.js");
    return registryModule.default;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function toTimestamp(value) {
    const timestamp = new Date(value).getTime();
    return Number.isNaN(timestamp) ? null : timestamp;
}

export function createCaseDocumentHooks(overrides = {}) {
    const dependencies = {
        getRenderJobState,
        getCaseDocumentContext,
        getCaseText,
        getRegistry,
        sleep,
        now:            () => Date.now(),
        pollIntervalMs: RENDER_POLL_INTERVAL_MS,
        waitTimeoutMs:  RENDER_WAIT_TIMEOUT_MS,
        ...overrides,
    };

    /**
     * Dispatches `case-document-ready` for a case whose document is rendered.
     *
     * @param {number} caseId
     * @param {Object} [options]
     * @param {string[]} [options.serviceIds] - Restricts the recipients, for
     *   example when a teacher asks one service to analyze the case again.
     */
    async function dispatchCaseDocumentReady(caseId, { serviceIds = null } = {}) {
        const registry = await dependencies.getRegistry();
        const enabledServiceIds = serviceIds
            ?? registry.getEnabledServiceIdsForHook(CASE_DOCUMENT_READY_HOOK);

        if (enabledServiceIds.length === 0) {
            return [];
        }

        const caseRow = await dependencies.getCaseDocumentContext(caseId);
        if (!caseRow) {
            return [];
        }

        const caseText = await dependencies.getCaseText(caseId);

        return registry.dispatchHook(CASE_DOCUMENT_READY_HOOK, {
            caseId:       Number(caseRow.id),
            caseUuid:     caseRow.case_uuid,
            caseTitle:    caseRow.title,
            languageCode: caseRow.language_code,
            userId:       caseRow.creator,
            caseText,
        }, { enabledServiceIds });
    }

    /**
     * Waits until the render job queued at `requestedAt` completes, then
     * dispatches the hook. Stops when the render fails or when a newer
     * document replaced it (the job's requested_at changed).
     */
    async function dispatchCaseDocumentReadyWhenRendered({ caseId, requestedAt }) {
        const registry = await dependencies.getRegistry();
        if (registry.getEnabledServiceIdsForHook(CASE_DOCUMENT_READY_HOOK).length === 0) {
            return "no-subscribers";
        }

        const expectedRequestedAt = toTimestamp(requestedAt);
        const deadline = dependencies.now() + dependencies.waitTimeoutMs;

        while (dependencies.now() < deadline) {
            const renderJob = await dependencies.getRenderJobState(caseId);

            if (!renderJob || toTimestamp(renderJob.requested_at) !== expectedRequestedAt) {
                return "superseded";
            }
            if (renderJob.status === "completed") {
                await dispatchCaseDocumentReady(caseId);
                return "dispatched";
            }
            if (renderJob.status === "failed") {
                return "render-failed";
            }

            await dependencies.sleep(dependencies.pollIntervalMs);
        }

        console.warn(
            `[case-document-hooks] Case ${caseId} document was not rendered in time; `
            + `${CASE_DOCUMENT_READY_HOOK} was not dispatched.`
        );
        return "timeout";
    }

    return { dispatchCaseDocumentReady, dispatchCaseDocumentReadyWhenRendered };
}

const defaultCaseDocumentHooks = createCaseDocumentHooks();

export const dispatchCaseDocumentReady = defaultCaseDocumentHooks.dispatchCaseDocumentReady;
export const dispatchCaseDocumentReadyWhenRendered =
    defaultCaseDocumentHooks.dispatchCaseDocumentReadyWhenRendered;
