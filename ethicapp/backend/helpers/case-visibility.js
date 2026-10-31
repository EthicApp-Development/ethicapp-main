/**
 * What a case's visibility means for the designs that use it (#934, epic #923).
 *
 * The case read rules let anyone read a case that a public design points at
 * (`getReadableCaseWithDocumentProcessing` in controllers/cases.js,
 * controllers/protected-uploads.js), together with its PDF and rendered pages.
 * A public design also needs a public case to be published
 * (`CASE_VISIBILITY_REQUIRED` in controllers/designs.js). So a private case
 * must have no public design: when a case is private, the public designs that
 * use it, whoever created them, become private as well.
 *
 * Both endpoints that can make a case private, the case form
 * (`PATCH /cases/:id`) and the visibility switch (`PATCH /cases/:id/visibility`),
 * call `applyCaseVisibilityToDesigns` inside the transaction that writes the
 * case's visibility, so the case and its designs change together or not at all.
 */
import { PRIVATE_VISIBILITY, normalizeVisibility } from "./sharing-policy-helper.js";

// $1 case id. Returns the ids of the designs it turned private.
export const PRIVATIZE_CASE_DESIGNS_SQL = `
    UPDATE designs
    SET visibility = 'private',
        public = false
    WHERE case_id = $1
      AND visibility = 'public'
    RETURNING id;
`;

/**
 * Applies a case's visibility to the designs that use it: when the case is
 * private, its public designs become private. A public case changes nothing.
 *
 * Running it on a case that was already private is harmless, and repairs a
 * public design that still points at it.
 *
 * @param {{query: Function}} client - A pg client inside the caller's
 *     transaction.
 * @param {number} caseId
 * @param {string} visibility - The case's visibility after the write.
 * @returns {Promise<number[]>} The ids of the designs that became private.
 */
export async function applyCaseVisibilityToDesigns(client, caseId, visibility) {
    if (normalizeVisibility(visibility) !== PRIVATE_VISIBILITY) {
        return [];
    }

    const result = await client.query(PRIVATIZE_CASE_DESIGNS_SQL, [caseId]);
    return result.rows.map(row => row.id);
}
