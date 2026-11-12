// The cached parts of a student's full state that a phase start changes, and
// their keys (#1176). Callers pass the Redis client, so this module opens no
// connection of its own.
//
// A phase start adds a row to `stages` and moves `sessions.current_stage`.
// The descriptor reports the current phase and the phase list holds the
// started phases, so both are dropped together; otherwise a page loaded
// without `invalidate` would get the new current phase and the old list, and
// show no tab for the new phase. The tasks, responses and groups are cached
// under keys that name the listed phases, so a new phase reads them anew.

import { studentActivityDescriptorCacheKey } from "./student-activity-descriptor.js";

export const STUDENT_ACTIVITY_PHASES_TTL_SECONDS = 300;
export const STUDENT_ACTIVITY_GROUPS_TTL_SECONDS = 3600;

export function studentActivityPhasesCacheKey(sessionId) {
    return `session:${Number(sessionId)}:phases:v2`;
}

/**
 * The student's groups in the listed phases. A team phase forms its groups
 * when it starts, so the key changes with the list of phases.
 * @param {number|string} sessionId
 * @param {number|string} userId
 * @param {Array<number|string>} phaseNumbers
 */
export function studentActivityGroupsCacheKey(sessionId, userId, phaseNumbers) {
    const numbers = (Array.isArray(phaseNumbers) ? phaseNumbers : [])
        .map(Number)
        .sort((a, b) => a - b)
        .join(",");
    return `session:${Number(sessionId)}:user:${Number(userId)}:groups:${numbers}`;
}

/** Drops the descriptor and the phase list of a session, in one call. */
export async function invalidatePhaseStartCachesWith(redis, sessionId) {
    await redis.del(
        studentActivityDescriptorCacheKey(sessionId),
        studentActivityPhasesCacheKey(sessionId),
    );
}
