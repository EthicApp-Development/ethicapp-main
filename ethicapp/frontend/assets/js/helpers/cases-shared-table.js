// The "Shared by others" tab of the Cases page (#1016, epic #1008): one row
// per case another teacher shares, with what matters for deciding to import
// it (its pages and language, its author, its license and rights status) and
// its one action, chosen by its import state: "Import", or "Imported · View
// copy" when the teacher already has a copy, and beside it the secondary
// "New design with this case" (#1019). Also the tab's search, over the
// title, the authors and the tags.
//
// Plain functions over the payloads of GET /cases, so the page's controller
// only wires them to the template. The teacher's copy is found by
// `case-status.js`.

import { findImportedCopy, importedCopiesBySource } from "./case-status.js";
import { caseMetaParts } from "./cases-table.js";
import { normalizeSearchText } from "./launch-design-list.js";
import { newDesignFromCaseHref } from "./new-design-from-case.js";

export const CASE_IMPORT_STATE_IMPORTABLE = "importable";
export const CASE_IMPORT_STATE_IMPORTED = "imported";

// The rights statuses of `ethical_cases.rights_status`, which have a label
// (`rights_status_<status>`).
const RIGHTS_STATUSES = new Set([
    "own_work",
    "open_license",
    "used_with_permission",
    "commercial_license",
    "public_domain",
]);

// The licenses of the `licenses` table that are not Creative Commons, by
// translation key.
const LICENSE_KEYS = {
    ALL_RIGHTS_RESERVED:  "cases_shared_license_all_rights_reserved",
    COMMERCIAL_LICENSE:   "cases_shared_license_commercial",
    USED_WITH_PERMISSION: "cases_shared_license_used_with_permission",
    CUSTOM:               "cases_shared_license_custom",
};

// A Creative Commons code, such as "CC-BY-NC-SA-4.0".
const CREATIVE_COMMONS_CODE = /^CC-([A-Z-]+)-(\d+(?:\.\d+)?)$/u;

function nameOf(firstname, lastname) {
    return [firstname, lastname]
        .map(part => String(part ?? "").trim())
        .filter(Boolean)
        .join(" ");
}

/**
 * The shared case's authors as the row shows them, in their order, or ""
 * when none has a name.
 */
export function sharedCaseAuthor(caseItem) {
    const authors = Array.isArray(caseItem?.authors) && caseItem.authors.length > 0
        ? caseItem.authors
        : [caseItem];
    return authors
        .map(author => nameOf(author?.authorFirstname, author?.authorLastname))
        .filter(Boolean)
        .join(", ");
}

/**
 * The license as the row shows it: a Creative Commons code by its short
 * name ("CC-BY-SA-4.0" is "CC BY-SA 4.0"), the other licenses by a
 * translation key, and an unknown code as it is.
 * @returns {{ text: string }|{ key: string }}
 */
export function sharedCaseLicense(licenseCode) {
    const code = String(licenseCode ?? "").trim();
    const creativeCommons = CREATIVE_COMMONS_CODE.exec(code);
    if (creativeCommons) {
        return { text: `CC ${creativeCommons[1]} ${creativeCommons[2]}` };
    }
    if (Object.hasOwn(LICENSE_KEYS, code)) {
        return { key: LICENSE_KEYS[code] };
    }
    return { text: code };
}

/** The translation key of the case's rights status, "unknown" when it has none. */
export function rightsStatusKey(caseItem) {
    const status = caseItem?.rightsStatus;
    return `rights_status_${RIGHTS_STATUSES.has(status) ? status : "unknown"}`;
}

/**
 * One row of "Shared by others".
 * @param {object} caseItem - A case of GET /cases?scope=public.
 * @param {Map<number, object>} copies - From `importedCopiesBySource`.
 * @param {Map<string, string>} [languageNames] - Language code → name.
 */
export function buildSharedCaseRow(caseItem, copies, languageNames = new Map()) {
    const copy = findImportedCopy(caseItem, copies);
    // The pages and the language; the material is listed in the case view.
    const meta = caseMetaParts({
        documentProcessing: caseItem?.documentProcessing,
        languageCode:       caseItem?.languageCode,
    }, languageNames);
    return {
        id:          caseItem.id,
        caseItem,
        title:       caseItem?.title || "",
        meta,
        author:      sharedCaseAuthor(caseItem),
        license:     sharedCaseLicense(caseItem?.licenseCode),
        rightsKey:   rightsStatusKey(caseItem),
        importState: copy ? CASE_IMPORT_STATE_IMPORTED : CASE_IMPORT_STATE_IMPORTABLE,
        copyId:      copy ? copy.id : null,

        // A shared case can be used in a design without importing it, so
        // the row also links to a new design with the case (#1019).
        newDesignHref: newDesignFromCaseHref(caseItem.id),
    };
}

/**
 * The rows of "Shared by others", in the order of `sharedCases`.
 * @param {object[]} sharedCases - The cases the tab lists.
 * @param {object[]} ownCases - The teacher's own and archived cases, where
 *   their copies are found.
 * @param {Map<string, string>} [languageNames]
 */
export function buildSharedCaseRows(sharedCases, ownCases, languageNames = new Map()) {
    const copies = importedCopiesBySource(ownCases);
    return (Array.isArray(sharedCases) ? sharedCases : [])
        .map(caseItem => buildSharedCaseRow(caseItem, copies, languageNames));
}

function sharedCaseSearchText(row) {
    const tags = Array.isArray(row?.caseItem?.tags)
        ? row.caseItem.tags.map(tag => tag?.label)
        : [];
    return normalizeSearchText([row?.title, row?.author, ...tags]
        .filter(Boolean).join(" \u0000 "));
}

/**
 * Whether the row matches the search: every word of `query` appears in its
 * title, its authors or one of its tags, ignoring case and accents. An empty
 * query matches all.
 */
export function sharedCaseMatchesSearch(row, query) {
    const words = normalizeSearchText(query).split(/\s+/u).filter(Boolean);
    if (words.length === 0) {
        return true;
    }
    const text = sharedCaseSearchText(row);
    return words.every(word => text.includes(word));
}
