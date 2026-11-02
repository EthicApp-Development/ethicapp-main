// "Used before" in the launch wizard's second step (#972, epic #965): the
// descriptions the teacher gave their latest activities, offered as chips
// under the description field, so a course or section label can be reused
// exactly with one click.
//
// A plain function over the payload of GET /activities (and the activities
// POST /activities adds to the catalog, which spell their ids in lowercase).

import { normalizeActivityDescription } from "../../../../common/modules/activity-description.js";

// How many previous descriptions are offered.
export const PREVIOUS_DESCRIPTIONS_LIMIT = 5;

function timestampOf(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? null : time;
}

function sessionIdOf(activity) {
    const id = Number(activity?.sessionId ?? activity?.sessionid);
    return Number.isFinite(id) ? id : 0;
}

/**
 * The teacher's last `limit` distinct, non-blank activity descriptions, most
 * recent first: by launch time, ties and undated activities by session id,
 * newest first, undated ones after every dated one. Each description is
 * trimmed, as the server stores it; two that differ only around their text
 * count once, the most recent spelling kept.
 *
 * @param {Array<{ description?: string, time?: string, sessionId?: number }>} activities
 * @param {number} [limit]
 * @returns {string[]}
 */
export function previousDescriptions(activities, limit = PREVIOUS_DESCRIPTIONS_LIMIT) {
    const ordered = (Array.isArray(activities) ? activities : [])
        .map(activity => ({
            description: normalizeActivityDescription(activity?.description),
            time:        timestampOf(activity?.time),
            sessionId:   sessionIdOf(activity),
        }))
        .filter(entry => entry.description !== "")
        .sort((left, right) => {
            if (left.time !== right.time) {
                if (left.time === null) {
                    return 1;
                }
                if (right.time === null) {
                    return -1;
                }
                return right.time - left.time;
            }
            return right.sessionId - left.sessionId;
        });

    const seen = new Set();
    const result = [];
    for (const { description } of ordered) {
        if (result.length >= limit) {
            break;
        }
        if (!seen.has(description)) {
            seen.add(description);
            result.push(description);
        }
    }
    return result;
}
