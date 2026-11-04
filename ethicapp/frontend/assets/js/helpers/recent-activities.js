// The home's recent activities (#918, #1055): the newest few activities in
// progress or not started, then the newest few finished ones. Archived
// activities are left out. The tab of each activity is the Activities page's
// (`activity-list-status.js`).

import {
    ACTIVITY_TAB_FINISHED,
    ACTIVITY_TAB_ONGOING,
    activityTab,
} from "./activity-list-status.js";
import { newestActivitiesFirst } from "./activity-order.js";

// How many activities of each kind the home shows.
export const RECENT_ACTIVITIES_LIMIT = 3;

/**
 * The home's recent activities, the newest first.
 * @param {object[]} activities the rows of GET /activities
 * @param {number} [limit] how many of each kind
 * @returns {{ ongoing: object[], finished: object[] }}
 */
export function recentActivities(activities, limit = RECENT_ACTIVITIES_LIMIT) {
    const recent = { [ACTIVITY_TAB_ONGOING]: [], [ACTIVITY_TAB_FINISHED]: [] };
    for (const activity of newestActivitiesFirst(activities)) {
        // Archived activities have no list here.
        const list = recent[activityTab(activity)];
        if (list && list.length < limit) {
            list.push(activity);
        }
    }
    return recent;
}
