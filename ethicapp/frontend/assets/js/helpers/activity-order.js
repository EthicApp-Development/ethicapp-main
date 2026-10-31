// The order of the teacher's activities (#918): the newest first, in the
// activity lists and in the home's "Recent Activities". An activity launched
// in this tab is appended to the catalog, so the order is applied here and not
// left to the order the server sent.

function launchTime(activity) {
    const time = Date.parse(activity?.time);
    return Number.isNaN(time) ? -Infinity : time;
}

/**
 * A copy of the activities, the newest first. Activities launched at the same
 * time keep the most recent session first; those without a valid time go last.
 */
export function newestActivitiesFirst(activities) {
    if (!Array.isArray(activities)) {
        return [];
    }
    return activities.slice().sort((left, right) => {
        return launchTime(right) - launchTime(left)
            || Number(right?.sessionId || 0) - Number(left?.sessionId || 0);
    });
}
