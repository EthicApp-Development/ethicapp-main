// The search and the status filters of "My cases" (#1015, epic #1008).
//
// The status chips are "All", "Ready", "In use", "Shared" and "PDF error · n",
// in that order. A case's status comes from `helpers/case-status.js`, so each
// chip lists exactly the rows whose Status column says it: "Ready" lists the
// ready cases only, not the ones whose PDF is still being processed, which
// only "All" lists. "Shared" is a flag beside the status and lists the cases
// whose sharing switch is on. "PDF error" shows only while a case has one, or
// while it is the active filter, so a filter opened from the URL can be seen.
//
// The search covers the title, the authors' names and the tags' labels,
// without accents or case: every word must appear in one of them.
//
// Both live in the URL beside the tab (`#!/cases?status=in-use&q=ética`), so
// other pages can link to a filtered list and Back from a case restores them.
//
// Plain functions over the rows of `helpers/cases-table.js`.

import {
    CASE_STATUS_IN_USE,
    CASE_STATUS_PDF_ERROR,
    CASE_STATUS_READY,
} from "./case-status.js";
import { isCaseShared } from "./cases-table.js";
import { normalizeSearchText } from "./launch-design-list.js";

export const CASES_FILTER_ALL = "all";
export const CASES_FILTER_READY = "ready";
export const CASES_FILTER_IN_USE = "in-use";
export const CASES_FILTER_SHARED = "shared";
export const CASES_FILTER_PDF_ERROR = "pdf-error";

// In the order of the chips.
export const CASES_FILTERS = [
    CASES_FILTER_ALL,
    CASES_FILTER_READY,
    CASES_FILTER_IN_USE,
    CASES_FILTER_SHARED,
    CASES_FILTER_PDF_ERROR,
];

const FILTER_KEYS = {
    [CASES_FILTER_ALL]:       "cases_filter_all",
    [CASES_FILTER_READY]:     "cases_filter_ready",
    [CASES_FILTER_IN_USE]:    "cases_filter_in_use",
    [CASES_FILTER_SHARED]:    "cases_filter_shared",
    [CASES_FILTER_PDF_ERROR]: "cases_filter_pdf_error",
};

// The chips that show their count, as "PDF error · 2".
const COUNTED_FILTERS = new Set([CASES_FILTER_PDF_ERROR]);

// The chips shown only while they list a case (or are active).
const HIDDEN_WHEN_EMPTY = new Set([CASES_FILTER_PDF_ERROR]);

// The longest search kept in the URL.
export const CASES_QUERY_MAX_LENGTH = 200;

/** The status filter the URL asks for (`?status=`), else "All". */
export function statusFilterFromSearch(search) {
    const filter = search?.status;
    return CASES_FILTERS.includes(filter) ? filter : CASES_FILTER_ALL;
}

/** The `?status=` value of a filter: none for "All", the default. */
export function statusFilterSearchValue(filter) {
    return CASES_FILTERS.includes(filter) && filter !== CASES_FILTER_ALL ? filter : null;
}

/** The search the URL asks for (`?q=`), trimmed, else "". */
export function queryFromSearch(search) {
    const query = search?.q;
    return typeof query === "string" ? query.trim().slice(0, CASES_QUERY_MAX_LENGTH) : "";
}

/** The `?q=` value of a search: none when it is blank. */
export function querySearchValue(query) {
    const value = String(query ?? "").trim().slice(0, CASES_QUERY_MAX_LENGTH);
    return value === "" ? null : value;
}

/** Whether a row of "My cases" belongs to the filter. */
export function rowMatchesStatusFilter(row, filter) {
    switch (filter) {
    case CASES_FILTER_READY:
        return row?.statusInfo?.status === CASE_STATUS_READY;
    case CASES_FILTER_IN_USE:
        return row?.statusInfo?.status === CASE_STATUS_IN_USE;
    case CASES_FILTER_PDF_ERROR:
        return row?.statusInfo?.status === CASE_STATUS_PDF_ERROR;
    case CASES_FILTER_SHARED:
        return isCaseShared(row?.caseItem);
    default:
        return true;
    }
}

function authorName(author) {
    return [author?.authorFirstname, author?.authorLastname].filter(Boolean).join(" ");
}

/** The text a case is searched in: its title, authors and tags. */
export function caseSearchText(caseItem) {
    const authors = Array.isArray(caseItem?.authors) && caseItem.authors.length > 0
        ? caseItem.authors.map(authorName)
        : [authorName(caseItem)];
    const tags = Array.isArray(caseItem?.tags) ? caseItem.tags.map(tag => tag?.label) : [];
    return normalizeSearchText([caseItem?.title, ...authors, ...tags]
        .filter(Boolean).join(" \u0000 "));
}

/** Whether a row matches the search: every word in its title, authors or tags. */
export function rowMatchesQuery(row, query) {
    const words = normalizeSearchText(query).split(/\s+/u).filter(Boolean);
    if (words.length === 0) {
        return true;
    }
    const text = caseSearchText(row?.caseItem);
    return words.every(word => text.includes(word));
}

/**
 * The rows of "My cases" that pass the filter and the search, in their order.
 */
export function filterCaseRows(rows, { status = CASES_FILTER_ALL, query = "" } = {}) {
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
    return Object.fromEntries(CASES_FILTERS.map(filter =>
        [filter, list.filter(row => rowMatchesStatusFilter(row, filter)).length]));
}

/**
 * The chips shown, in order: each with its filter, its translation key, its
 * count when the chip shows one (else null), and whether it is the active one.
 */
export function statusFilterChips(rows, activeFilter) {
    const counts = statusFilterCounts(rows);
    return CASES_FILTERS
        .filter(filter => !HIDDEN_WHEN_EMPTY.has(filter) || counts[filter] > 0 ||
            filter === activeFilter)
        .map(filter => ({
            id:     filter,
            key:    FILTER_KEYS[filter],
            count:  COUNTED_FILTERS.has(filter) ? counts[filter] : null,
            active: filter === activeFilter,
        }));
}
