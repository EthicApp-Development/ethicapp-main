import * as StatusCodes from "../../common/modules/session-status.js";

/**
 * Decides whether the `activity-started` lifecycle hook should fire for a phase
 * transition.
 *
 * Starting a phase (`POST /activities/:id/phases/next`, phase-start-helper.js)
 * always moves the session into `in_progress`, so the hook must fire only when
 * the session is *entering* that state (its first phase) — i.e. when its
 * previous status was not already `in_progress`. This keeps `activity-started`
 * from firing on ordinary phase-to-phase advances.
 *
 * A null/unknown previous status (e.g. a freshly initiated session) counts as
 * "not in progress", so the hook fires.
 *
 * @param {number|null} previousStatus - The session status before the transition.
 * @returns {boolean} True when `activity-started` should be dispatched.
 */
export function shouldDispatchActivityStarted(previousStatus) {
    const inProgress = StatusCodes.getStatusCode("in_progress");
    return previousStatus !== inProgress;
}

// Kept here for existing importers; the implementation is shared with the
// phase hook dispatch (#734).
export { unionEnabledServiceIds } from "./phase-external-services.js";
