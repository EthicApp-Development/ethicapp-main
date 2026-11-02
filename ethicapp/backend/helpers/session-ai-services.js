// An activity's AI services switch (#970): a teacher may launch an activity
// with its design's AI services turned off, for the whole activity, and the
// design does not change. The launch stores it in `sessions.ai_services_enabled`.
//
// The gate is where a session's services are read (designs-helper.js): with
// the switch off, the services a phase or a session enables are none. Every
// hook dispatch, the activity-finished audience and the destination check of
// a callback without a job read them there, so no service is dispatched and no
// job is created, while phase-ended and activity-finished still close the
// session's room jobs. The student app gets no usable services either
// (student-activity-state-helper.js), so it never waits for a response
// processing.

/**
 * The switch a launch request asks for: only a strict boolean `false` turns
 * the services off; anything else, absent included, keeps them on.
 * @param {unknown} aiServices `req.body.aiServices` of `POST /activities`
 * @returns {boolean} true when the activity keeps its AI services
 */
export function launchAiServicesEnabled(aiServices) {
    return aiServices !== false;
}

/**
 * The stored switch of a session row: only a stored false turns the services
 * off, so a missing row or column (an older query) keeps them on.
 * @param {{ ai_services_enabled?: boolean }|null|undefined} row
 * @returns {boolean}
 */
export function sessionAiServicesEnabled(row) {
    return row?.ai_services_enabled !== false;
}

/** The services of a phase whose session has its AI services turned off. */
export function noPhaseExternalServices() {
    return { enabledServiceIds: [], configurations: {} };
}
