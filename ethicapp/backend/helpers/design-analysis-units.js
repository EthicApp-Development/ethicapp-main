import { sha256Text } from "./analysis-input-hash.js";
import { phaseExternalServices } from "./phase-external-services.js";
import { plainTextOf } from "./rich-text-helper.js";

/**
 * The units of a design that design analyses are about (epics #846 and #861).
 *
 * A design analysis is declared in the adapter catalog (#863): its producer
 * lists `produces: [{ documentSchema, unit }]` and the adapters that need it
 * list the same pair under `consumes`. A producer analyses only the units of
 * the phases that enable a consumer the AI service policy allows and that
 * needs them with the phase's configuration of it (#870,
 * selectDesignAnalysisUnits()), so a phase without such a consumer costs
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
 * The questions of the phases that enable at least one of `serviceIds`, and,
 * with `needs`, for which that service needs them.
 *
 * @param {Object} design - A design document (`designs.design`).
 * @param {Object} options
 * @param {Iterable<string>} options.serviceIds - The services a phase may enable.
 * @param {(args: {serviceId: string, configuration: Object}) => boolean} [options.needs]
 *     Whether an enabled service needs the phase's units, given the phase's
 *     stored configuration of that service (`{}` when it has none, #870).
 *     Without it every enabled service needs them.
 * @returns {Array<{id: string, phaseNumber: number, questionNumber: number,
 *     text: string, textHash: string}>} In design order. Empty for ranking
 *     designs, malformed designs and designs without such phases.
 */
export function selectQuestionUnits(design, { serviceIds, needs = null } = {}) {
    const wanted = new Set(serviceIds ?? []);
    if (wanted.size === 0 || !isSemanticDifferential(design)) {
        return [];
    }

    const selected = [];
    design.phases.forEach((phase, phaseIndex) => {
        const { enabledServiceIds, configurations } = phaseExternalServices(phase);
        const selecting = enabledServiceIds.some(serviceId => wanted.has(serviceId)
            && (!needs || needs({ serviceId, configuration: configurations[serviceId] ?? {} })));
        if (!selecting) {
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

// Why a producer selects no unit of a design (explainDesignAnalysisUnits()).
export const NO_UNITS_REASONS = Object.freeze({
    // The design is not a semantic differential, or the unit is unknown.
    NOT_APPLICABLE:     "not-applicable",
    // No phase enables a consumer of the producer's documents.
    NO_CONSUMER:        "no-consumer",
    // Phases enable consumers, but the policy, its per-adapter switches or a
    // missing AI Additions connection make none of them usable.
    CONSUMERS_UNUSABLE: "consumers-unusable",
    // The phases of the usable consumers have no non-empty question.
    NO_QUESTIONS:       "no-questions",
    // The phases of the usable consumers have questions, but no consumer
    // needs them with the phase's configuration (#870), for example a tutor
    // set to the basic mode.
    NOT_NEEDED:         "not-needed",
});

// Whether a consumer needs the producer's analysis in a phase, given the
// phase's configuration of that consumer (#870): the registry asks the
// adapter (consumerNeedsDesignAnalysis()). A registry without the method
// needs every phase, as before #870.
function consumerNeeds(services, { producerId, unit }) {
    if (typeof services.consumerNeedsDesignAnalysis !== "function") {
        return null;
    }
    return ({ serviceId, configuration }) => services.consumerNeedsDesignAnalysis(
        serviceId, { producerId, unit, configuration }
    );
}

/**
 * The units a design analysis producer works on, for one design (#863), and
 * why there are none (#865): the units of the phases that enable at least one
 * usable consumer of a schema the producer produces for that unit, and that
 * needs it there. A consumer is usable when the AI service policy gate allows
 * it under the current policy version, including its per-adapter switch
 * (#864), and a usable AI Additions connection exists for production adapters
 * (`registry.usableServiceIds()`). A phase that enables an unusable consumer
 * and a usable one is selected. A consumer needs a phase's units unless its
 * adapter says otherwise for the phase's configuration of it
 * (`registry.consumerNeedsDesignAnalysis()`, #870): the tutor needs the claim
 * typology only in phases that request its enhanced mode.
 *
 * The policy is read only when a phase enables a consumer.
 *
 * @param {Object} args
 * @param {string} args.producerId - The producer's catalog id.
 * @param {Object} args.design - A design document (`designs.design`).
 * @param {string} [args.unit="question"] - Only `question` exists so far.
 * @param {Object} [dependencies]
 * @param {Object} [dependencies.registry] - The registry; the application's
 *     by default. It provides getDesignAnalysisConsumerIds(),
 *     usableServiceIds() and, optionally, consumerNeedsDesignAnalysis().
 * @returns {Promise<{units: Array, reason: string|null, consumerIds: string[]}>}
 *     `units` as selectQuestionUnits() returns them; `reason` is one of
 *     NO_UNITS_REASONS when `units` is empty, else null; `consumerIds` are
 *     the usable consumers the design's phases enable, whether or not they
 *     need any unit.
 */
export async function explainDesignAnalysisUnits(
    { producerId, design, unit = QUESTION_UNIT },
    { registry } = {}
) {
    if (unit !== QUESTION_UNIT || !isSemanticDifferential(design)) {
        return { units: [], reason: NO_UNITS_REASONS.NOT_APPLICABLE, consumerIds: [] };
    }

    const services = registry ?? await defaultRegistry();
    const enabled = enabledServiceIdsOf(design);
    const consumers = services.getDesignAnalysisConsumerIds(producerId, { unit })
        .filter(serviceId => enabled.has(serviceId));
    if (consumers.length === 0) {
        return { units: [], reason: NO_UNITS_REASONS.NO_CONSUMER, consumerIds: [] };
    }

    const usable = await services.usableServiceIds(consumers);
    if (usable.length === 0) {
        return { units: [], reason: NO_UNITS_REASONS.CONSUMERS_UNUSABLE, consumerIds: [] };
    }

    const units = selectQuestionUnits(design, {
        serviceIds: usable,
        needs:      consumerNeeds(services, { producerId, unit }),
    });
    return {
        units,
        reason:      units.length > 0 ? null : noQuestionsReason(design, usable),
        consumerIds: usable,
    };
}

function noQuestionsReason(design, usableConsumerIds) {
    return selectQuestionUnits(design, { serviceIds: usableConsumerIds }).length > 0
        ? NO_UNITS_REASONS.NOT_NEEDED
        : NO_UNITS_REASONS.NO_QUESTIONS;
}

/**
 * The units a design analysis producer works on, for one design (#863). See
 * explainDesignAnalysisUnits(), which also says why there are none.
 *
 * @returns {Promise<Array>} As selectQuestionUnits() returns them.
 */
export async function selectDesignAnalysisUnits(args, dependencies = {}) {
    return (await explainDesignAnalysisUnits(args, dependencies)).units;
}
