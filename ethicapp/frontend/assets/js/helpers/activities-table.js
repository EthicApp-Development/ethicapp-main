// The tables of the Activities page (#1050, epic #1046): its tabs, which
// activities each tab lists and in which order, the columns of each tab's
// table, and what each row shows: the activity's title and its case, its
// status with the "IA" mark, its participants, its code, when it was
// launched or ended, one visible action and the entries of its "⋯" menu.
//
// Plain functions over the rows of GET /activities, so the page's controller
// only wires them to the template. The status and the tab come from
// `activity-list-status.js`, the order from `activity-order.js` and the
// dates from a formatter of `activity-dates.js`.

import {
    ACTIVITY_TAB_ARCHIVED,
    ACTIVITY_TAB_FINISHED,
    ACTIVITY_TAB_ONGOING,
    ACTIVITY_TABS,
    activityListStatus,
    activityListStatusLabel,
    activityTab,
} from "./activity-list-status.js";
import { newestActivitiesFirst } from "./activity-order.js";
import { activityTitleParts, activityTitleText } from "./activity-title.js";

export { ACTIVITY_TAB_ARCHIVED, ACTIVITY_TAB_FINISHED, ACTIVITY_TAB_ONGOING, ACTIVITY_TABS };

// Rows shown before "Show more", and how many more each click adds.
export const ACTIVITIES_PAGE_SIZE = 20;

export const ROW_ACTION_OPEN_DASHBOARD = "open-dashboard";
export const ROW_ACTION_REPORTS = "reports";
export const ROW_ACTION_COPY_CODE = "copy-code";
export const ROW_ACTION_VIEW_DESIGN = "view-design";
export const ROW_ACTION_VIEW_CASE = "view-case";
export const ROW_ACTION_LAUNCH_AGAIN = "launch-again";
export const ROW_ACTION_ARCHIVE = "archive";
export const ROW_ACTION_RESTORE = "restore";

export const COLUMN_ACTIVITY = "activity";
export const COLUMN_STATUS = "status";
export const COLUMN_PARTICIPANTS = "participants";
export const COLUMN_CODE = "code";
export const COLUMN_LAUNCHED = "launched";
export const COLUMN_FINISHED = "finished";

const COLUMN_KEYS = {
    [COLUMN_ACTIVITY]:     "activities_col_activity",
    [COLUMN_STATUS]:       "activities_col_status",
    [COLUMN_PARTICIPANTS]: "activities_col_participants",
    [COLUMN_CODE]:         "activities_col_code",
    [COLUMN_LAUNCHED]:     "activities_col_launched",
    [COLUMN_FINISHED]:     "activities_col_finished",
};

// "En curso" shows the code and the launch; "Terminadas" and "Archivadas"
// share one table, with the end instead.
const TAB_COLUMNS = {
    [ACTIVITY_TAB_ONGOING]: [
        COLUMN_ACTIVITY, COLUMN_STATUS, COLUMN_PARTICIPANTS, COLUMN_CODE, COLUMN_LAUNCHED,
    ],
    [ACTIVITY_TAB_FINISHED]: [
        COLUMN_ACTIVITY, COLUMN_STATUS, COLUMN_PARTICIPANTS, COLUMN_FINISHED,
    ],
    [ACTIVITY_TAB_ARCHIVED]: [
        COLUMN_ACTIVITY, COLUMN_STATUS, COLUMN_PARTICIPANTS, COLUMN_FINISHED,
    ],
};

const ACTIONS = {
    [ROW_ACTION_OPEN_DASHBOARD]: ["activities_action_open_dashboard", "fa-solid fa-play"],
    [ROW_ACTION_REPORTS]:        ["activities_action_reports", "fa-solid fa-chart-column"],
    [ROW_ACTION_COPY_CODE]:      ["activities_action_copy_code", "fa-regular fa-copy"],
    [ROW_ACTION_VIEW_DESIGN]:    ["activities_action_view_design", "fa fa-paint-brush"],
    [ROW_ACTION_VIEW_CASE]:      ["activities_action_view_case", "fa fa-book"],
    [ROW_ACTION_LAUNCH_AGAIN]:   ["activities_action_launch_again", "fa fa-rocket"],
    [ROW_ACTION_ARCHIVE]:        ["activities_action_archive", "fa-solid fa-box-archive"],
    [ROW_ACTION_RESTORE]:        ["activities_action_restore", "fa-solid fa-rotate-left"],
};

// The "⋯" menu of each tab, in order.
const TAB_MENUS = {
    [ACTIVITY_TAB_ONGOING]: [
        ROW_ACTION_COPY_CODE, ROW_ACTION_REPORTS, ROW_ACTION_VIEW_DESIGN, ROW_ACTION_VIEW_CASE,
    ],
    [ACTIVITY_TAB_FINISHED]: [
        ROW_ACTION_OPEN_DASHBOARD, ROW_ACTION_LAUNCH_AGAIN, ROW_ACTION_VIEW_DESIGN,
        ROW_ACTION_ARCHIVE,
    ],
    [ACTIVITY_TAB_ARCHIVED]: [
        ROW_ACTION_REPORTS, ROW_ACTION_OPEN_DASHBOARD, ROW_ACTION_VIEW_DESIGN,
    ],
};

const TAB_PRIMARY = {
    [ACTIVITY_TAB_ONGOING]:  ROW_ACTION_OPEN_DASHBOARD,
    [ACTIVITY_TAB_FINISHED]: ROW_ACTION_REPORTS,
    [ACTIVITY_TAB_ARCHIVED]: ROW_ACTION_RESTORE,
};

function tabOf(tab) {
    return ACTIVITY_TABS.includes(tab) ? tab : ACTIVITY_TAB_ONGOING;
}

function countOf(value) {
    const count = Number(value);
    return Number.isSafeInteger(count) && count > 0 ? count : 0;
}

function idOf(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function cleanText(value) {
    return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/** The tab the URL asks for (`?tab=`), else "En curso". */
export function tabFromSearch(search) {
    const tab = search?.tab;
    return ACTIVITY_TABS.includes(tab) ? tab : ACTIVITY_TAB_ONGOING;
}

/** The `?tab=` value of a tab: none for "En curso", the default. */
export function tabSearchValue(tab) {
    return ACTIVITY_TABS.includes(tab) && tab !== ACTIVITY_TAB_ONGOING ? tab : null;
}

/**
 * The columns of a tab's table, each with its id and its header's key. The
 * actions' column has no header and is not listed.
 * @returns {{ id: string, key: string }[]}
 */
export function tableColumns(tab) {
    return TAB_COLUMNS[tabOf(tab)].map(id => ({ id, key: COLUMN_KEYS[id] }));
}

/**
 * The activity's case, from the design document's `associatedCase`, only
 * when it has both an id and a title. Otherwise null, read as "Sin caso".
 * The document's bare `caseId` is not trusted: it can outlive the design's
 * case (`designs.case_id` NULL with a stale `caseId` in the JSON). #1055
 * returns the case from the database instead.
 * @returns {{ id: number, title: string }|null}
 */
export function activityCaseOf(activity) {
    const associated = activity?.design?.associatedCase;
    const id = idOf(associated?.id);
    const title = cleanText(associated?.title);
    return id !== null && title ? { id, title } : null;
}

/** The title of the design the activity was launched from, "" if unknown. */
export function activityDesignTitle(activity) {
    return cleanText(activity?.design?.metainfo?.title);
}

/**
 * The line under the activity's title: the design, only when the activity's
 * name differs from it (the teacher renamed it at launch), then the case, or
 * "Sin caso". Each part is a label key and a plain text, so titles are never
 * read as translation parameters.
 * @returns {{ key: string, text: string }[]}
 */
export function activityMetaParts(activity) {
    const parts = [];
    const designTitle = activityDesignTitle(activity);
    const name = cleanText(activity?.name);
    if (designTitle && designTitle !== name) {
        parts.push({ key: "activities_meta_design", text: designTitle });
    }
    const caseInfo = activityCaseOf(activity);
    if (caseInfo) {
        parts.push({ key: "activities_meta_case", text: caseInfo.title });
    } else {
        parts.push({ key: "activities_meta_no_case", text: "" });
    }
    return parts;
}

/**
 * What the Estado column says: the status's key and values from
 * `activityListStatusLabel` (the template translates `modeKey` into the
 * `mode` value), its id ("not-started", "in-progress" or "finished"), which
 * also picks the icon and its color, and whether its AI services are on.
 */
export function statusCell(activity) {
    const listStatus = activityListStatus(activity);
    return {
        ...activityListStatusLabel(listStatus),
        id: listStatus.id,
        ai: activity?.aiServicesEnabled === true,
    };
}

/**
 * What the Participantes column says: "n participantes", or "Nadie aún"
 * when no participant has joined.
 * @returns {{ key: string, params: object, none: boolean }}
 */
export function participantsLabel(count) {
    const participants = countOf(count);
    if (participants === 0) {
        return { key: "activities_participants_none", params: {}, none: true };
    }
    return {
        key: participants === 1
            ? "activities_participants_one"
            : "activities_participants_other",
        params: { count: participants },
        none:   false,
    };
}

function rowAction(id) {
    const [key, icon] = ACTIONS[id];
    return { id, key, icon };
}

/** The row's one visible action, by tab. */
export function primaryRowAction(tab) {
    return rowAction(TAB_PRIMARY[tabOf(tab)]);
}

/**
 * The entries of the row's "⋯" menu, by tab. An entry the activity cannot
 * use is disabled with its reason: "Copiar código" without a code, "Ver
 * caso" without a case and the design's entries without a design.
 * @param {string} tab
 * @param {{ code?: string, caseId?: number|null, designId?: number|null }} [row]
 */
export function rowMenuEntries(tab, { code = "", caseId = null, designId = null } = {}) {
    const reasons = {
        [ROW_ACTION_COPY_CODE]:    code ? null : { key: "activities_menu_no_code" },
        [ROW_ACTION_VIEW_CASE]:    caseId ? null : { key: "activities_meta_no_case" },
        [ROW_ACTION_VIEW_DESIGN]:  designId ? null : { key: "activities_menu_no_design" },
        [ROW_ACTION_LAUNCH_AGAIN]: designId ? null : { key: "activities_menu_no_design" },
    };
    return TAB_MENUS[tabOf(tab)].map((id) => {
        const reason = reasons[id] || null;
        return { ...rowAction(id), disabled: reason !== null, reason };
    });
}

/**
 * When the activity was launched, for the Lanzada column: the cell's label
 * ("hoy, 18:01", "12 oct") and the full date for its hover title.
 * @param {object} activity
 * @param {ReturnType<import("./activity-dates.js").createActivityDateFormatter>} dates
 */
export function launchedCell(activity, dates) {
    return {
        label: dates.label(activity?.time) || { text: "—" },
        hint:  { text: dates.full(activity?.time) },
    };
}

/**
 * When the activity ended, for the Terminada column, with the time also for
 * older dates ("1 nov, 11:30"). An activity finished before its end time was
 * recorded (`finishedAt` null) shows "—", with its launch date on hover.
 */
export function finishedCell(activity, dates) {
    const label = dates.label(activity?.finishedAt, { withTime: true });
    if (label) {
        return { label, hint: { text: dates.full(activity.finishedAt) } };
    }
    const launched = dates.full(activity?.time);
    return {
        label: { text: "—" },
        hint:  launched
            ? { key: "activities_finished_unknown", params: { date: launched } }
            : { key: "activities_finished_unknown_no_launch", params: {} },
    };
}

/**
 * One row of a tab's table.
 * @param {object} activity a row of GET /activities
 * @param {ReturnType<import("./activity-dates.js").createActivityDateFormatter>} dates
 */
export function buildActivityRow(activity, dates) {
    const tab = activityTab(activity);
    const caseInfo = activityCaseOf(activity);
    const code = cleanText(activity?.code);
    const designId = idOf(activity?.designId);
    const caseId = caseInfo?.id ?? null;
    return {
        id:           idOf(activity?.sessionId),
        activity,
        tab,
        designId,
        caseId,
        code,
        title:        activityTitleParts(activity),
        titleText:    activityTitleText(activity),
        meta:         activityMetaParts(activity),
        status:       statusCell(activity),
        participants: participantsLabel(activity?.participantCount),
        launched:     launchedCell(activity, dates),
        finished:     finishedCell(activity, dates),
        primary:      primaryRowAction(tab),
        menu:         rowMenuEntries(tab, { code, caseId, designId }),
    };
}

/**
 * The rows of the three tabs, newest first, as the home's recent activities
 * (#918). Activities without a session id are left out: no row action could
 * reach them.
 * @param {object[]} activities the rows of GET /activities
 * @param {ReturnType<import("./activity-dates.js").createActivityDateFormatter>} dates
 * @returns {{ ongoing: object[], finished: object[], archived: object[] }}
 */
export function buildActivityTables(activities, dates) {
    const tables = {
        [ACTIVITY_TAB_ONGOING]:  [],
        [ACTIVITY_TAB_FINISHED]: [],
        [ACTIVITY_TAB_ARCHIVED]: [],
    };
    for (const activity of newestActivitiesFirst(activities)) {
        const row = buildActivityRow(activity, dates);
        if (row.id !== null) {
            tables[row.tab].push(row);
        }
    }
    return tables;
}
