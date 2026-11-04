// The search and the status filters of the Activities page (#1051, epic
// #1046).
//
// The search covers each activity's name and description, its design's
// title, its case's title and its access code, in every tab, without accents
// or case: every word must appear in one of them, in any order.
//
// "En curso" also has the status chips "Todas", "Sin iniciar · n" and "Con
// fase en curso". A row's status comes from `helpers/activity-list-status.js`,
// so each chip lists exactly the rows whose Estado column says it. The other
// tabs have the search only.
//
// Both live in the URL beside the tab (`#!/activities?status=not-started&q=`),
// so Back from the dashboard restores them.
//
// Plain functions over the rows of `helpers/activities-table.js`.

import {
    ACTIVITY_TAB_ONGOING,
    LIST_STATUS_IN_PROGRESS,
    LIST_STATUS_NOT_STARTED,
} from "./activity-list-status.js";
import { activityCaseOf, activityDesignTitle } from "./activities-table.js";
import { normalizeSearchText } from "./launch-design-list.js";

export const ACTIVITIES_FILTER_ALL = "all";
export const ACTIVITIES_FILTER_NOT_STARTED = LIST_STATUS_NOT_STARTED;
export const ACTIVITIES_FILTER_IN_PROGRESS = LIST_STATUS_IN_PROGRESS;

// In the order of the chips.
export const ACTIVITIES_FILTERS = Object.freeze([
    ACTIVITIES_FILTER_ALL,
    ACTIVITIES_FILTER_NOT_STARTED,
    ACTIVITIES_FILTER_IN_PROGRESS,
]);

const FILTER_KEYS = {
    [ACTIVITIES_FILTER_ALL]:         "activities_filter_all",
    [ACTIVITIES_FILTER_NOT_STARTED]: "activities_filter_not_started",
    [ACTIVITIES_FILTER_IN_PROGRESS]: "activities_filter_in_progress",
};

// The chips that show their count, as "Sin iniciar · 9".
const COUNTED_FILTERS = new Set([ACTIVITIES_FILTER_NOT_STARTED]);

// The longest search kept in the URL.
export const ACTIVITIES_QUERY_MAX_LENGTH = 200;

/** Whether a tab has the status chips: "En curso" only. */
export function tabHasStatusFilter(tab) {
    return tab === ACTIVITY_TAB_ONGOING;
}

/** The status filter the URL asks for (`?status=`), else "Todas". */
export function statusFilterFromSearch(search) {
    const filter = search?.status;
    return ACTIVITIES_FILTERS.includes(filter) ? filter : ACTIVITIES_FILTER_ALL;
}

/** The `?status=` value of a filter: none for "Todas", the default. */
export function statusFilterSearchValue(filter) {
    return ACTIVITIES_FILTERS.includes(filter) && filter !== ACTIVITIES_FILTER_ALL
        ? filter
        : null;
}

/** The search the URL asks for (`?q=`), trimmed, else "". */
export function queryFromSearch(search) {
    const query = search?.q;
    return typeof query === "string"
        ? query.trim().slice(0, ACTIVITIES_QUERY_MAX_LENGTH)
        : "";
}

/** The `?q=` value of a search: none when it is blank. */
export function querySearchValue(query) {
    const value = String(query ?? "").trim().slice(0, ACTIVITIES_QUERY_MAX_LENGTH);
    return value === "" ? null : value;
}

/** Whether a row belongs to the status filter. */
export function rowMatchesStatusFilter(row, filter) {
    if (filter === ACTIVITIES_FILTER_NOT_STARTED || filter === ACTIVITIES_FILTER_IN_PROGRESS) {
        return row?.status?.id === filter;
    }
    return true;
}

/**
 * The text an activity is searched in: its name, its description, its
 * design's title, its case's title and its access code.
 * @param {object} row a row of `buildActivityTables`
 */
export function activitySearchText(row) {
    const activity = row?.activity;
    return normalizeSearchText([
        row?.title?.name,
        row?.title?.description,
        activityDesignTitle(activity),
        activityCaseOf(activity)?.title,
        row?.code,
    ].filter(Boolean).join(" \u0000 "));
}

/** Whether a row matches the search: every word in one of its fields. */
export function rowMatchesQuery(row, query) {
    const words = normalizeSearchText(query).split(/\s+/u).filter(Boolean);
    if (words.length === 0) {
        return true;
    }
    const text = activitySearchText(row);
    return words.every(word => text.includes(word));
}

/**
 * The rows of a tab that pass the search and, in "En curso", the status
 * filter, in their order. Another tab ignores the status filter.
 */
export function filterActivityRows(rows, tab, {
    status = ACTIVITIES_FILTER_ALL, query = "",
} = {}) {
    const filter = tabHasStatusFilter(tab) ? status : ACTIVITIES_FILTER_ALL;
    return (Array.isArray(rows) ? rows : [])
        .filter(row => rowMatchesStatusFilter(row, filter) && rowMatchesQuery(row, query));
}

/**
 * Filter → how many rows of "En curso" it lists, before the search: the chips
 * count the tab, not the search's results.
 * @returns {Record<string, number>}
 */
export function statusFilterCounts(rows) {
    const list = Array.isArray(rows) ? rows : [];
    return Object.fromEntries(ACTIVITIES_FILTERS.map(filter =>
        [filter, list.filter(row => rowMatchesStatusFilter(row, filter)).length]));
}

/**
 * The chips of "En curso", in order: each with its filter, its translation
 * key, its count when the chip shows one (else null), and whether it is the
 * active one.
 */
export function statusFilterChips(rows, activeFilter) {
    const counts = statusFilterCounts(rows);
    return ACTIVITIES_FILTERS.map(filter => ({
        id:     filter,
        key:    FILTER_KEYS[filter],
        count:  COUNTED_FILTERS.has(filter) ? counts[filter] : null,
        active: filter === activeFilter,
    }));
}

/**
 * What the footer of "En curso" says: "Mostrando n de m" and when an
 * activity can be archived, or, with the "Sin iniciar" filter, "Mostrando n
 * de m sin iniciar" and that their participants can join and wait (frame C).
 * @returns {{ showingKey: string, hintKey: string }}
 */
export function ongoingFooterKeys(filter) {
    if (filter === ACTIVITIES_FILTER_NOT_STARTED) {
        return {
            showingKey: "activities_filter_showing_not_started",
            hintKey:    "activities_filter_hint_not_started",
        };
    }
    return { showingKey: "activities_showing", hintKey: "activities_hint_ongoing" };
}

/**
 * The one-line message when the search or the filter leaves a tab with
 * activities empty, and its button's label: "Quitar filtros" in "En curso",
 * whose chips are filters too, "Quitar búsqueda" elsewhere.
 * @returns {{ messageKey: string, clearKey: string }}
 */
export function noMatchesKeys(tab) {
    if (tabHasStatusFilter(tab)) {
        return {
            messageKey: "activities_filter_no_matches",
            clearKey:   "activities_filter_clear",
        };
    }
    return {
        messageKey: "activities_search_no_matches",
        clearKey:   "activities_search_clear",
    };
}
