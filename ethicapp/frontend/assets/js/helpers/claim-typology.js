// Pure helpers for the claim typology in the teacher's design view (#849,
// epic #846). The typology is the design analysis of `case-analyst-claim-typology`:
// a claim-typology/v1 document with one typology per tutor question, stored by
// the backend adapter with each question's text hash (`questionTextHash`).
// The view shows it read-only, question by question, inside each phase.

import { TEXT_MARKDOWN } from "../../../../common/modules/text-content-types.js";
import { toPlainText } from "./rich-text.js";
import {
    caseAnalysisErrorKey,
    caseAnalysisState,
    isCaseAnalysisInFlight,
} from "./case-analyses.js";

export const CLAIM_TYPOLOGY_SERVICE_ID = "case-analyst-claim-typology";
export const CLAIM_TYPOLOGY_SCHEMA = "claim-typology/v1";
export const ARGUMENTATION_TUTOR_SERVICE_ID = "argumentation-tutor-system";
export const EVIDENCE_INVENTORY_SERVICE_ID = "case-analyst-evidence-inventory";

// How often the design view reads the analysis while a generation is in flight.
export const CLAIM_TYPOLOGY_POLL_INTERVAL_MS = 5000;

const STANCES = Object.freeze({
    in_favor:    { key: "claim_typology_stance_in_favor", labelClass: "label-success" },
    against:     { key: "claim_typology_stance_against", labelClass: "label-danger" },
    alternative: { key: "claim_typology_stance_alternative", labelClass: "label-info" },
    conditional: { key: "claim_typology_stance_conditional", labelClass: "label-warning" },
});

const UNKNOWN_STANCE = Object.freeze({
    key:        "claim_typology_stance_unknown",
    labelClass: "label-default",
});

// The answers of POST .../generate, as DesignAnalysesService reports them.
const GENERATE_NOTICES = Object.freeze({
    "busy":           { type: "warning", key: "case_analysis_generate_busy" },
    "disabled":       { type: "warning", key: "claim_typology_generate_disabled" },
    "locked":         { type: "warning", key: "claim_typology_locked_note" },
    "not-applicable": { type: "warning", key: "claim_typology_generate_not_applicable" },
    "changed":        { type: "warning", key: "claim_typology_generate_changed" },
    "error":          { type: "danger", key: "case_analysis_generate_failed" },
});

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

// The question as the tutor receives it, as the backend computes it
// (design-analysis-units.js): text/markdown becomes plain text, then trimmed.
function questionText(question) {
    const value = question?.q_text;
    const text = question?.q_text_content_type === TEXT_MARKDOWN && typeof value === "string"
        ? toPlainText(value, TEXT_MARKDOWN)
        : value;
    return typeof text === "string" ? text.trim() : "";
}

function enablesService(phase, serviceId) {
    const enabled = phase?.externalServices?.enabledServiceIds;
    return Array.isArray(enabled) && enabled.some(id => String(id).trim() === serviceId);
}

/**
 * The tutor questions the typology covers, selected as the backend selects
 * the question units of the tutor's phases
 * (ethicapp/backend/helpers/design-analysis-units.js): the non-empty
 * semantic differential questions of the phases that enable the tutor, with
 * positional 1-based ids `p<phase>-q<question>`. The tutor is the one
 * consumer of claim typologies in the shipped catalog (#863).
 *
 * @returns {Array<{id: string, phaseNumber: number, questionNumber: number, text: string}>}
 */
export function selectTutorQuestions(design) {
    if (design?.type !== "semantic_differential" || !Array.isArray(design.phases)) {
        return [];
    }

    const selected = [];
    design.phases.forEach((phase, phaseIndex) => {
        if (!enablesService(phase, ARGUMENTATION_TUTOR_SERVICE_ID)) {
            return;
        }

        const questions = Array.isArray(phase?.questions) ? phase.questions : [];
        questions.forEach((question, questionIndex) => {
            const text = questionText(question);
            if (text) {
                const phaseNumber = phaseIndex + 1;
                const questionNumber = questionIndex + 1;
                const id = `p${phaseNumber}-q${questionNumber}`;
                selected.push({ id, phaseNumber, questionNumber, text });
            }
        });
    });

    return selected;
}

/**
 * The SHA-256 of a text, as `sha256:<hex>` (the backend's sha256Text()), or
 * null when Web Crypto is not available (an insecure context).
 */
export async function sha256Text(text, subtle = globalThis.crypto?.subtle) {
    if (!subtle) {
        return null;
    }

    const digest = await subtle.digest("SHA-256", new TextEncoder().encode(String(text)));
    const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0"))
        .join("");
    return `sha256:${hex}`;
}

/** The text hash of each question, by id. */
export async function questionTextHashes(questions, hash = sha256Text) {
    const entries = await Promise.all(
        questions.map(async question => [question.id, await hash(question.text)])
    );
    return Object.fromEntries(entries);
}

export function claimTypologyStance(stance) {
    return Object.hasOwn(STANCES, stance) ? STANCES[stance] : UNKNOWN_STANCE;
}

// The facts of an evidence-inventory/v1 document, by id.
export function evidenceFactsById(inventory) {
    const facts = Array.isArray(inventory?.facts) ? inventory.facts : [];
    return Object.fromEntries(facts
        .filter(fact => isPlainObject(fact) && typeof fact.id === "string")
        .map(fact => [fact.id, { label: fact.label ?? null, statement: fact.statement ?? null }]));
}

// Whether any claim type of the document cites the evidence inventory.
export function citesEvidence(document) {
    const typologies = Array.isArray(document?.typologies) ? document.typologies : [];
    return typologies.some(typology => (Array.isArray(typology?.types) ? typology.types : [])
        .some(type => Array.isArray(type?.relatedEvidenceIds)
            && type.relatedEvidenceIds.length > 0));
}

function evidenceView(ids, facts) {
    return (Array.isArray(ids) ? ids : [])
        .map(id => ({ id, statement: facts[id]?.statement ?? null }));
}

function typologyView(typology, facts) {
    const types = Array.isArray(typology?.types) ? typology.types : [];

    return {
        focalAction: typology?.focalAction ?? "",
        types:       types.filter(isPlainObject).map(type => ({
            id:               type.id ?? "",
            label:            type.label ?? "",
            description:      type.description ?? "",
            exampleStatement: type.exampleStatement ?? null,
            stance:           claimTypologyStance(type.stance),
            evidence:         evidenceView(type.relatedEvidenceIds, facts),
        })),
    };
}

/**
 * What the design view shows for each tutor question: its typology, if the
 * stored document has one, and whether it is out of date (the typology
 * recorded the hash of another question text). A typology without a recorded
 * hash, or a question whose hash cannot be computed, is never reported out of
 * date.
 *
 * @param {Object} args
 * @param {Array} args.questions - From selectTutorQuestions().
 * @param {Object} [args.hashes] - From questionTextHashes().
 * @param {Object|null} [args.document] - The stored claim-typology/v1 document.
 * @param {Object} [args.facts] - From evidenceFactsById().
 */
export function claimTypologyQuestions({ questions, hashes = {}, document = null, facts = {} }) {
    const typologies = Array.isArray(document?.typologies) ? document.typologies : [];
    const byId = new Map(typologies
        .filter(typology => isPlainObject(typology) && typeof typology.questionId === "string")
        .map(typology => [typology.questionId, typology]));

    return questions.map((question) => {
        const typology = byId.get(question.id) ?? null;
        const recordedHash = typology?.questionTextHash ?? null;
        const currentHash = hashes[question.id] ?? null;
        const changed = Boolean(recordedHash && currentHash && recordedHash !== currentHash);

        return {
            ...question,
            typology:  typology ? typologyView(typology, facts) : null,
            outOfDate: Boolean(typology) && changed,
        };
    });
}

/**
 * The view the design viewer receives: the questions grouped by phase number,
 * the analysis state ("none" when there is no analysis yet) and counts for
 * the summary.
 */
export function claimTypologyView({ analysis, questions }) {
    const missing = questions.filter(question => !question.typology);
    const byPhase = {};
    for (const question of questions) {
        (byPhase[question.phaseNumber] ??= []).push(question);
    }

    return {
        state:          analysis ? caseAnalysisState(analysis) : "none",
        inFlight:       isCaseAnalysisInFlight(analysis),
        byPhase,
        outOfDateCount: questions.filter(question => question.outOfDate).length,
        missingCount:   analysis?.document ? missing.length : 0,
    };
}

// The translation key that explains an error code of the typology.
// Analyses of cases and designs share the adapters' error codes, so the
// mapping lives in one place (ERROR_KEYS in case-analyses.js).
export function claimTypologyErrorKey(errorCode) {
    return caseAnalysisErrorKey(errorCode);
}

// The notice for an answer of the generate endpoint other than "accepted".
export function claimTypologyGenerateNotice(outcome) {
    return GENERATE_NOTICES[outcome] ?? GENERATE_NOTICES.error;
}

/**
 * Whether the teacher can ask for a new generation: the design is theirs and
 * not locked, it has tutor questions, and no fresh generation is in flight.
 */
export function canGenerateClaimTypology({ design, analysis, questions }) {
    return design?.userOwned === true
        && design.locked !== true
        && Boolean(design.caseId)
        && questions.length > 0
        && !isCaseAnalysisInFlight(analysis);
}
