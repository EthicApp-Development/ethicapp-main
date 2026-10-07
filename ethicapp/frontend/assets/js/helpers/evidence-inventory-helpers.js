/**
 * Pure helpers for the teacher evidence inventory view.
 */

const STATUS_LABEL_CLASSES = {
    none:       "label label-default",
    processing: "label label-info",
    draft:      "label label-warning",
    reviewed:   "label label-success",
    failed:     "label label-danger",
};

const PROCESSING_DOCUMENT_STATUSES = ["pending", "processing"];

// After the case document is rendered, the generation starts a few seconds
// later. Keep polling a short while so the "processing" state shows up.
export const MAX_IDLE_POLLS_AFTER_DOCUMENT_READY = 6;

export function getStatusLabelClass(status) {
    return STATUS_LABEL_CLASSES[status] || STATUS_LABEL_CLASSES.none;
}

/**
 * Whether the case PDF is being rendered (new or replaced document).
 */
export function isDocumentProcessing(state) {
    return PROCESSING_DOCUMENT_STATUSES.includes(state?.documentStatus);
}

/**
 * Whether the case has no rendered text: the render failed or never ran.
 */
export function isDocumentUnavailable(state) {
    return Boolean(state) && !isDocumentProcessing(state) && state.documentStatus !== "completed";
}

/**
 * Groups facts by theme, keeping the order in which themes first appear.
 */
export function groupFacts(facts) {
    const groups = [];
    const groupsByName = new Map();

    for (const fact of Array.isArray(facts) ? facts : []) {
        const name = fact.group || "";
        if (!groupsByName.has(name)) {
            const group = { name, facts: [] };
            groupsByName.set(name, group);
            groups.push(group);
        }
        groupsByName.get(name).facts.push(fact);
    }

    return groups;
}

/**
 * Returns an editable copy of an inventory, or an empty one to create it by hand.
 */
export function createEditableInventory(inventory) {
    if (!inventory) {
        return { facts: [], exclusions: [] };
    }

    return JSON.parse(JSON.stringify(inventory));
}

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

/**
 * Whether the view should keep refreshing the inventory state.
 *
 * @param {Object|null} state - GET /cases/:id/evidence-inventory result.
 * @param {Object} [options]
 * @param {number} [options.idlePolls] - Refreshes since the document became ready.
 * @param {boolean} [options.awaitingGeneration] - A document render was seen in
 *   this view and the generation it triggers has not started yet.
 */
export function shouldPollInventory(state, { idlePolls = 0, awaitingGeneration = false } = {}) {
    if (!state) {
        return false;
    }
    if (state.status === "processing") {
        return !state.stale;
    }
    if (!state.serviceEnabled) {
        return false;
    }
    if (isDocumentProcessing(state)) {
        return true;
    }

    const generationMayStart = state.status === "none" || awaitingGeneration;
    return state.documentStatus === "completed"
        && generationMayStart
        && idlePolls < MAX_IDLE_POLLS_AFTER_DOCUMENT_READY;
}
