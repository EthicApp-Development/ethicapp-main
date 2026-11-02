// The activity descriptor the student app loads with an activity's full state,
// and its cache. Callers pass the Redis client and the loader, so this module
// opens no connection of its own.

const CACHE_TTL_SECONDS = 3600;

import { sessionAiServicesEnabled } from "./session-ai-services.js";

// A finished activity has no current phase (current_stage is NULL), so the
// current phase is a left join: its descriptor is still returned, with
// currentphaseid and currentphasenumber NULL.
export const STUDENT_ACTIVITY_DESCRIPTOR_SQL = `
    SELECT
        s.descr AS description,
        s.ai_services_enabled,
        d.design AS design,
        st.number AS currentphasenumber,
        st.id AS currentphaseid
    FROM
        sessions s
    JOIN
        activity a ON s.id = a.session
    JOIN
        designs d ON d.id = a.design
    LEFT JOIN
        stages st ON st.id = s.current_stage
    WHERE
        s.id = $1;
`;

/**
 * The services the student app is given for an activity: only the effective
 * services of its session (its pinned AI service policy version, #815), and
 * none when the activity was launched with its AI services turned off (#970).
 * The student app waits for the response processing of the services it is
 * given, so with none it never shows "processing your response".
 * @param {{ ai_services_enabled?: boolean }} row the descriptor row
 * @param {number|string} sessionId
 * @param {{ initialize: Function, listUsableServices: Function,
 *          getSessionPolicyVersion: Function }} registry
 * @returns {Promise<object[]>}
 */
export async function studentUsableServices(row, sessionId, registry) {
    if (!sessionAiServicesEnabled(row)) {
        return [];
    }
    await registry.initialize();
    return registry.listUsableServices({
        policyVersion: await registry.getSessionPolicyVersion(sessionId),
    });
}

export function studentActivityDescriptorCacheKey(sessionId) {
    return `descriptor:${Number(sessionId)}:v2`;
}

// Only a descriptor with a design is worth caching; an empty one comes from a
// missing session or a failed query, and caching it would keep the failure
// for the whole TTL.
export function isCacheableStudentActivityDescriptor(result) {
    return Boolean(result?.descriptor?.design);
}

export async function getCachedStudentActivityDescriptorWith(
    { redis, load },
    sessionId,
    invalidate = false
) {
    const cacheKey = studentActivityDescriptorCacheKey(sessionId);

    if (invalidate) {
        await redis.del(cacheKey);
    } else {
        const cachedDescriptor = await redis.get(cacheKey);
        if (cachedDescriptor) {
            return JSON.parse(cachedDescriptor);
        }
    }

    const result = await load(sessionId);

    if (isCacheableStudentActivityDescriptor(result)) {
        await redis.set(cacheKey, JSON.stringify(result), "EX", CACHE_TTL_SECONDS);
    }

    return result;
}

export async function invalidateStudentActivityDescriptorWith(redis, sessionId) {
    await redis.del(studentActivityDescriptorCacheKey(sessionId));
}
