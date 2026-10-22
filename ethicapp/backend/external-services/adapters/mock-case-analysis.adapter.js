import {
    waitForCaseDocumentText as defaultWaitForCaseDocumentText,
} from "../../helpers/case-document-render-helper.js";

// Development adapter for case-scoped analyses. It runs in the web process and
// calls no external service: once the case document is rendered, it stores the
// word count and an excerpt of the case text. It exercises the whole case
// analysis contract (status updates, UI translations and teacher edits) and
// gives the case view a real analysis to display.

export const MOCK_CASE_ANALYSIS_SCHEMA = "mock-case-analysis/v1";

const CASE_CREATED_HOOK = "case-created";
const EXCERPT_LENGTH    = 280;

const UI_TRANSLATIONS = {
    es_CL: {
        label:       "Análisis de prueba",
        description: "Cuenta las palabras del caso y muestra un extracto. Solo para desarrollo.",
        tabTitle:    "Análisis de prueba",
    },
    en_US: {
        label:       "Mock case analysis",
        description: "Counts the words of the case and shows an excerpt. For development only.",
        tabTitle:    "Mock analysis",
    },
};

// Error messages for each outcome of the render wait other than "ready".
const RENDER_FAILURES = {
    "no-document":   "The case has no document.",
    "render-failed": "The case document could not be rendered.",
    "superseded":    "A newer document replaced the case document.",
    "timeout":       "The case document was not rendered in time.",
};

export function buildMockCaseAnalysis(text) {
    const normalizedText = String(text ?? "").replace(/\s+/gu, " ").trim();

    return {
        wordCount:      normalizedText ? normalizedText.split(" ").length : 0,
        characterCount: normalizedText.length,
        excerpt:        normalizedText.slice(0, EXCERPT_LENGTH),
    };
}

export async function getUiTranslations() {
    return UI_TRANSLATIONS;
}

/**
 * Checks a teacher edit: both counts are non-negative integers and the excerpt
 * is a string of at most EXCERPT_LENGTH characters.
 */
export function validateCaseAnalysisDocument(document) {
    const errors = [];

    for (const key of ["wordCount", "characterCount"]) {
        if (!Number.isInteger(document?.[key]) || document[key] < 0) {
            errors.push(`${key} must be a non-negative integer.`);
        }
    }

    if (typeof document?.excerpt !== "string" || document.excerpt.length > EXCERPT_LENGTH) {
        errors.push(`excerpt must be a string of at most ${EXCERPT_LENGTH} characters.`);
    }

    if (errors.length > 0) {
        return { errors };
    }

    return {
        documentSchema: MOCK_CASE_ANALYSIS_SCHEMA,
        document:       {
            wordCount:      document.wordCount,
            characterCount: document.characterCount,
            excerpt:        document.excerpt.trim(),
        },
    };
}

async function processCaseCreated({ context, callback, caseAnalyses, waitForCaseDocumentText }) {
    const analysis = await caseAnalyses.markProcessing({
        caseId: context.caseId,
        jobId:  context.jobId,
    });

    if (!analysis) {
        await callback({
            hook:   CASE_CREATED_HOOK,
            status: "skipped",
            reason: "The service was not chosen for this case.",
        });
        return;
    }

    const outcome = await waitForCaseDocumentText(context.caseId);

    if (outcome.status !== "ready") {
        const errorMessage = RENDER_FAILURES[outcome.status]
            ?? "The case document is not available.";
        await caseAnalyses.fail({ jobId: analysis.jobId, errorCode: outcome.status, errorMessage });
        await callback({ hook: CASE_CREATED_HOOK, status: "failed", error: errorMessage });
        return;
    }

    await caseAnalyses.complete({
        jobId:          analysis.jobId,
        documentSchema: MOCK_CASE_ANALYSIS_SCHEMA,
        document:       buildMockCaseAnalysis(outcome.text),
    });
    await callback({ hook: CASE_CREATED_HOOK, status: "completed", caseId: context.caseId });
}

export async function register({
    subscribe,
    caseAnalyses,
    mockCaseAnalysisDependencies = {},
}) {
    const waitForCaseDocumentText = mockCaseAnalysisDependencies.waitForCaseDocumentText
        ?? defaultWaitForCaseDocumentText;

    subscribe(CASE_CREATED_HOOK, async (context, { callback }) => {
        try {
            await processCaseCreated({ context, callback, caseAnalyses, waitForCaseDocumentText });
        } catch (error) {
            await callback({
                hook:   CASE_CREATED_HOOK,
                status: "failed",
                error:  error?.message || "Unexpected mock case analysis error.",
            });
        }
    });
}
