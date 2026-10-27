import { hashAnalysisInput } from "../../helpers/analysis-input-hash.js";
import { DESIGN_ANALYSIS_HOOKS } from "../../helpers/design-analysis-hooks.js";
import { selectQuestionUnits } from "../../helpers/design-analysis-units.js";
import { ARGUMENTATION_TUTOR_SERVICE_ID } from "./ats-feedback.utils.js";

// Development adapter for design-scoped analyses (#848). It runs in the web
// process and calls no external service. It applies to designs with a case
// and with tutor questions (the question units of the phases that enable
// argumentation-tutor-system, whatever the policy), and stores how many tutor
// phases and questions there are, with each question's word count. It
// exercises the whole design analysis contract:
// analyses on creation (design-created) and on save (design-updated), the
// input hash that skips unchanged saves, copies, and explicit regeneration.

export const MOCK_DESIGN_ANALYSIS_SCHEMA = "mock-design-analysis/v1";

const UI_TRANSLATIONS = {
    es_CL: {
        label:       "Análisis de diseño de prueba",
        description: "Cuenta las fases y preguntas del diseño que usan el tutor de argumentación. "
            + "Solo para desarrollo.",
        tabTitle: "Análisis de prueba",
    },
    en_US: {
        label:       "Mock design analysis",
        description: "Counts the design's phases and questions that use the Argumentation Tutor. "
            + "For development only.",
        tabTitle: "Mock analysis",
    },
};

// Recorded when a started generation fails for another reason, such as a
// database error while storing the result.
const UNEXPECTED_FAILURE = {
    errorCode:    "adapter-error",
    errorMessage: "The mock design analysis failed unexpectedly.",
};

const MISSING_INPUT = {
    errorCode:    "missing-input",
    errorMessage: "The generation carries no analysis input.",
};

export async function getUiTranslations() {
    return UI_TRANSLATIONS;
}

/**
 * Applies to designs with a case and at least one tutor question. The input
 * is the case's language and PDF hash, and the selected questions. The hash
 * covers the case, the language and each question's position and text hash,
 * which is everything the result depends on; design and case ids are left out,
 * so a copy of the design keeps the same hash.
 */
export function designAnalysisInput({ design, designCase }) {
    if (!designCase) {
        return null;
    }

    const questions = selectQuestionUnits(design, { serviceIds: [ARGUMENTATION_TUTOR_SERVICE_ID] });
    if (questions.length === 0) {
        return null;
    }

    const caseInput = {
        languageCode: designCase.languageCode ?? null,
        contentHash:  designCase.contentHash ?? null,
    };

    return {
        input: { case: caseInput, questions },
        hash:  hashAnalysisInput({
            case:      caseInput,
            questions: questions.map(({ id, textHash }) => ({ id, textHash })),
        }),
    };
}

function wordCount(text) {
    const normalized = String(text ?? "").replace(/\s+/gu, " ").trim();
    return normalized ? normalized.split(" ").length : 0;
}

export function buildMockDesignAnalysis(input) {
    const questions = Array.isArray(input?.questions) ? input.questions : [];

    return {
        phaseCount:    new Set(questions.map(question => question.phaseNumber)).size,
        questionCount: questions.length,
        questions:     questions.map(question => ({
            id:             question.id,
            phaseNumber:    question.phaseNumber,
            questionNumber: question.questionNumber,
            text:           question.text,
            textHash:       question.textHash,
            wordCount:      wordCount(question.text),
        })),
    };
}

async function processDesignGeneration({ hookName, context, callback, designAnalyses }) {
    const analysis = await designAnalyses.markProcessing({
        designId: context.designId,
        jobId:    context.jobId,
    });

    if (!analysis) {
        await callback({
            hook:   hookName,
            status: "skipped",
            reason: "The generation is no longer the one reserved for the design.",
        });
        return;
    }

    try {
        if (!context.analysisInput) {
            await designAnalyses.fail({ jobId: analysis.jobId, ...MISSING_INPUT });
            await callback({
                hook:   hookName,
                status: "failed",
                error:  MISSING_INPUT.errorMessage,
            });
            return;
        }

        const stored = await designAnalyses.complete({
            jobId:          analysis.jobId,
            documentSchema: MOCK_DESIGN_ANALYSIS_SCHEMA,
            document:       buildMockDesignAnalysis(context.analysisInput),
        });
        await callback({
            hook:     hookName,
            status:   stored ? "completed" : "skipped",
            designId: context.designId,
        });
    } catch (error) {
        // The generation started, so it is failed here rather than left
        // 'processing' until it is stale. register() reports the error.
        await designAnalyses.fail({ jobId: analysis.jobId, ...UNEXPECTED_FAILURE })
            .catch(failError => console.warn(
                "[mock-design-analysis] Could not record the failed generation.",
                failError
            ));
        throw error;
    }
}

// design-created and design-updated run the reserved generation in the same
// way; the context's `trigger` says what caused it.
export async function register({ subscribe, designAnalyses }) {
    for (const hookName of DESIGN_ANALYSIS_HOOKS) {
        subscribe(hookName, async (context, { callback }) => {
            try {
                await processDesignGeneration({ hookName, context, callback, designAnalyses });
            } catch (error) {
                await callback({
                    hook:   hookName,
                    status: "failed",
                    error:  error?.message || "Unexpected mock design analysis error.",
                });
            }
        });
    }
}
