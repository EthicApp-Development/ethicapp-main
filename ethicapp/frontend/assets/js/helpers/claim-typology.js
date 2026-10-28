// Pure helpers for the claim typology in the teacher's design view (#849,
// epic #846). The typology is the design analysis of `case-analyst-claim-typology`:
// a claim-typology/v1 document with one typology per tutor question, stored by
// the backend adapter with each question's text hash (`questionTextHash`).
// The view shows it read-only, question by question, inside each phase.
//
// The backend is the single source of truth for the questions (#865): the
// analysis read (`GET /designs/:id/analyses/:serviceId`) returns the units
// the typology currently covers, with their text hashes, why there are none,
// and each tutor question's expected mode. These helpers only cross-reference
// them with the stored document.

import {
    caseAnalysisErrorKey,
    caseAnalysisState,
    isCaseAnalysisInFlight,
} from "./case-analyses.js";
import { claimTypologyUnitsReasonKey, tutorModeNote, tutorPhaseNotes } from "./tutor-modes.js";

export const CLAIM_TYPOLOGY_SERVICE_ID = "case-analyst-claim-typology";
export const CLAIM_TYPOLOGY_SCHEMA = "claim-typology/v1";
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
 * What the design view shows for each question the typology covers: its
 * typology, if the stored document has one, whether it is out of date (it
 * recorded the hash of another question text, or none), and the note on the
 * tutor's expected mode.
 *
 * @param {Object} args
 * @param {Array} args.units - The backend's units: `{ id, phaseNumber,
 *     questionNumber, text, textHash }`.
 * @param {Object|null} [args.document] - The stored claim-typology/v1 document.
 * @param {Object} [args.facts] - From evidenceFactsById().
 * @param {Object} [args.tutorModes] - The backend's `{ [unit id]: { mode, reason } }`.
 */
export function claimTypologyQuestions({ units, document = null, facts = {}, tutorModes = {} }) {
    const typologies = Array.isArray(document?.typologies) ? document.typologies : [];
    const byId = new Map(typologies
        .filter(typology => isPlainObject(typology) && typeof typology.questionId === "string")
        .map(typology => [typology.questionId, typology]));

    return (Array.isArray(units) ? units : []).map((unit) => {
        const typology = byId.get(unit.id) ?? null;

        return {
            id:             unit.id,
            phaseNumber:    unit.phaseNumber,
            questionNumber: unit.questionNumber,
            text:           unit.text,
            typology:       typology ? typologyView(typology, facts) : null,
            outOfDate:      Boolean(typology) && typology.questionTextHash !== unit.textHash,
            tutorMode:      tutorModeNote(tutorModes?.[unit.id]),
        };
    });
}

/**
 * The view the design viewer receives: the questions grouped by phase number,
 * the analysis state ("none" when there is no analysis yet), counts for the
 * summary, why no question is covered (`unitsReasonKey`, a translation key,
 * or null), and the note of each tutor phase whose configuration chose the
 * basic mode (`phaseNotes`, by phase number, from the backend's
 * `tutorPhases`, #870). The questions of such a phase are not units, so they
 * are not listed as awaiting a typology.
 */
export function claimTypologyView({ analysis, questions, unitsReason = null, tutorPhases = [] }) {
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
        unitsReasonKey: questions.length === 0 ? claimTypologyUnitsReasonKey(unitsReason) : null,
        phaseNotes:     tutorPhaseNotes(tutorPhases),
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
 * not locked, the typology covers questions, its service is usable, and no
 * fresh generation is in flight.
 */
export function canGenerateClaimTypology({ design, analysis, units, producerUsable }) {
    return design?.userOwned === true
        && design.locked !== true
        && Boolean(design.caseId)
        && Array.isArray(units) && units.length > 0
        && producerUsable === true
        && !isCaseAnalysisInFlight(analysis);
}
