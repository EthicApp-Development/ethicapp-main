// The tables of the Designs page (#975, epic #966): its tabs, which designs
// each tab lists and in which order, and what each row of "My designs" and
// "Archived" shows: its status, its sharing switch, one visible action chosen
// by its state, and the entries of its "⋯" menu.
//
// Plain functions over the payloads of GET /designs and GET /activities, so
// the page's controller only wires them to the template. Diseños does not
// launch activities: no row offers it (epic #966, decision of 2026-11-01).

import {
    DESIGN_STATUS_ERRORS,
    DESIGN_STATUS_IN_USE,
    activityCountsByDesign,
    deriveDesignStatus,
} from "./design-status.js";
import { orderDesignsForLaunch, phaseCountKey } from "./launch-design-list.js";

export const DESIGNS_TAB_MINE = "mine";
export const DESIGNS_TAB_SHARED = "shared";
export const DESIGNS_TAB_ARCHIVED = "archived";
export const DESIGNS_TABS = [DESIGNS_TAB_MINE, DESIGNS_TAB_SHARED, DESIGNS_TAB_ARCHIVED];

// Rows shown before "Show more", and how many more each click adds.
export const DESIGNS_PAGE_SIZE = 20;

export const ROW_ACTION_EDIT = "edit";
export const ROW_ACTION_FIX = "fix";
export const ROW_ACTION_DUPLICATE_TO_EDIT = "duplicate-to-edit";
export const ROW_ACTION_RESTORE = "restore";
export const ROW_ACTION_VIEW = "view";
export const ROW_ACTION_DUPLICATE = "duplicate";
export const ROW_ACTION_ARCHIVE = "archive";
export const ROW_ACTION_DELETE = "delete";

/** The tab the URL asks for (`?tab=`), else "My designs". */
export function tabFromSearch(search) {
    const tab = search?.tab;
    return DESIGNS_TABS.includes(tab) ? tab : DESIGNS_TAB_MINE;
}

/** The `?tab=` value of a tab: none for "My designs", the default. */
export function tabSearchValue(tab) {
    return DESIGNS_TABS.includes(tab) && tab !== DESIGNS_TAB_MINE ? tab : null;
}

/**
 * What the Status column says, as a translation key, its parameters and a
 * tone for the styles. A design stored invalid whose errors the validator no
 * longer finds says "With errors" without a number, and a design locked
 * without activities of this teacher says "In use" without a number.
 */
export function statusLabel(statusInfo) {
    const { status, errorCount = 0, activityCount = 0 } = statusInfo || {};
    if (status === DESIGN_STATUS_IN_USE) {
        if (activityCount > 0) {
            return {
                key: activityCount === 1
                    ? "designs_status_in_use_one"
                    : "designs_status_in_use_other",
                params: { count: activityCount },
                tone:   "in-use",
            };
        }
        return { key: "designs_status_in_use", params: {}, tone: "in-use" };
    }
    if (status === DESIGN_STATUS_ERRORS) {
        if (errorCount > 0) {
            return {
                key: errorCount === 1
                    ? "designs_status_errors_one"
                    : "designs_status_errors_other",
                params: { count: errorCount },
                tone:   "errors",
            };
        }
        return { key: "designs_status_errors", params: {}, tone: "errors" };
    }
    return { key: "designs_status_ready", params: {}, tone: "ready" };
}

function primaryAction(id, key, icon) {
    return { id, key, icon };
}

/**
 * The row's one visible action: "Restore" in the Archived tab; else "Edit"
 * for a ready design, "Fix" for one with errors (both open the editor) and
 * "Duplicate to edit" for one in use, which cannot be edited.
 */
export function primaryRowAction(statusInfo, { archived = false } = {}) {
    if (archived) {
        return primaryAction(ROW_ACTION_RESTORE, "designs_action_restore",
            "fa-solid fa-rotate-left");
    }
    if (statusInfo?.status === DESIGN_STATUS_IN_USE) {
        return primaryAction(ROW_ACTION_DUPLICATE_TO_EDIT, "designs_action_duplicate_to_edit",
            "fa-regular fa-clone");
    }
    if (statusInfo?.status === DESIGN_STATUS_ERRORS) {
        return primaryAction(ROW_ACTION_FIX, "designs_action_fix",
            "fa-solid fa-triangle-exclamation");
    }
    return primaryAction(ROW_ACTION_EDIT, "designs_action_edit", "fa-solid fa-pen");
}

function deleteEntry(statusInfo) {
    const entry = {
        id:       ROW_ACTION_DELETE,
        key:      "designs_action_delete",
        icon:     "fa-solid fa-trash",
        danger:   true,
        disabled: false,
        reason:   null,
    };
    if (statusInfo?.status !== DESIGN_STATUS_IN_USE) {
        return entry;
    }
    const count = statusInfo.activityCount || 0;
    let reason = { key: "designs_delete_in_use", params: {} };
    if (count > 0) {
        reason = {
            key:    count === 1 ? "designs_delete_in_use_one" : "designs_delete_in_use_other",
            params: { count },
        };
    }
    return { ...entry, disabled: true, reason };
}

/**
 * The entries of the row's "⋯" menu: View, Duplicate and, outside the
 * Archived tab, Archive; then Delete, last and in red, disabled with its
 * reason for a design in use. There is no launch entry.
 */
export function rowMenuEntries(statusInfo, { archived = false } = {}) {
    const entries = [
        { id: ROW_ACTION_VIEW, key: "designs_action_view", icon: "fa-regular fa-eye" },
        { id: ROW_ACTION_DUPLICATE, key: "designs_action_duplicate", icon: "fa-regular fa-clone" },
    ];
    if (!archived) {
        entries.push({
            id: ROW_ACTION_ARCHIVE, key: "designs_action_archive", icon: "fa-solid fa-box-archive",
        });
    }
    return [
        ...entries.map(entry => ({ ...entry, danger: false, disabled: false, reason: null })),
        deleteEntry(statusInfo),
    ];
}

/**
 * Whether the row's sharing switch can be used, and why not. A design with
 * errors cannot be shared (today's card hid the switch for it), nor can an
 * archived one.
 * @returns {{ disabled: boolean, reasonKey: string|null }}
 */
export function sharingState(design, { archived = false } = {}) {
    if (archived) {
        return { disabled: true, reasonKey: "designs_sharing_disabled_archived" };
    }
    if (design?.valid !== true) {
        return { disabled: true, reasonKey: "designs_sharing_disabled_errors" };
    }
    return { disabled: false, reasonKey: null };
}

/** Whether the design is shared with other teachers, as its switch shows it. */
export function isDesignShared(design) {
    return design?.visibility === "public";
}

/** A sorted copy of `designs`, newest first: by creation, then by id. */
export function orderDesignsNewestFirst(designs) {
    // Without launch statistics the launch list's order is exactly this one.
    return orderDesignsForLaunch(designs, null);
}

/** One row of "My designs" or "Archived". */
export function buildDesignRow(design, activityCounts) {
    const statusInfo = deriveDesignStatus(design, activityCounts);
    const phaseCount = Array.isArray(design?.phases) ? design.phases.length : 0;
    return {
        id:            design.id,
        design,
        title:         design?.metainfo?.title || "",
        caseTitle:     design?.associatedCase?.title || "",
        phaseCount,
        phaseCountKey: phaseCountKey(phaseCount),
        statusInfo,
        status:        statusLabel(statusInfo),
        primary:       primaryRowAction(statusInfo, { archived: statusInfo.archived }),
        menu:          rowMenuEntries(statusInfo, { archived: statusInfo.archived }),
        sharing:       sharingState(design, { archived: statusInfo.archived }),
    };
}

/** A design other teachers share, as the "Shared by others" tab lists it. */
export function isSharedByOthers(design) {
    return design?.userOwned === false && design.visibility === "public" &&
        design.valid === true && design.archived !== true;
}

/**
 * The page's lists, newest first: the rows of "My designs" (own, not
 * archived) and "Archived" (own, archived), and the designs other teachers
 * share.
 */
export function buildDesignTables(designs, activities) {
    const list = Array.isArray(designs) ? designs : [];
    const counts = activityCountsByDesign(activities);
    const own = list.filter(design => design?.userOwned === true);
    const toRows = items => orderDesignsNewestFirst(items)
        .map(design => buildDesignRow(design, counts));
    return {
        mine:     toRows(own.filter(design => design.archived !== true)),
        archived: toRows(own.filter(design => design.archived === true)),
        shared:   orderDesignsNewestFirst(list.filter(isSharedByOthers)),
    };
}
