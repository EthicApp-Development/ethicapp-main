// The "Shared by others" tab of the Designs page (#977, epic #966): one row
// per design another teacher shares, with what matters for deciding to import
// it (its phases, case, author and license) and its one action, chosen by its
// import state: "Import", "Imported · View copy" when the teacher already has
// a copy, or "Import" disabled with the reason when its case stopped being
// public. Also the notice shown after an import.
//
// Plain functions over the payload of GET /designs, so the page's controller
// only wires them to the template. Designs are not told apart by type (epic
// #966, decision of 2026-11-01).

import {
    IMPORT_STATE_IMPORTABLE,
    IMPORT_STATE_IMPORTED,
    IMPORT_STATE_NOT_IMPORTABLE,
    deriveImportState,
    importedCopiesBySource,
} from "./design-status.js";
import { normalizeSearchText, phaseCountKey } from "./launch-design-list.js";

export { IMPORT_STATE_IMPORTABLE, IMPORT_STATE_IMPORTED, IMPORT_STATE_NOT_IMPORTABLE };

// How long the notice after an import stays, unless the teacher closes it.
export const IMPORT_NOTICE_TIMEOUT_MS = 10 * 1000;

function knownText(value) {
    const text = String(value ?? "").trim();
    // The server fills a missing author with "unknown" words.
    const tokens = text.split(/[,\s]+/u).filter(Boolean);
    return tokens.every(token => token.toLowerCase() === "unknown") ? "" : text;
}

/** The shared design's author as the row shows it, or "" when unknown. */
export function sharedDesignAuthor(design) {
    return knownText(design?.metainfo?.authorName);
}

/** One row of "Shared by others". */
export function buildSharedRow(design, copies) {
    const phaseCount = Array.isArray(design?.phases) ? design.phases.length : 0;
    const { state, copy } = deriveImportState(design, copies);
    return {
        id:            design.id,
        design,
        title:         design?.metainfo?.title || "",
        caseTitle:     design?.associatedCase?.title || "",
        phaseCount,
        phaseCountKey: phaseCountKey(phaseCount),
        author:        sharedDesignAuthor(design),
        licenseCode:   design?.licenseCode || "",
        importState:   state,
        copyId:        copy ? copy.id : null,
    };
}

/**
 * The rows of "Shared by others", in the order of `sharedDesigns`.
 *
 * @param {object[]} sharedDesigns - The designs the tab lists.
 * @param {object[]} designs - All of GET /designs, where the teacher's own
 *   copies are found.
 */
export function buildSharedRows(sharedDesigns, designs) {
    const copies = importedCopiesBySource(designs);
    return (Array.isArray(sharedDesigns) ? sharedDesigns : [])
        .map(design => buildSharedRow(design, copies));
}

function sharedRowSearchText(row) {
    const tags = Array.isArray(row?.design?.tags) ? row.design.tags.map(tag => tag?.label) : [];
    return normalizeSearchText([row?.title, row?.author, row?.caseTitle, ...tags]
        .filter(Boolean).join(" \u0000 "));
}

/**
 * Whether the row matches the search: every word of `query` appears in its
 * title, author, case's title or one of its tags. An empty query matches all.
 */
export function sharedRowMatchesSearch(row, query) {
    const words = normalizeSearchText(query).split(/\s+/u).filter(Boolean);
    if (words.length === 0) {
        return true;
    }
    const text = sharedRowSearchText(row);
    return words.every(word => text.includes(word));
}

/**
 * The notice after an import: the new copy's id and title, from the reloaded
 * designs. Without the copy in the list, it is named by the shared design's
 * title.
 * @returns {{ copyId: number, title: string }}
 */
export function importNotice(copyId, designs, sharedTitle = "") {
    const copy = (Array.isArray(designs) ? designs : [])
        .find(design => String(design?.id) === String(copyId));
    return { copyId, title: copy?.metainfo?.title || sharedTitle || "" };
}
