// The search and the status filters of "My designs" (#976, epic #966).
//
// The status chips are "All", "Ready", "With errors · n", "In use" and
// "Shared". A design's status comes from `helpers/design-status.js`, so each
// chip lists exactly the rows whose Status column says it; "Shared" is a flag
// beside the status and lists the designs whose sharing switch is on. There
// is no type filter (epic #966, decision of 2026-11-01).
//
// The search covers the title, the case and the tags, without accents or
// case, with the launch wizard's matcher.
//
// Both live in the URL beside the tab (`#!/designs?status=errors&q=ética`), so
// other pages can link to a filtered list (the launch wizard's "Review in
// Designs" opens `?status=errors`) and Back from a design restores them.
//
// Plain functions over the rows of `helpers/designs-table.js`.

import {
    DESIGN_STATUS_ERRORS,
    DESIGN_STATUS_IN_USE,
    DESIGN_STATUS_READY,
} from "./design-status.js";
import { isDesignShared } from "./designs-table.js";
import { designMatchesLaunchSearch } from "./launch-design-list.js";

export const DESIGNS_FILTER_ALL = "all";
export const DESIGNS_FILTER_READY = "ready";
export const DESIGNS_FILTER_ERRORS = "errors";
export const DESIGNS_FILTER_IN_USE = "in-use";
export const DESIGNS_FILTER_SHARED = "shared";

// In the order of the chips.
export const DESIGNS_FILTERS = [
    DESIGNS_FILTER_ALL,
    DESIGNS_FILTER_READY,
    DESIGNS_FILTER_ERRORS,
    DESIGNS_FILTER_IN_USE,
    DESIGNS_FILTER_SHARED,
];

const FILTER_KEYS = {
    [DESIGNS_FILTER_ALL]:    "designs_filter_all",
    [DESIGNS_FILTER_READY]:  "designs_filter_ready",
    [DESIGNS_FILTER_ERRORS]: "designs_filter_errors",
    [DESIGNS_FILTER_IN_USE]: "designs_filter_in_use",
    [DESIGNS_FILTER_SHARED]: "designs_filter_shared",
};

// The chips that show their count, as "With errors · 2".
const COUNTED_FILTERS = new Set([DESIGNS_FILTER_ERRORS]);

// The longest search kept in the URL.
export const DESIGNS_QUERY_MAX_LENGTH = 200;

/** The status filter the URL asks for (`?status=`), else "All". */
export function statusFilterFromSearch(search) {
    const filter = search?.status;
    return DESIGNS_FILTERS.includes(filter) ? filter : DESIGNS_FILTER_ALL;
}

/** The `?status=` value of a filter: none for "All", the default. */
export function statusFilterSearchValue(filter) {
    return DESIGNS_FILTERS.includes(filter) && filter !== DESIGNS_FILTER_ALL ? filter : null;
}

/** The search the URL asks for (`?q=`), trimmed, else "". */
export function queryFromSearch(search) {
    const query = search?.q;
    return typeof query === "string" ? query.trim().slice(0, DESIGNS_QUERY_MAX_LENGTH) : "";
}

/** The `?q=` value of a search: none when it is blank. */
export function querySearchValue(query) {
    const value = String(query ?? "").trim().slice(0, DESIGNS_QUERY_MAX_LENGTH);
    return value === "" ? null : value;
}

/** Whether a row of "My designs" belongs to the filter. */
export function rowMatchesStatusFilter(row, filter) {
    switch (filter) {
    case DESIGNS_FILTER_READY:
        return row?.statusInfo?.status === DESIGN_STATUS_READY;
    case DESIGNS_FILTER_ERRORS:
        return row?.statusInfo?.status === DESIGN_STATUS_ERRORS;
    case DESIGNS_FILTER_IN_USE:
        return row?.statusInfo?.status === DESIGN_STATUS_IN_USE;
    case DESIGNS_FILTER_SHARED:
        return isDesignShared(row?.design);
    default:
        return true;
    }
}

/** Whether a row matches the search: title, case or tags, every word. */
export function rowMatchesQuery(row, query) {
    return designMatchesLaunchSearch(row?.design, query);
}

/**
 * The rows of "My designs" that pass the filter and the search, in their
 * order.
 */
export function filterDesignRows(rows, { status = DESIGNS_FILTER_ALL, query = "" } = {}) {
    return (Array.isArray(rows) ? rows : [])
        .filter(row => rowMatchesStatusFilter(row, status) && rowMatchesQuery(row, query));
}

/**
 * Filter → how many rows it lists, before the search: the chips count the
 * tab, not the search's results.
 * @returns {Record<string, number>}
 */
export function statusFilterCounts(rows) {
    const list = Array.isArray(rows) ? rows : [];
    return Object.fromEntries(DESIGNS_FILTERS.map(filter =>
        [filter, list.filter(row => rowMatchesStatusFilter(row, filter)).length]));
}

/**
 * The chips, in order: each with its filter, its translation key, its count
 * when the chip shows one (else null), and whether it is the active one.
 */
export function statusFilterChips(rows, activeFilter) {
    const counts = statusFilterCounts(rows);
    return DESIGNS_FILTERS.map(filter => ({
        id:     filter,
        key:    FILTER_KEYS[filter],
        count:  COUNTED_FILTERS.has(filter) ? counts[filter] : null,
        active: filter === activeFilter,
    }));
}
