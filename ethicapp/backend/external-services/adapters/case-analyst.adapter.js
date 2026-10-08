import defaultAiAdditionsClient from "../../services/ai-additions-client.service.js";

// Skeleton adapter for the Case Analyst AI Additions service. It establishes
// the adapter boundary (registration, configuration, hook handling) without
// submitting anything to the provider yet. The real analysis flow plugs into
// processCaseCreated() and processExternalResult().

const DEFAULT_CASE_ANALYST_BASE_PATH = "/case-analyst/api/v1";
const CASE_CREATED_HOOK      = "case-created";
const CALLBACK_RECEIVED_HOOK = "callback-received";

let aiAdditionsClient = defaultAiAdditionsClient;

function normalizeText(value) {
    if (value === null || value === undefined) {
        return "";
    }

    const text = String(value).trim();
    return text.length > 0 ? text : "";
}

function toPositiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
}

export function getCaseAnalystBaseUrl(client = aiAdditionsClient) {
    return normalizeText(process.env.AI_ADDITIONS_CASE_ANALYST_API_BASE_URL)
        || client.buildServiceUrl(DEFAULT_CASE_ANALYST_BASE_PATH);
}

/**
 * Builds the analysis request that will eventually be submitted to the Case
 * Analyst service. Returns null when the context has no usable case id.
 */
export function buildCaseAnalysisRequest(context) {
    const caseId = toPositiveInteger(context?.caseId);
    if (!caseId) {
        return null;
    }

    return {
        client_context: {
            service:       "ethicapp",
            correlationId: context.correlationId ?? null,
            caseId,
            caseUuid:      context.caseUuid ?? null,
            userId:        toPositiveInteger(context.userId),
        },
        case: {
            id:             caseId,
            title:          normalizeText(context.title) || null,
            languageCode:   normalizeText(context.languageCode) || null,
            pdfPath:        normalizeText(context.pdfPath) || null,
            pdfRenderJobId: context.pdfRenderJobId ?? null,
        },
    };
}

async function processCaseCreated({ context, callback }) {
    const request = buildCaseAnalysisRequest(context);

    if (!request) {
        await callback({
            hook:   CASE_CREATED_HOOK,
            status: "skipped",
            reason: "Missing caseId in case-created context.",
        });
        return;
    }

    console.info(`[case-analyst] Acknowledged case-created for case ${request.case.id}.`, {
        correlationId: context.correlationId ?? null,
        baseUrl:       getCaseAnalystBaseUrl(),
    });

    await callback({
        hook:            CASE_CREATED_HOOK,
        status:          "completed",
        action:          "acknowledged",
        caseId:          request.case.id,
        analysisRequest: request,
    });
}

async function processExternalResult({ context, callback }) {
    await callback({
        hook:      CALLBACK_RECEIVED_HOOK,
        status:    "completed",
        action:    "recorded",
        eventType: context.eventType ?? null,
        caseId:    toPositiveInteger(context.requestPayload?.caseId),
    });
}

export async function register({ subscribe, aiAdditionsClient: providedAiAdditionsClient }) {
    aiAdditionsClient = providedAiAdditionsClient || defaultAiAdditionsClient;

    subscribe(CASE_CREATED_HOOK, async (context, { callback }) => {
        try {
            await processCaseCreated({ context, callback });
        } catch (error) {
            await callback({
                hook:   CASE_CREATED_HOOK,
                status: "failed",
                error:  normalizeText(error?.message) || "Unexpected case analyst adapter error.",
            });
        }
    });

    subscribe(CALLBACK_RECEIVED_HOOK, async (context, { callback }) => {
        try {
            await processExternalResult({ context, callback });
        } catch (error) {
            await callback({
                hook:   CALLBACK_RECEIVED_HOOK,
                status: "failed",
                error:  normalizeText(error?.message) || "Unexpected case analyst callback error.",
            });
        }
    });
}
