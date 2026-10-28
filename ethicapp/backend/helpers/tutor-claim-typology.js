import { hashAnalysisInput } from "./analysis-input-hash.js";
import { getCaseAnalysis } from "./case-analyses-helper.js";

/**
 * The claim typology of one tutor question, as the Argumentation Tutor
 * receives it (#850, epic #846; inside `case_context` since #865).
 *
 * A design's claim typology is its `case-analyst-claim-typology` analysis
 * (#849): a claim-typology/v1 document with one typology per selected
 * question, keyed by positional id (`p<phase>-q<question>`, see
 * design-analysis-units.js) and annotated with `questionTextHash`, the hash
 * of the question text it answers. A question's typology is usable only when
 * it answers the current question text (findQuestionTypology()); it is then
 * mapped to the tutor's tutor-claim-typology/v1 (toTutorClaimTypology()).
 * Whether a tutor session gets it is decided in tutor-mode.js.
 */

export const CLAIM_TYPOLOGY_SERVICE_ID = "case-analyst-claim-typology";
export const CLAIM_TYPOLOGY_SCHEMA = "claim-typology/v1";

export const EVIDENCE_INVENTORY_SERVICE_ID = "case-analyst-evidence-inventory";
export const EVIDENCE_INVENTORY_SCHEMA = "evidence-inventory/v1";

export const TUTOR_CLAIM_TYPOLOGY_SCHEMA = "tutor-claim-typology/v1";
// Limits and formats of tutor-claim-typology/v1.
export const MAX_TUTOR_CLAIM_TYPES = 8;
const CLAIM_TYPE_ID = /^AF[1-9][0-9]*$/u;
const FACT_ID = /^EV[1-9][0-9]*$/u;
const STANCES = new Set(["in_favor", "against", "alternative", "conditional"]);

// Why a document holds no usable typology for a question
// (findQuestionTypology()).
export const TYPOLOGY_ABSENT_REASONS = Object.freeze({
    NO_ANALYSIS: "no-analysis",
    NO_TYPOLOGY: "no-typology",
    OUT_OF_DATE: "out-of-date",
});

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toPositiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
}

function nonEmptyText(value) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function isEvidenceInventory(document) {
    return isPlainObject(document)
        && document.schemaVersion === EVIDENCE_INVENTORY_SCHEMA
        && Array.isArray(document.facts);
}

/**
 * The case's evidence inventory, when it has one: the stored document of its
 * `case-analyst-evidence-inventory` analysis. A generation in flight keeps
 * the previous document, which is still the case's inventory, so any stored
 * inventory is used. `hash` identifies its content: a regenerated or edited
 * inventory changes the typology's input hash.
 *
 * @returns {Promise<{document: Object, hash: string}|null>}
 */
export async function loadEvidenceInventory(caseId, { getAnalysis = getCaseAnalysis } = {}) {
    if (!toPositiveInteger(caseId)) {
        return null;
    }

    const row = await getAnalysis({ caseId, serviceId: EVIDENCE_INVENTORY_SERVICE_ID });
    const document = row?.document ?? null;
    if (!isEvidenceInventory(document)) {
        return null;
    }

    return { document, hash: hashAnalysisInput(document) };
}

/**
 * The typology of one question in a claim-typology/v1 document, when it
 * answers the given question text.
 *
 * @param {Object|null} document - The stored claim-typology/v1 document.
 * @param {{id: string, textHash: string}} question - A question unit
 *     (design-analysis-units.js).
 * @returns {{typology: Object|null, reason: string|null}} `reason` is one of
 *     TYPOLOGY_ABSENT_REASONS when there is no usable typology.
 */
export function findQuestionTypology(document, question) {
    if (!isPlainObject(document)
        || document.schemaVersion !== CLAIM_TYPOLOGY_SCHEMA
        || !Array.isArray(document.typologies)) {
        return { typology: null, reason: TYPOLOGY_ABSENT_REASONS.NO_ANALYSIS };
    }

    const typology = document.typologies.find(
        candidate => isPlainObject(candidate) && candidate.questionId === question?.id
    );
    if (!typology) {
        return { typology: null, reason: TYPOLOGY_ABSENT_REASONS.NO_TYPOLOGY };
    }

    // A typology without the hash of its question cannot be shown to answer
    // the current text, so it is treated as out of date.
    if (!question?.textHash || typology.questionTextHash !== question.textHash) {
        return { typology: null, reason: TYPOLOGY_ABSENT_REASONS.OUT_OF_DATE };
    }

    return { typology, reason: null };
}

// The claim type as tutor-claim-typology/v1 accepts it, without the cited
// facts, or null when it is not usable. The schema rejects any other key.
function tutorClaimType(type) {
    if (!isPlainObject(type)) {
        return null;
    }

    const id = nonEmptyText(type.id);
    const label = nonEmptyText(type.label);
    const description = nonEmptyText(type.description);
    const stance = nonEmptyText(type.stance);
    if (!CLAIM_TYPE_ID.test(id ?? "") || !label || !description || !STANCES.has(stance)) {
        return null;
    }

    const claimType = { id, label, description, stance };
    const exampleStatement = nonEmptyText(type.exampleStatement);
    if (exampleStatement) {
        claimType.exampleStatement = exampleStatement;
    }
    return claimType;
}

// The ids of the inventory's facts.
function inventoryFactIds(inventoryDocument) {
    if (!isEvidenceInventory(inventoryDocument)) {
        return new Set();
    }

    return new Set(inventoryDocument.facts
        .map(fact => nonEmptyText(fact?.id))
        .filter(id => FACT_ID.test(id ?? "")));
}

/**
 * Maps a claim-typology/v1 typology to the tutor's tutor-claim-typology/v1
 * (ethicapp-ai-additions#204), whose schema accepts no other key:
 * `focalAction` and at most MAX_TUTOR_CLAIM_TYPES `types[{id, label,
 * description, stance, exampleStatement?, relatedEvidenceIds?}]` with unique
 * ids. The typology's `questionId`, `phaseId` and `questionTextHash` are not
 * sent. Nor is `relatedFacts`: inside `case_context` the tutor reads every
 * fact from the evidence inventory (ethicapp-ai-additions#209). Cited facts
 * the inventory does not have are left out of the types.
 *
 * @returns {Object|null} null when the typology has no focal action or no
 *     usable claim type.
 */
export function toTutorClaimTypology(typology, inventoryDocument = null) {
    const focalAction = nonEmptyText(typology?.focalAction);
    const seenIds = new Set();
    const sources = [];
    for (const source of Array.isArray(typology?.types) ? typology.types : []) {
        const claimType = tutorClaimType(source);
        if (claimType && !seenIds.has(claimType.id) && sources.length < MAX_TUTOR_CLAIM_TYPES) {
            seenIds.add(claimType.id);
            sources.push({ claimType, cited: source.relatedEvidenceIds });
        }
    }
    if (!focalAction || sources.length === 0) {
        return null;
    }

    const factIds = inventoryFactIds(inventoryDocument);
    const types = sources.map(({ claimType, cited }) => {
        const ids = [...new Set(Array.isArray(cited) ? cited : [])]
            .filter(id => factIds.has(id));
        return ids.length > 0 ? { ...claimType, relatedEvidenceIds: ids } : claimType;
    });

    return {
        schemaVersion: TUTOR_CLAIM_TYPOLOGY_SCHEMA,
        focalAction,
        types,
    };
}
