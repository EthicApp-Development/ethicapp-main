import { sha256Text } from "./analysis-input-hash.js";
import { phaseExternalServices } from "./phase-external-services.js";
import { plainTextOf } from "./rich-text-helper.js";

/**
 * The questions of a design that the Argumentation Tutor discusses with
 * students (epic #846): the non-empty semantic differential questions of the
 * phases that enable `argumentation-tutor-system`. Design analyses about those
 * questions (the claim typology, #849) select them here.
 *
 * Phases and questions have no stable ids in a design, so they are identified
 * by position, 1-based as at runtime: `phaseNumber` is `stages.number` (the
 * phase index + 1) and `questionNumber` is `differential.orden` (the question
 * index + 1, counting empty questions too). The positional id is
 * `p<phaseNumber>-q<questionNumber>`. Each question also carries the hash of
 * its text, so a stored result can tell when its question changed.
 */

export const ARGUMENTATION_TUTOR_SERVICE_ID = "argumentation-tutor-system";

export function tutorQuestionId(phaseNumber, questionNumber) {
    return `p${phaseNumber}-q${questionNumber}`;
}

// The question as the tutor receives it: plain text (#768), trimmed.
function questionText(question) {
    const text = plainTextOf(question?.q_text, question?.q_text_content_type);
    return typeof text === "string" ? text.trim() : "";
}

/**
 * @param {Object} design - A design document (`designs.design`).
 * @param {Object} [options]
 * @param {string} [options.serviceId] - The service the phases must enable.
 * @returns {Array<{id: string, phaseNumber: number, questionNumber: number,
 *     text: string, textHash: string}>} The selected questions, in design
 *     order. Empty for ranking designs and designs without such phases.
 */
export function selectTutorQuestions(
    design,
    { serviceId = ARGUMENTATION_TUTOR_SERVICE_ID } = {}
) {
    if (design?.type !== "semantic_differential" || !Array.isArray(design.phases)) {
        return [];
    }

    const selected = [];
    design.phases.forEach((phase, phaseIndex) => {
        if (!phaseExternalServices(phase).enabledServiceIds.includes(serviceId)) {
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
                id:       tutorQuestionId(phaseNumber, questionNumber),
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
 * One tutor question of a design, by its runtime position (#850): the phase's
 * `stages.number` and the question's `differential.orden`.
 *
 * @returns {{id: string, phaseNumber: number, questionNumber: number,
 *     text: string, textHash: string}|null} As selectTutorQuestions() returns
 *     it, or null when the position holds no tutor question.
 */
export function findTutorQuestion(design, { phaseNumber, questionNumber } = {}) {
    const id = tutorQuestionId(phaseNumber, questionNumber);
    return selectTutorQuestions(design).find(question => question.id === id) ?? null;
}
