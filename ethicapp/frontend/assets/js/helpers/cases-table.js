// The tables of the Cases page (#1013, epic #1008): its tabs, which cases
// each tab lists and in which order, and what each row of "My cases" and
// "Archived" shows: its details, its status, the designs that use it, its
// sharing switch, one visible action chosen by its state, and the entries of
// its "⋯" menu.
//
// Plain functions over the payloads of GET /cases, so the page's controller
// only wires them to the template. The status comes from `case-status.js`.

import {
    CASE_STATUS_IN_USE,
    CASE_STATUS_PDF_ERROR,
    CASE_STATUS_PROCESSING,
    deriveCaseStatus,
} from "./case-status.js";

export const CASES_TAB_MINE = "mine";
export const CASES_TAB_SHARED = "shared";
export const CASES_TAB_ARCHIVED = "archived";
export const CASES_TABS = [CASES_TAB_MINE, CASES_TAB_SHARED, CASES_TAB_ARCHIVED];

// Rows shown before "Show more", and how many more each click adds.
export const CASES_PAGE_SIZE = 20;

export const ROW_ACTION_EDIT = "edit";
export const ROW_ACTION_REPLACE_PDF = "replace-pdf";
export const ROW_ACTION_DUPLICATE_TO_EDIT = "duplicate-to-edit";
export const ROW_ACTION_RESTORE = "restore";
export const ROW_ACTION_VIEW = "view";
// "New design with this case" (#1019): opens the design form with the case.
export const ROW_ACTION_NEW_DESIGN = "new-design";
export const ROW_ACTION_DUPLICATE = "duplicate";
export const ROW_ACTION_ARCHIVE = "archive";
export const ROW_ACTION_DELETE = "delete";

function countOf(value) {
    const count = Number(value);
    return Number.isInteger(count) && count > 0 ? count : 0;
}

function pluralKey(prefix, count) {
    return count === 1 ? `${prefix}_one` : `${prefix}_other`;
}

/** The tab the URL asks for (`?tab=`), else "My cases". */
export function tabFromSearch(search) {
    const tab = search?.tab;
    return CASES_TABS.includes(tab) ? tab : CASES_TAB_MINE;
}

/** The `?tab=` value of a tab: none for "My cases", the default. */
export function tabSearchValue(tab) {
    return CASES_TABS.includes(tab) && tab !== CASES_TAB_MINE ? tab : null;
}

/**
 * The usage counts of a case, 0 when GET /cases did not return them.
 * @returns {{ activityCount: number, ownDesignCount: number,
 *   otherDesignCount: number, otherTeacherCount: number }}
 */
export function caseUsageOf(caseItem) {
    const usage = caseItem?.usage;
    return {
        activityCount:     countOf(usage?.activityCount),
        ownDesignCount:    countOf(usage?.ownDesignCount),
        otherDesignCount:  countOf(usage?.otherDesignCount),
        otherTeacherCount: countOf(usage?.otherTeacherCount),
    };
}

/**
 * What the Status column says, as a translation key, its parameters and a
 * tone for the styles.
 */
export function statusLabel(statusInfo) {
    switch (statusInfo?.status) {
    case CASE_STATUS_IN_USE: {
        const count = countOf(statusInfo.activityCount);
        return {
            key:    pluralKey("cases_status_in_use", count),
            params: { count },
            tone:   "in-use",
        };
    }
    case CASE_STATUS_PDF_ERROR:
        return { key: "cases_status_pdf_error", params: {}, tone: "pdf-error" };
    case CASE_STATUS_PROCESSING:
        return { key: "cases_status_processing", params: {}, tone: "processing" };
    default:
        return { key: "cases_status_ready", params: {}, tone: "ready" };
    }
}

/**
 * What the Designs column says: how many designs use the case and, under it,
 * how many of them belong to other teachers; "No designs" when none does.
 * @returns {{ none: boolean, total: {key: string, params: object},
 *   others: {key: string, params: object}|null }}
 */
export function designsSummary(usage) {
    const own = countOf(usage?.ownDesignCount);
    const others = countOf(usage?.otherDesignCount);
    const total = own + others;
    if (total === 0) {
        return { none: true, total: { key: "cases_designs_none", params: {} }, others: null };
    }
    return {
        none:   false,
        total:  { key: pluralKey("cases_designs", total), params: { count: total } },
        others: others > 0
            ? { key: pluralKey("cases_designs_others", others), params: { count: others } }
            : null,
    };
}

/**
 * The details under the case's title, in order: its pages, once rendered, its
 * videos and documents, and its language's name. Each part is a translation
 * key with its parameters, or a plain text.
 * @param {object} caseItem
 * @param {Map<string, string>} [languageNames] - Language code → name.
 * @returns {({ key: string, params: object }|{ text: string })[]}
 */
export function caseMetaParts(caseItem, languageNames = new Map()) {
    const parts = [];
    const pushCount = (prefix, count) => {
        if (count > 0) {
            parts.push({ key: pluralKey(prefix, count), params: { count } });
        }
    };
    const lengthOf = value => (Array.isArray(value) ? value.length : 0);

    pushCount("cases_meta_pages", caseItem?.documentProcessing?.status === "completed"
        ? countOf(caseItem.documentProcessing.pageCount)
        : 0);
    pushCount("cases_meta_videos", lengthOf(caseItem?.videos));
    pushCount("cases_meta_documents", lengthOf(caseItem?.documents));
    const languageCode = caseItem?.languageCode;
    if (languageCode) {
        parts.push({ text: languageNames.get(languageCode) || languageCode });
    }
    return parts;
}

/**
 * Language code → its name as the case form lists it (`native_name`), from
 * GET /languages.
 * @returns {Map<string, string>}
 */
export function languageNamesByCode(languages) {
    const names = new Map();
    for (const language of Array.isArray(languages) ? languages : []) {
        if (language?.code) {
            names.set(language.code, language.native_name || language.name || language.code);
        }
    }
    return names;
}

function action(id, key, icon) {
    return { id, key, icon };
}

/**
 * The row's one visible action: "Restore" in the Archived tab; else "Edit"
 * for a ready or processing case, "Replace PDF" for one whose PDF failed
 * (both open the editor) and "Duplicate to edit" for one in use, whose
 * content cannot be edited.
 */
export function primaryRowAction(statusInfo, { archived = false } = {}) {
    if (archived) {
        return action(ROW_ACTION_RESTORE, "cases_action_restore", "fa-solid fa-rotate-left");
    }
    if (statusInfo?.status === CASE_STATUS_IN_USE) {
        return action(ROW_ACTION_DUPLICATE_TO_EDIT, "cases_action_duplicate_to_edit",
            "fa-regular fa-clone");
    }
    if (statusInfo?.status === CASE_STATUS_PDF_ERROR) {
        return action(ROW_ACTION_REPLACE_PDF, "cases_action_replace_pdf",
            "fa-solid fa-triangle-exclamation");
    }
    return action(ROW_ACTION_EDIT, "cases_action_edit", "fa-solid fa-pen");
}

/**
 * Why the case cannot be deleted, or null: an activity was launched from a
 * design that uses it ("in use by n activities"), or other teachers' designs
 * use it ("used by n designs of m teachers", epic #1008, decision of
 * 2026-11-02). The first wins.
 * @returns {{ key: string, params: object }|null}
 */
export function deleteBlockReason(statusInfo, usage) {
    if (statusInfo?.status === CASE_STATUS_IN_USE) {
        const count = countOf(statusInfo.activityCount);
        return { key: pluralKey("cases_delete_in_use", count), params: { count } };
    }
    const designs = countOf(usage?.otherDesignCount);
    if (designs === 0) {
        return null;
    }
    const teachers = countOf(usage?.otherTeacherCount);
    const params = { count: designs, teachers };
    if (designs === 1) {
        return { key: "cases_delete_used_by_others_one", params };
    }
    if (teachers === 1) {
        return { key: "cases_delete_used_by_others_one_teacher", params };
    }
    // A design without a creator counts as another teacher's but adds no
    // teacher, so the number of teachers can be unknown.
    if (teachers === 0) {
        return { key: "cases_delete_used_by_others", params };
    }
    return { key: "cases_delete_used_by_others_other", params };
}

/**
 * The entries of the row's "⋯" menu: View, then, outside the Archived tab,
 * "New design with this case" (#1019), since a design cannot use an archived
 * case; Duplicate and, outside the Archived tab, Archive; then Delete, last
 * and in red, disabled with its reason when the case cannot be deleted.
 */
export function rowMenuEntries(statusInfo, usage, { archived = false } = {}) {
    const entries = [action(ROW_ACTION_VIEW, "cases_action_view", "fa-regular fa-eye")];
    if (!archived) {
        entries.push(action(ROW_ACTION_NEW_DESIGN, "cases_new_design_action", "fa-solid fa-plus"));
    }
    entries.push(action(ROW_ACTION_DUPLICATE, "cases_action_duplicate", "fa-regular fa-clone"));
    if (!archived) {
        entries.push(action(ROW_ACTION_ARCHIVE, "cases_action_archive", "fa-solid fa-box-archive"));
    }
    const reason = deleteBlockReason(statusInfo, usage);
    return [
        ...entries.map(entry => ({ ...entry, danger: false, disabled: false, reason: null })),
        {
            ...action(ROW_ACTION_DELETE, "cases_action_delete", "fa-solid fa-trash"),
            danger:   true,
            disabled: reason !== null,
            reason,
        },
    ];
}

/**
 * Whether the row's sharing switch can be used, and why not. A case in use
 * keeps its sharing editable (#1014); an archived case cannot be shared, as
 * on today's card.
 * @returns {{ disabled: boolean, reasonKey: string|null }}
 */
export function sharingState({ archived = false } = {}) {
    if (archived) {
        return { disabled: true, reasonKey: "cases_sharing_disabled_archived" };
    }
    return { disabled: false, reasonKey: null };
}

/** Whether the case is shared with other teachers, as its switch shows it. */
export function isCaseShared(caseItem) {
    return caseItem?.visibility === "public";
}

function timeOf(value) {
    const time = Date.parse(value);
    return Number.isNaN(time) ? 0 : time;
}

/** A sorted copy of `cases`, newest first: by creation, then by id. */
export function orderCasesNewestFirst(cases) {
    return [...(Array.isArray(cases) ? cases : [])].sort((left, right) => {
        return (timeOf(right?.createdAt) - timeOf(left?.createdAt)) ||
            (countOf(right?.id) - countOf(left?.id));
    });
}

/** One row of "My cases" or "Archived". */
export function buildCaseRow(caseItem, languageNames) {
    const statusInfo = deriveCaseStatus(caseItem);
    const usage = caseUsageOf(caseItem);
    const options = { archived: statusInfo.archived };
    return {
        id:      caseItem.id,
        caseItem,
        title:   caseItem?.title || "",
        meta:    caseMetaParts(caseItem, languageNames),
        statusInfo,
        status:  statusLabel(statusInfo),
        designs: designsSummary(usage),
        primary: primaryRowAction(statusInfo, options),
        menu:    rowMenuEntries(statusInfo, usage, options),
        sharing: sharingState(options),
    };
}

/**
 * The page's lists, newest first: the rows of "My cases" and "Archived", and
 * the cases other teachers share, as GET /cases returns them by scope.
 * @param {{ own?: object[], archived?: object[], shared?: object[] }} cases
 * @param {Map<string, string>} [languageNames]
 */
export function buildCaseTables({ own, archived, shared } = {}, languageNames = new Map()) {
    const toRows = items => orderCasesNewestFirst(items)
        .map(caseItem => buildCaseRow(caseItem, languageNames));
    return {
        mine:     toRows(own),
        archived: toRows(archived),
        shared:   orderCasesNewestFirst(shared),
    };
}
