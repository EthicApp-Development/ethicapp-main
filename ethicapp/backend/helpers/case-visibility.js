/**
 * What a case's visibility means for the designs that use it (#934, #939,
 * epic #923).
 *
 * The case read rules let anyone read a case that a public design points at
 * (`getReadableCaseWithDocumentProcessing` in controllers/cases.js,
 * controllers/protected-uploads.js), together with its PDF and rendered pages.
 * A public design also needs a public case to be published
 * (`CASE_VISIBILITY_REQUIRED` in controllers/designs.js). So a private case
 * must have no public design: when a case is private, the public designs that
 * use it, whoever created them, become private as well.
 *
 * The same read rules also let in the creator of any design that uses the
 * case. A teacher who associated a public case with a design keeps reading it
 * after its author makes it private, so that design, and the activities
 * launched from it, keep working (epic #923, decision of 2026-10-31). Making a
 * case private only stops new uses, and the author is told how many designs
 * of other teachers keep it (#939).
 *
 * Both endpoints that can make a case private, the case form
 * (`PATCH /cases/:id`) and the visibility switch (`PATCH /cases/:id/visibility`),
 * call `applyCaseVisibility` inside the transaction that writes the case's
 * visibility, so the case and its designs change together or not at all.
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

// $1 case id, $2 the case's owner. Counts the designs of other teachers that
// use the case. A design without a creator gives no teacher access, so it is
// not counted.
export const COUNT_DESIGNS_KEEPING_ACCESS_SQL = `
    SELECT COUNT(*)::int AS count
    FROM designs
    WHERE case_id = $1
      AND creator <> $2;
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

/**
 * Counts the designs of other teachers that use the case. Their creators keep
 * reading the case, its PDF and its rendered pages whatever its visibility.
 * Only the number leaves this function: no design or teacher is identified.
 *
 * @param {{query: Function}} client - A pg client.
 * @param {number} caseId
 * @param {number} ownerId - The case's owner, whose own designs are left out.
 * @returns {Promise<number>}
 */
export async function countDesignsKeepingCaseAccess(client, caseId, ownerId) {
    const result = await client.query(COUNT_DESIGNS_KEEPING_ACCESS_SQL, [caseId, ownerId]);
    const count = Number(result.rows[0]?.count);
    return Number.isSafeInteger(count) && count > 0 ? count : 0;
}

/**
 * The step both case endpoints run after writing a case's visibility, inside
 * their transaction: the public designs of a private case become private,
 * then the designs of other teachers that keep the case are counted.
 *
 * @param {{query: Function}} client - A pg client inside the caller's
 *     transaction.
 * @param {{caseId: number, ownerId: number, visibility: string}} change -
 *     The case, its owner, and its visibility after the write.
 * @returns {Promise<{affectedDesignIds: number[], designsKeepingAccess: number}>}
 */
export async function applyCaseVisibility(client, { caseId, ownerId, visibility }) {
    const affectedDesignIds = await applyCaseVisibilityToDesigns(client, caseId, visibility);
    const designsKeepingAccess = await countDesignsKeepingCaseAccess(client, caseId, ownerId);
    return { affectedDesignIds, designsKeepingAccess };
}
