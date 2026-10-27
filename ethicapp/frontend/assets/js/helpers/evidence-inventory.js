// Pure helpers for the evidence inventory tab (#652): the review panel of the
// `case-analyst-evidence-inventory` analysis, whose document follows
// evidence-inventory/v1 (facts EV# with literal quotes, exclusions EX#).

import { isCaseAnalysisInFlight } from "./case-analyses.js";

const SAVE_ERROR_KEYS = Object.freeze({
    400: "case_evidence_inventory_error_invalid",
    405: "case_evidence_inventory_error_not_editable",
    409: "case_evidence_inventory_error_processing",
});

function itemsOf(value) {
    return Array.isArray(value) ? value : [];
}

/**
 * The facts grouped by theme, keeping the order in which themes first appear.
 */
export function groupFacts(facts) {
    const groups = [];
    const groupsByName = new Map();

    for (const fact of itemsOf(facts)) {
        const name = fact?.group || "";
        if (!groupsByName.has(name)) {
            const group = { name, facts: [] };
            groupsByName.set(name, group);
            groups.push(group);
        }
        groupsByName.get(name).facts.push(fact);
    }

    return groups;
}

// The facts whose quote the server did not find literally in the case text.
export function countQuotesNotFound(facts) {
    return itemsOf(facts)
        .filter(fact => fact?.sourceQuote && fact.sourceQuoteFound !== true)
        .length;
}

/**
 * An editable copy of an inventory document that shares nothing with it.
 * Documents without lists get empty ones.
 */
export function createEditableInventory(document) {
    const copy = document && typeof document === "object"
        ? JSON.parse(JSON.stringify(document))
        : {};
    return { ...copy, facts: itemsOf(copy.facts), exclusions: itemsOf(copy.exclusions) };
}

// A new fact keeps the theme of the previous one, which is usually the
// theme the teacher is completing.
export function createEmptyFact(previousFact = null) {
    return {
        id:           "",
        group:        previousFact?.group || "",
        label:        "",
        statement:    "",
        sourceQuote:  "",
        countingNote: "",
    };
}

export function createEmptyExclusion() {
    return {
        id:        "",
        label:     "",
        statement: "",
        reason:    "",
    };
}

// Saving an edit records `reviewedAt`; a new generation clears it.
export function isEvidenceInventoryReviewed(analysis) {
    return Boolean(analysis?.reviewedAt);
}

// Edits are refused while a fresh generation is in flight (409).
export function canEditEvidenceInventory(analysis) {
    return Boolean(analysis?.document) && !isCaseAnalysisInFlight(analysis);
}

/**
 * What to tell the teacher when a save fails: a translation key and, for an
 * invalid document (400), the server's list of problems.
 */
export function evidenceInventorySaveError(error) {
    const status = Number(error?.status);
    const details = status === 400 && Array.isArray(error?.data?.details)
        ? error.data.details.filter(detail => typeof detail === "string")
        : [];

    return {
        messageKey: SAVE_ERROR_KEYS[status] || "case_evidence_inventory_error_generic",
        details,
    };
}
