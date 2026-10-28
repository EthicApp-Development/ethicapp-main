import { sha256Text } from "./analysis-input-hash.js";
import { phaseExternalServices } from "./phase-external-services.js";
import { plainTextOf } from "./rich-text-helper.js";

/**
 * The units of a design that design analyses are about (epics #846 and #861).
 *
 * A design analysis is declared in the adapter catalog (#863): its producer
 * lists `produces: [{ documentSchema, unit }]` and the adapters that need it
 * list the same pair under `consumes`. A producer analyses only the units of
 * the phases that enable a consumer the AI service policy allows
 * (selectDesignAnalysisUnits()), so a phase without such a consumer costs
 * nothing.
 *
 * The one unit so far is `question`: a non-empty semantic differential
 * question, as plain text (#768), trimmed. Phases and questions have no stable
 * ids in a design, so they are identified by position, 1-based as at runtime:
 * `phaseNumber` is `stages.number` (the phase index + 1) and `questionNumber`
 * is `differential.orden` (the question index + 1, counting empty questions
 * too). The positional id is `p<phaseNumber>-q<questionNumber>`. Each question
 * also carries the hash of its text, so a stored result can tell when its
 * question changed.
 */

export const QUESTION_UNIT = "question";

export function questionUnitId(phaseNumber, questionNumber) {
    return `p${phaseNumber}-q${questionNumber}`;
}

function questionText(question) {
    const text = plainTextOf(question?.q_text, question?.q_text_content_type);
    return typeof text === "string" ? text.trim() : "";
}

function isSemanticDifferential(design) {
    return design?.type === "semantic_differential" && Array.isArray(design.phases);
}

/**
 * The questions of the phases that enable at least one of `serviceIds`.
 *
 * @param {Object} design - A design document (`designs.design`).
 * @param {Object} options
 * @param {Iterable<string>} options.serviceIds - The services a phase may enable.
 * @returns {Array<{id: string, phaseNumber: number, questionNumber: number,
 *     text: string, textHash: string}>} In design order. Empty for ranking
 *     designs, malformed designs and designs without such phases.
 */
export function selectQuestionUnits(design, { serviceIds } = {}) {
    const wanted = new Set(serviceIds ?? []);
    if (wanted.size === 0 || !isSemanticDifferential(design)) {
        return [];
    }

    const selected = [];
    design.phases.forEach((phase, phaseIndex) => {
        const enabled = phaseExternalServices(phase).enabledServiceIds;
        if (!enabled.some(serviceId => wanted.has(serviceId))) {
            return;
        }

        const questions = Array.isArray(phase?.questions) ? phase.questions : [];
        questions.forEach((question, questionIndex) => {
            const text = questionText(question);
            if (!text) {
                return;
            }

            const phaseNumber = phaseIndex + 1;
            const questionNumber = questionIndex + 1;
            selected.push({
                id:       questionUnitId(phaseNumber, questionNumber),
                phaseNumber,
                questionNumber,
                text,
                textHash: sha256Text(text),
            });
        });
    });

    return selected;
}

/**
 * The question at a runtime position (#850), when its phase enables one of
 * `serviceIds`: the phase's `stages.number` and the question's
 * `differential.orden`.
 *
 * @returns {{id: string, phaseNumber: number, questionNumber: number,
 *     text: string, textHash: string}|null} As selectQuestionUnits() returns
 *     it, or null when the position holds no such question.
 */
export function findQuestionUnit(
    design,
    { phaseNumber, questionNumber } = {},
    { serviceIds } = {}
) {
    const id = questionUnitId(phaseNumber, questionNumber);
    return selectQuestionUnits(design, { serviceIds }).find(question => question.id === id) ?? null;
}

// The service ids the phases of a design enable, without duplicates.
function enabledServiceIdsOf(design) {
    return new Set(design.phases.flatMap(phase => phaseExternalServices(phase).enabledServiceIds));
}

// The registry imports the adapters, which import this helper, so it is
// imported when first needed.
async function defaultRegistry() {
    const { default: registry } = await import("../services/external-services.service.js");
    return registry;
}

/**
 * The units a design analysis producer works on, for one design (#863): the
 * units of the phases that enable at least one usable consumer of a schema
 * the producer produces for that unit. A consumer is usable when the AI
 * service policy gate allows it under the current policy version, including
 * its per-adapter switch (#864), and a usable AI Additions connection exists
 * for production adapters (`registry.usableServiceIds()`). A phase that
 * enables an unusable consumer and a usable one is selected.
 *
 * The policy is read only when a phase enables a consumer.
 *
 * @param {Object} args
 * @param {string} args.producerId - The producer's catalog id.
 * @param {Object} args.design - A design document (`designs.design`).
 * @param {string} [args.unit="question"] - Only `question` exists so far.
 * @param {Object} [dependencies]
 * @param {Object} [dependencies.registry] - The registry; the application's
 *     by default. It provides getDesignAnalysisConsumerIds() and
 *     usableServiceIds().
 * @returns {Promise<Array>} As selectQuestionUnits() returns them.
 */
export async function selectDesignAnalysisUnits(
    { producerId, design, unit = QUESTION_UNIT },
    { registry } = {}
) {
    if (unit !== QUESTION_UNIT || !isSemanticDifferential(design)) {
        return [];
    }

    const services = registry ?? await defaultRegistry();
    const enabled = enabledServiceIdsOf(design);
    const consumers = services.getDesignAnalysisConsumerIds(producerId, { unit })
        .filter(serviceId => enabled.has(serviceId));
    if (consumers.length === 0) {
        return [];
    }

    const usable = await services.usableServiceIds(consumers);
    return selectQuestionUnits(design, { serviceIds: usable });
}
