import { hashAnalysisInput } from "./analysis-input-hash.js";
import { getCaseAnalysis } from "./case-analyses-helper.js";
import { getDesignAnalysis } from "./design-analyses-helper.js";

/**
 * The claim typology of one tutor question, as the Argumentation Tutor
 * receives it (#850, epic #846).
 *
 * A design's claim typology is its `case-analyst-claim-typology` analysis
 * (#849): a claim-typology/v1 document with one typology per selected
 * question, keyed by positional id (`p<phase>-q<question>`, see
 * design-analysis-units.js) and annotated with `questionTextHash`, the hash
 * of the question text it answers. When the tutor opens a session for a
 * question, the question's typology is passed as `claim_typology`
 * (tutor-claim-typology/v1, ethicapp-ai-additions#204) only when it answers
 * the current question text. The facts its types cite come from the case's
 * evidence inventory (#652).
 */

export const CLAIM_TYPOLOGY_SERVICE_ID = "case-analyst-claim-typology";
export const CLAIM_TYPOLOGY_SCHEMA = "claim-typology/v1";

export const EVIDENCE_INVENTORY_SERVICE_ID = "case-analyst-evidence-inventory";
export const EVIDENCE_INVENTORY_SCHEMA = "evidence-inventory/v1";

export const TUTOR_CLAIM_TYPOLOGY_SCHEMA = "tutor-claim-typology/v1";
// Limits and formats of tutor-claim-typology/v1.
export const MAX_TUTOR_CLAIM_TYPES = 8;
export const MAX_TUTOR_RELATED_FACTS = 60;
const CLAIM_TYPE_ID = /^AF[1-9][0-9]*$/u;
const FACT_ID = /^EV[1-9][0-9]*$/u;
const STANCES = new Set(["in_favor", "against", "alternative", "conditional"]);

// Why a question gets no typology. A missing typology is not an error: the
// tutor works without one.
export const TYPOLOGY_ABSENT_REASONS = Object.freeze({
    NO_QUESTION: "no-question",
    NO_ANALYSIS: "no-analysis",
    NO_TYPOLOGY: "no-typology",
    OUT_OF_DATE: "out-of-date",
    INVALID:     "invalid",
    LOAD_FAILED: "load-failed",
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
 * @param {{id: string, textHash: string}} question - From findTutorQuestion()
 *     (ats-feedback.adapter.js).
 * @returns {{typology: Object|null, reason: string|null}}
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

// The inventory's statements by fact id.
function factStatements(inventoryDocument) {
    const statements = new Map();
    if (!isEvidenceInventory(inventoryDocument)) {
        return statements;
    }

    for (const fact of inventoryDocument.facts) {
        const id = nonEmptyText(fact?.id);
        const statement = nonEmptyText(fact?.statement);
        if (FACT_ID.test(id ?? "") && statement && !statements.has(id)) {
            statements.set(id, statement);
        }
    }
    return statements;
}

/**
 * Maps a claim-typology/v1 typology to the tutor's tutor-claim-typology/v1
 * (ethicapp-ai-additions#204), whose schema accepts no other key:
 * `focalAction`, at most MAX_TUTOR_CLAIM_TYPES `types[{id, label,
 * description, stance, exampleStatement?, relatedEvidenceIds?}]` with unique
 * ids, and `relatedFacts[{id, statement}]` with the inventory facts those
 * types cite, when there are any. The typology's `questionId`, `phaseId` and
 * `questionTextHash` are not sent. Cited facts the inventory no longer has are
 * left out, from `relatedFacts` and from the types.
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

    const statements = factStatements(inventoryDocument);
    const citedFacts = new Set();
    const types = sources.map(({ claimType, cited }) => {
        const ids = [...new Set(Array.isArray(cited) ? cited : [])]
            .filter(id => statements.has(id));
        ids.forEach(id => citedFacts.add(id));
        return ids.length > 0 ? { ...claimType, relatedEvidenceIds: ids } : claimType;
    });

    const claimTypology = {
        schemaVersion: TUTOR_CLAIM_TYPOLOGY_SCHEMA,
        focalAction,
        types,
    };

    // In order of first citation. An inventory has at most 60 facts, as many
    // as tutor-claim-typology/v1 accepts.
    const relatedFacts = [...citedFacts]
        .slice(0, MAX_TUTOR_RELATED_FACTS)
        .map(id => ({ id, statement: statements.get(id) }));
    if (relatedFacts.length > 0) {
        claimTypology.relatedFacts = relatedFacts;
    }
    return claimTypology;
}

/**
 * The tutor typology of one question of a design: the design's claim typology
 * analysis, when its typology for the question answers the current text,
 * mapped with the facts of the case's evidence inventory. A design with a
 * generation in flight keeps its previous document, which is used while it
 * still answers the question.
 *
 * @param {Object} args
 * @param {number|null} args.designId
 * @param {number|null} args.caseId - The design's case, for the inventory.
 * @param {Object|null} args.question - From findTutorQuestion()
 *     (ats-feedback.adapter.js).
 * @param {Object} [dependencies] - Overrides for tests.
 * @returns {Promise<{claimTypology: Object|null, reason: string|null}>}
 */
export async function loadTutorClaimTypology(
    { designId, caseId, question },
    { getAnalysis = getDesignAnalysis, getCaseAnalysisRow = getCaseAnalysis } = {}
) {
    if (!question?.id || !toPositiveInteger(designId)) {
        return { claimTypology: null, reason: TYPOLOGY_ABSENT_REASONS.NO_QUESTION };
    }

    const row = await getAnalysis({
        designId:  toPositiveInteger(designId),
        serviceId: CLAIM_TYPOLOGY_SERVICE_ID,
    });
    const { typology, reason } = findQuestionTypology(row?.document ?? null, question);
    if (!typology) {
        return { claimTypology: null, reason };
    }

    const cites = typology.types?.some?.(type => Array.isArray(type?.relatedEvidenceIds)
        && type.relatedEvidenceIds.length > 0);
    const inventory = cites
        ? await loadEvidenceInventory(caseId, { getAnalysis: getCaseAnalysisRow })
        : null;

    const claimTypology = toTutorClaimTypology(typology, inventory?.document ?? null);
    return claimTypology
        ? { claimTypology, reason: null }
        : { claimTypology: null, reason: TYPOLOGY_ABSENT_REASONS.INVALID };
}
