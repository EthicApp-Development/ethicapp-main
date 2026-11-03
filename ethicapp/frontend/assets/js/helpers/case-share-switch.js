// The share switch of a case (#939, #1013): it asks the author to confirm a
// publication, then saves the new visibility (`PATCH /cases/:id/visibility`).
// The switch shows the new visibility while the save runs, and the previous
// one when the author cancels or the save fails. Used by the rows of the Cases
// page; a case in use keeps its sharing editable (#1014).

import { confirmCasePublication } from "./case-publication.js";

export const SHARE_SWITCH_CANCELLED = "cancelled";
export const SHARE_SWITCH_SAVED = "saved";
export const SHARE_SWITCH_FAILED = "failed";

const PUBLIC_VISIBILITY = "public";
const PRIVATE_VISIBILITY = "private";

function showVisibility(caseItem, visibility) {
    caseItem.visibility = visibility;
    caseItem.public = visibility === PUBLIC_VISIBILITY;
}

/**
 * Turns the case's sharing over.
 * @param {object} caseItem - A case of GET /cases; its `visibility` and
 *   `public` follow the switch.
 * @param {{
 *   confirm: () => Promise<boolean>,
 *   updateVisibility: (caseId: number, visibility: string) => Promise<object>,
 * }} services - The publication dialog, and the save.
 * @returns {Promise<{ outcome: string, previousVisibility: string,
 *   result?: object, error?: unknown }>} `result` is the save's answer, which
 *   tells the designs made private and those keeping the case.
 */
export async function toggleCaseShareSwitch(caseItem, { confirm, updateVisibility }) {
    const previousVisibility = caseItem.visibility || PRIVATE_VISIBILITY;
    const nextVisibility = previousVisibility === PUBLIC_VISIBILITY
        ? PRIVATE_VISIBILITY
        : PUBLIC_VISIBILITY;

    if (!(await confirmCasePublication(previousVisibility, nextVisibility, confirm))) {
        showVisibility(caseItem, previousVisibility);
        return { outcome: SHARE_SWITCH_CANCELLED, previousVisibility };
    }

    showVisibility(caseItem, nextVisibility);
    try {
        const result = await updateVisibility(caseItem.id, nextVisibility);
        caseItem.visibility = result.visibility;
        caseItem.public = result.public;
        return { outcome: SHARE_SWITCH_SAVED, previousVisibility, result };
    } catch (error) {
        showVisibility(caseItem, previousVisibility);
        return { outcome: SHARE_SWITCH_FAILED, previousVisibility, error };
    }
}
