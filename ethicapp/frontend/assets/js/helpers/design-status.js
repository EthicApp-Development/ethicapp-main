// The status of a design in the designs table (#974, epic #966), and what the
// "Shared by others" tab needs to know about importing a design.
//
// Plain functions over the payloads of GET /designs and GET /activities, so
// the page's controller only wires them to the table. Designs are not told
// apart by type (epic #966, decision of 2026-11-01).
//
// A design's status is one of, in this order of precedence:
// - "in-use": activities use it, or it is locked. It cannot be edited or
//   deleted, whatever its errors, so the row offers "Duplicate to edit".
// - "errors": its stored `valid` flag is not true, the same rule the launch
//   wizard and the server's launch check use, so "With errors" here lists the
//   designs the wizard leaves out. The number comes from `validateDesign`, the
//   editor's validator, run on the client: no count is stored or returned by
//   the server.
// - "ready": it can be edited and launched.
// `shared` and `archived` are flags beside the status, not statuses: an
// archived design keeps its status in the Archived tab.

import { launchStatsByDesign } from "./launch-design-list.js";
import { validateDesign } from "./phase-validation-helpers.js";

export const DESIGN_STATUS_READY = "ready";
export const DESIGN_STATUS_ERRORS = "errors";
export const DESIGN_STATUS_IN_USE = "in-use";

export const IMPORT_STATE_IMPORTABLE = "importable";
export const IMPORT_STATE_IMPORTED = "imported";
export const IMPORT_STATE_NOT_IMPORTABLE = "not-importable";

function designIdOf(value) {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function lengthOf(value) {
    return Array.isArray(value) ? value.length : 0;
}

/**
 * How many errors the editor's validator finds in the design: one per message,
 * global or in a phase (an item's messages, grouping, instructions, other).
 */
export function countDesignErrors(design) {
    const { validationErrors } = validateDesign(design);
    let count = lengthOf(validationErrors?.global);
    for (const phaseErrors of Object.values(validationErrors?.phases || {})) {
        for (const itemMessages of Object.values(phaseErrors?.items || {})) {
            count += lengthOf(itemMessages);
        }
        count += lengthOf(phaseErrors?.groupingConfig);
        count += lengthOf(phaseErrors?.phaseInstructions);
        count += lengthOf(phaseErrors?.other);
    }
    return count;
}

/**
 * Design id → number of the teacher's activities that use it, from
 * GET /activities (`designId`, or `designid` for activities added since).
 * @returns {Map<number, number>}
 */
export function activityCountsByDesign(activities) {
    const counts = new Map();
    for (const [designId, { count }] of launchStatsByDesign(activities)) {
        counts.set(designId, count);
    }
    return counts;
}

/**
 * The status of a design and the flags beside it.
 *
 * @param {object} design - A design of GET /designs.
 * @param {Map<number, number>} [activityCounts] - From `activityCountsByDesign`.
 * @returns {{
 *   status: "ready"|"errors"|"in-use",
 *   errorCount: number,
 *   activityCount: number,
 *   shared: boolean,
 *   archived: boolean,
 *   own: boolean,
 * }} `errorCount` is the validator's count for a design with errors, and 0
 *   otherwise; it can also be 0 when the stored flag predates a change of the
 *   validator, so the page should then show "With errors" without a number.
 *   `activityCount` is 0 for a design that is locked without activities of
 *   this teacher.
 */
export function deriveDesignStatus(design, activityCounts = new Map()) {
    const activityCount = activityCounts.get(designIdOf(design?.id)) || 0;
    const inUse = activityCount > 0 || design?.locked === true;
    const hasErrors = design?.valid !== true;

    let status = DESIGN_STATUS_READY;
    if (inUse) {
        status = DESIGN_STATUS_IN_USE;
    } else if (hasErrors) {
        status = DESIGN_STATUS_ERRORS;
    }

    return {
        status,
        errorCount: status === DESIGN_STATUS_ERRORS ? countDesignErrors(design) : 0,
        activityCount,
        shared:     design?.visibility === "public" || design?.public === true,
        archived:   design?.archived === true,
        own:        design?.userOwned === true,
    };
}

function isPreferredCopy(candidate, current, sharedId) {
    if (!current) {
        return true;
    }
    // A direct import beats a copy of a copy; an active copy beats an archived
    // one; then the newest.
    const directCandidate = designIdOf(candidate.importedFromDesignId) === sharedId;
    const directCurrent = designIdOf(current.importedFromDesignId) === sharedId;
    if (directCandidate !== directCurrent) {
        return directCandidate;
    }
    const activeCandidate = candidate.archived !== true;
    const activeCurrent = current.archived !== true;
    if (activeCandidate !== activeCurrent) {
        return activeCandidate;
    }
    return (designIdOf(candidate.id) ?? 0) > (designIdOf(current.id) ?? 0);
}

/**
 * Shared design id → the teacher's own copy of it: an own design whose
 * `importedFromDesignId` or `originalDesignId` is that id. When there are
 * several, a direct import is preferred, then an active copy, then the newest.
 * A copy whose source was deleted has null links and matches nothing.
 * @returns {Map<number, object>}
 */
export function importedCopiesBySource(designs) {
    const copies = new Map();
    for (const design of Array.isArray(designs) ? designs : []) {
        if (design?.userOwned !== true) {
            continue;
        }
        const sources = new Set([
            designIdOf(design.importedFromDesignId),
            designIdOf(design.originalDesignId),
        ]);
        for (const sharedId of sources) {
            if (sharedId === null || sharedId === designIdOf(design.id)) {
                continue;
            }
            if (isPreferredCopy(design, copies.get(sharedId), sharedId)) {
                copies.set(sharedId, design);
            }
        }
    }
    return copies;
}

/**
 * The teacher's copy of a shared design, or null.
 * @param {object} sharedDesign
 * @param {Map<number, object>} copies - From `importedCopiesBySource`.
 */
export function findImportedCopy(sharedDesign, copies) {
    return copies?.get(designIdOf(sharedDesign?.id)) || null;
}

/**
 * What the "Shared by others" row offers for a design: "imported" with the
 * copy when the teacher already has one, even if the design can no longer be
 * imported; else "not-importable" when GET /designs says `importable: false`
 * (its case stopped being public); else "importable".
 * @returns {{ state: string, copy: object|null }}
 */
export function deriveImportState(sharedDesign, copies) {
    const copy = findImportedCopy(sharedDesign, copies);
    if (copy) {
        return { state: IMPORT_STATE_IMPORTED, copy };
    }
    if (sharedDesign?.importable === false) {
        return { state: IMPORT_STATE_NOT_IMPORTABLE, copy: null };
    }
    return { state: IMPORT_STATE_IMPORTABLE, copy: null };
}
