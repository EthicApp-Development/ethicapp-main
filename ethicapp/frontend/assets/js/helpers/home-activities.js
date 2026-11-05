// The activities on the teacher's home (#1098, epic #1093): "Actividades en
// curso", the newest activities that are not finished, started or not, and
// "Terminadas recientemente", the newest finished ones. Archived activities
// are left out of both. The rows are those of the Activities page's "En
// curso" and "Terminadas" tabs (`buildActivityTables`,
// `helpers/activities-table.js`), so rows with no session id are left out
// here too, and each section's counts match the page's.
//
// Plain functions, so the home's controller only wires them to the template.

import {
    ACTIVITY_TAB_FINISHED,
    ACTIVITY_TAB_ONGOING,
    ACTIVITY_TABS,
    tabSearchValue,
} from "./activities-table.js";
import {
    ACTIVITIES_FILTER_NOT_STARTED,
    statusFilterCounts,
    statusFilterSearchValue,
} from "./activities-filters.js";

// How many rows each section shows (epic decision of 2026-11-04).
export const HOME_ONGOING_ROWS = 5;
export const HOME_FINISHED_ROWS = 3;

const ACTIVITIES_PATH = "#!/activities";

function rowsOf(tables, tab) {
    const rows = tables?.[tab];
    return Array.isArray(rows) ? rows : [];
}

/**
 * The singular or plural form of a counted key: the catalogs have no plural
 * syntax, so `home_activities_view_ongoing` is `…_one` for one activity and
 * `…_other` otherwise.
 */
export function countedKey(base, count) {
    return `${base}_${count === 1 ? "one" : "other"}`;
}

/**
 * The home's two sections, from the Activities page's tables (newest first),
 * each with its first rows, its total and the key of its "Ver las n … →"
 * link; "En curso" also counts the activities not started and gives the
 * title of its bare count link.
 *
 * `hasNoActivities` follows the Activities page: true only when all three
 * tabs are empty, so a teacher whose only activities are archived has
 * activities, and sees the one-line message in place of "En curso".
 * @param {{ ongoing?: object[], finished?: object[], archived?: object[] }} tables
 * @returns {{
 *   ongoing: { rows: object[], total: number, notStarted: number,
 *     viewAllKey: string, countTitleKey: string },
 *   finished: { rows: object[], total: number, viewAllKey: string },
 *   hasNoActivities: boolean,
 * }}
 */
export function homeActivitySections(tables) {
    const ongoing = rowsOf(tables, ACTIVITY_TAB_ONGOING);
    const finished = rowsOf(tables, ACTIVITY_TAB_FINISHED);
    const viewOngoingKey = countedKey("home_activities_view_ongoing", ongoing.length);
    return {
        ongoing: {
            rows:          ongoing.slice(0, HOME_ONGOING_ROWS),
            total:         ongoing.length,
            // As the "Sin iniciar" chip of Actividades counts them.
            notStarted:    statusFilterCounts(ongoing)[ACTIVITIES_FILTER_NOT_STARTED],
            viewAllKey:    viewOngoingKey,
            // "Ver las 53 actividades en curso"; "Ver la actividad en curso"
            // for one.
            countTitleKey: ongoing.length === 1
                ? viewOngoingKey
                : "home_activities_ongoing_count_title",
        },
        finished: {
            rows:       finished.slice(0, HOME_FINISHED_ROWS),
            total:      finished.length,
            viewAllKey: countedKey("home_activities_view_finished", finished.length),
        },
        hasNoActivities: ACTIVITY_TABS.every(tab => rowsOf(tables, tab).length === 0),
    };
}

function activitiesUrl(search) {
    const query = Object.entries(search)
        .filter(([, value]) => value !== null)
        .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
        .join("&");
    return query ? `${ACTIVITIES_PATH}?${query}` : ACTIVITIES_PATH;
}

/**
 * The links from the home to the Activities page: "En curso", its "Sin
 * iniciar" filter, and "Terminadas".
 * @returns {{ ongoing: string, notStarted: string, finished: string }}
 */
export function homeActivityLinks() {
    const notStarted = statusFilterSearchValue(ACTIVITIES_FILTER_NOT_STARTED);
    return {
        ongoing:    activitiesUrl({ tab: tabSearchValue(ACTIVITY_TAB_ONGOING) }),
        notStarted: activitiesUrl({ status: notStarted }),
        finished:   activitiesUrl({ tab: tabSearchValue(ACTIVITY_TAB_FINISHED) }),
    };
}
