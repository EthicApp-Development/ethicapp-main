// The case view (#1018, epic #1008), `#!/cases/:id`: who is looking at the
// case, its status, its actions, its facts as chips, the designs that use it
// and its rights details.
//
// Plain functions over the payloads of GET /cases/:id and GET /cases/:id/uses,
// so the view's controller only wires them to the template. The status and
// the primary action follow the rules of the cases table (`case-status.js`,
// `cases-table.js`), so the view and the list agree.
//
// The author sees the case's status from every design that uses it, and the
// counts of other teachers' designs. Another teacher sees the case's document
// status only, as in "Shared by others", and only their own designs: never
// other teachers' design ids, titles or counts (#923).

import { CASE_STATUS_IN_USE, deriveCaseStatus } from "./case-status.js";
import {
    ROW_ACTION_ARCHIVE,
    ROW_ACTION_DUPLICATE,
    ROW_ACTION_RESTORE,
    caseMetaParts,
    isCaseShared,
    primaryRowAction,
    statusLabel,
} from "./cases-table.js";

export const CASE_VIEW_ACTION_IMPORT = "import";
export const CASE_VIEW_ACTION_VIEW_COPY = "view-copy";

const DESIGN_ROUTE_PREFIX = "#!/designs/";
const CASE_ROUTE_PREFIX = "#!/cases/";

// Non-Creative Commons license codes of the `licenses` table, by chip key.
const LICENSE_KEYS = {
    ALL_RIGHTS_RESERVED:  "case_view_license_all_rights_reserved",
    COMMERCIAL_LICENSE:   "case_view_license_commercial",
    USED_WITH_PERMISSION: "case_view_license_used_with_permission",
    CUSTOM:               "case_view_license_custom",
};
// "CC-BY-NC-SA-4.0" → "CC BY-NC-SA 4.0", as Creative Commons writes it.
const CREATIVE_COMMONS_CODE = /^CC-([A-Z-]+)-(\d+(?:\.\d+)?)$/u;

function idOf(value) {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function countOf(value) {
    const count = Number(value);
    return Number.isInteger(count) && count > 0 ? count : 0;
}

function pluralKey(prefix, count) {
    return count === 1 ? `${prefix}_one` : `${prefix}_other`;
}

function textOf(value) {
    return typeof value === "string" ? value.trim() : "";
}

/**
 * Whether the teacher is the case's author: its creator is the teacher of
 * the profile. Without the profile, the uses answer tells: only the author
 * gets `designsKeepingAccess`.
 * @param {object} caseItem - GET /cases/:id.
 * @param {object|null} profile - GET /users/profile.
 * @param {object|null} uses - GET /cases/:id/uses.
 */
export function isCaseAuthor(caseItem, profile, uses) {
    const teacherId = idOf(profile?.id);
    if (teacherId !== null) {
        return idOf(caseItem?.creator) === teacherId;
    }
    return Number.isInteger(uses?.designsKeepingAccess);
}

/**
 * The case's status, as `deriveCaseStatus` reads it.
 *
 * For the author it counts the activities of every design that uses the case,
 * from the uses answer; when that answer failed, `hasLaunchedDesignActivity`
 * still locks a case in use, with an unknown count (0). For another teacher
 * it describes the case's document only, as the "Shared by others" tab does.
 */
export function caseViewStatus(caseItem, uses, { isAuthor = false } = {}) {
    // GET /cases/:id has no `usage`; the uses answer is the one source.
    const caseOnly = { ...caseItem };
    delete caseOnly.usage;
    if (!isAuthor) {
        return deriveCaseStatus(caseOnly);
    }
    if (uses) {
        return deriveCaseStatus({ ...caseOnly, usage: { activityCount: uses.activityCount } });
    }
    const statusInfo = deriveCaseStatus(caseOnly);
    return caseItem?.hasLaunchedDesignActivity === true
        ? { ...statusInfo, status: CASE_STATUS_IN_USE, activityCount: 0 }
        : statusInfo;
}

/** The status chip: the table's Status label, or "In use" without a count. */
export function caseViewStatusLabel(statusInfo) {
    if (statusInfo?.status === CASE_STATUS_IN_USE && countOf(statusInfo.activityCount) === 0) {
        return { key: "case_view_status_in_use", params: {}, tone: "in-use" };
    }
    return statusLabel(statusInfo);
}

/** Whether the teacher can import the case: another teacher's shared case. */
export function isCaseImportable(caseItem, { isAuthor = false } = {}) {
    return !isAuthor && isCaseShared(caseItem) && caseItem?.archived !== true;
}

function action(id, key, icon, fields = {}) {
    return { id, key, icon, danger: false, disabled: false, reason: null, ...fields };
}

/**
 * The view's actions.
 *
 * - The author: the row's visible action ("Duplicate to edit" for a case in
 *   use, "Replace PDF" for a failed PDF, else "Edit"), and a "⋯" menu with
 *   Duplicate and Archive, or Restore for an archived case.
 * - Another teacher: "Import", or "Imported · View copy" once they have a
 *   copy; no menu. A case that is not shared any more cannot be imported.
 *
 * @returns {{ primary: object|null, menu: object[] }}
 */
export function caseViewActions(statusInfo, {
    isAuthor = false, importable = false, importedCopy = null,
} = {}) {
    if (!isAuthor) {
        const copyId = idOf(importedCopy?.id);
        if (copyId !== null) {
            return {
                primary: action(CASE_VIEW_ACTION_VIEW_COPY, "case_view_action_view_copy",
                    "fa-solid fa-check", { href: `${CASE_ROUTE_PREFIX}${copyId}`, copyId }),
                menu: [],
            };
        }
        return {
            primary: importable
                ? action(CASE_VIEW_ACTION_IMPORT, "case_view_action_import", "fa-solid fa-download")
                : null,
            menu: [],
        };
    }

    const archived = statusInfo?.archived === true;
    const menu = [
        action(ROW_ACTION_DUPLICATE, "cases_action_duplicate", "fa-regular fa-clone"),
        archived
            ? action(ROW_ACTION_RESTORE, "cases_action_restore", "fa-solid fa-rotate-left")
            : action(ROW_ACTION_ARCHIVE, "cases_action_archive", "fa-solid fa-box-archive"),
        // Delete goes last, after a divider and in red, with the delete
        // dialog of #1017 (`danger: true`; disabled with its reason).
    ];
    const { id, key, icon } = primaryRowAction(statusInfo);
    return { primary: action(id, key, icon), menu };
}

/**
 * A license as its chip names it: "CC BY-NC-SA 4.0", a translated name for
 * the other licenses of the catalog, or the code itself.
 * @returns {{ key: string, params: object }|{ text: string }|null}
 */
export function licenseLabel(licenseCode) {
    const code = textOf(licenseCode);
    if (!code) {
        return null;
    }
    if (LICENSE_KEYS[code]) {
        return { key: LICENSE_KEYS[code], params: {} };
    }
    const match = CREATIVE_COMMONS_CODE.exec(code);
    return { text: match ? `CC ${match[1]} ${match[2]}` : code };
}

/**
 * The case's facts as one line of chips, in order: status, archived, sharing,
 * language, license, rights status, pages and material, then one per tag.
 * Each chip has a `kind`, its `parts` (translation keys with parameters, or
 * plain texts, shown joined by " · ") and, for the status, a `tone`.
 * @param {object} caseItem
 * @param {object} statusInfo - From `caseViewStatus`.
 * @param {Map<string, string>} [languageNames] - Language code → name.
 */
export function caseViewChips(caseItem, statusInfo, languageNames = new Map()) {
    const status = caseViewStatusLabel(statusInfo);
    const chips = [{
        kind:  "status",
        tone:  status.tone,
        parts: [{ key: status.key, params: status.params }],
    }];
    if (statusInfo?.archived) {
        chips.push({ kind: "archived", parts: [{ key: "case_view_chip_archived", params: {} }] });
    }
    const shared = isCaseShared(caseItem);
    chips.push({
        kind:  "sharing",
        tone:  shared ? "shared" : "private",
        parts: [{ key: shared ? "case_view_chip_shared" : "case_view_chip_private", params: {} }],
    });

    const languageCode = textOf(caseItem?.languageCode);
    if (languageCode) {
        chips.push({
            kind:  "language",
            parts: [{ text: languageNames.get(languageCode) || languageCode }],
        });
    }
    const license = licenseLabel(caseItem?.licenseCode);
    if (license) {
        chips.push({ kind: "license", parts: [license] });
    }
    chips.push({
        kind:  "rights",
        parts: [{ key: `rights_status_${caseItem?.rightsStatus || "unknown"}`, params: {} }],
    });

    // The table's details without the language, which has its own chip.
    const material = caseMetaParts({ ...caseItem, languageCode: null });
    if (material.length > 0) {
        chips.push({ kind: "material", parts: material });
    }

    for (const tag of Array.isArray(caseItem?.tags) ? caseItem.tags : []) {
        const label = textOf(tag?.label);
        if (label) {
            chips.push({
                kind:  "tag",
                parts: [{ text: label }],
                title: textOf(tag.categoryLabel) || textOf(tag.categoryCode),
            });
        }
    }
    return chips;
}

function designLinks(ownDesigns) {
    return (Array.isArray(ownDesigns) ? ownDesigns : [])
        .filter(design => idOf(design?.id) !== null)
        .map(design => ({
            id:       idOf(design.id),
            title:    textOf(design.title) || null,
            archived: design.archived === true,
            href:     `${DESIGN_ROUTE_PREFIX}${idOf(design.id)}`,
        }));
}

/**
 * The "Where it is used" panel, from GET /cases/:id/uses; null without it.
 *
 * - The author: "Used in n designs · a yours, b of other teachers", their
 *   designs as links, "and b designs of other teachers" after them, and, for
 *   a private case that other teachers' designs keep reading, a notice (#939).
 * - Another teacher: only their own designs, and nothing about the others'.
 *
 * @returns {null|{
 *   none: boolean,
 *   summary: {key: string, params: object},
 *   breakdown: {key: string, params: object}[],
 *   designs: {id: number, title: string|null, archived: boolean, href: string}[],
 *   othersTail: {key: string, params: object}|null,
 *   kept: {key: string, params: object}|null,
 * }}
 */
export function caseViewUses(uses, caseItem, { isAuthor = false } = {}) {
    if (!uses) {
        return null;
    }
    const designs = designLinks(uses.ownDesigns);
    const own = designs.length;

    if (!isAuthor) {
        return {
            none:    own === 0,
            summary: own === 0
                ? { key: "case_view_uses_yours_none", params: {} }
                : { key: pluralKey("case_view_uses_yours", own), params: { count: own } },
            breakdown:  [],
            designs,
            othersTail: null,
            kept:       null,
        };
    }

    const others = countOf(uses.otherDesignCount);
    const total = own + others;
    const breakdown = [];
    if (own > 0) {
        breakdown.push({ key: pluralKey("case_view_uses_own", own), params: { count: own } });
    }
    if (others > 0) {
        breakdown.push({
            key:    pluralKey("case_view_uses_others", others),
            params: { count: others },
        });
    }
    const keeping = countOf(uses.designsKeepingAccess);
    return {
        none:    total === 0,
        summary: total === 0
            ? { key: "case_view_uses_none", params: {} }
            : { key: pluralKey("case_view_uses_total", total), params: { count: total } },
        breakdown,
        designs,
        othersTail: own > 0 && others > 0
            ? { key: pluralKey("case_view_uses_and_others", others), params: { count: others } }
            : null,
        kept: !isCaseShared(caseItem) && keeping > 0
            ? { key: pluralKey("case_view_uses_kept", keeping), params: { count: keeping } }
            : null,
    };
}

/** The case's authors, as the byline names them: "First Last; First Last". */
export function caseAuthorsLine(caseItem) {
    const name = author => [author?.authorFirstname, author?.authorLastname]
        .map(textOf).filter(Boolean).join(" ");
    const authors = Array.isArray(caseItem?.authors) && caseItem.authors.length > 0
        ? caseItem.authors
        : [caseItem];
    return authors.map(name).filter(Boolean).join("; ");
}

/**
 * A long date in the UI language: "12 de agosto de 2026" or
 * "August 12, 2026". Empty for a missing or invalid date.
 */
export function formatCaseDate(value, uiLanguage) {
    const time = Date.parse(value);
    if (Number.isNaN(time)) {
        return "";
    }
    const date = new Date(time);
    const locale = String(uiLanguage || "en_US").replace("_", "-");
    try {
        return new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(date);
    } catch {
        return date.toISOString().slice(0, 10);
    }
}

/**
 * The "Rights" tab: the case's authors with their emails, its license (its
 * catalog name and link, when the catalog is loaded) and rights status, then
 * the attribution, license notes, permission statement and commercial
 * source that were filled in, and the source of a copy.
 * @param {object} caseItem
 * @param {object[]} [licenses] - GET /licenses.
 */
export function caseViewRights(caseItem, licenses = []) {
    const authors = (Array.isArray(caseItem?.authors) && caseItem.authors.length > 0
        ? caseItem.authors
        : [caseItem])
        .map(author => ({
            name: [author?.authorFirstname, author?.authorLastname]
                .map(textOf).filter(Boolean).join(" "),
            email: textOf(author?.authorEmail),
        }))
        .filter(author => author.name || author.email);

    const code = textOf(caseItem?.licenseCode);
    const catalogLicense = (Array.isArray(licenses) ? licenses : [])
        .find(license => license?.code === code);
    const license = code
        ? {
            label: textOf(catalogLicense?.name)
                ? { text: catalogLicense.name }
                : licenseLabel(code),
            href: textOf(catalogLicense?.url) || null,
        }
        : null;

    const details = [
        ["attribution_text", caseItem?.attributionText],
        ["license_notes", caseItem?.licenseNotes],
        ["permission_statement", caseItem?.permissionStatement],
        ["commercial_source", caseItem?.commercialSource],
    ]
        .map(([labelKey, value]) => ({ labelKey, text: textOf(value) }))
        .filter(detail => detail.text);

    const sourceTitle = textOf(caseItem?.sourceCaseTitle);
    const source = sourceTitle
        ? {
            title:   sourceTitle,
            author:  textOf(caseItem?.sourceCaseAuthor),
            license: licenseLabel(caseItem?.sourceCaseLicenseCode),
        }
        : null;

    return {
        authors,
        license,
        rightsStatusKey: `rights_status_${caseItem?.rightsStatus || "unknown"}`,
        details,
        source,
    };
}

/** How many videos and documents the case has, for its "Material" tab. */
export function caseMaterialCount(caseItem) {
    const lengthOf = value => (Array.isArray(value) ? value.length : 0);
    return lengthOf(caseItem?.videos) + lengthOf(caseItem?.documents);
}

/**
 * Everything the view shows of a case.
 * @param {{
 *   caseItem: object,
 *   uses?: object|null,
 *   isAuthor?: boolean,
 *   importedCopy?: object|null,
 *   languageNames?: Map<string, string>,
 *   licenses?: object[],
 *   uiLanguage?: string,
 * }} input
 */
export function buildCaseView({
    caseItem, uses = null, isAuthor = false, importedCopy = null,
    languageNames = new Map(), licenses = [], uiLanguage = "en_US",
}) {
    const statusInfo = caseViewStatus(caseItem, uses, { isAuthor });
    const actions = caseViewActions(statusInfo, {
        isAuthor,
        importable: isCaseImportable(caseItem, { isAuthor }),
        importedCopy,
    });
    return {
        id:            idOf(caseItem?.id),
        title:         textOf(caseItem?.title),
        authors:       caseAuthorsLine(caseItem),
        createdOn:     formatCaseDate(caseItem?.createdAt, uiLanguage),
        isAuthor,
        statusInfo,
        primary:       actions.primary,
        menu:          actions.menu,
        chips:         caseViewChips(caseItem, statusInfo, languageNames),
        uses:          caseViewUses(uses, caseItem, { isAuthor }),
        rights:        caseViewRights(caseItem, licenses),
        materialCount: caseMaterialCount(caseItem),
    };
}
