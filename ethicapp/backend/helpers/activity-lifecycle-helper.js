import * as StatusCodes from "../../common/modules/session-status.js";

/**
 * Decides whether the `activity-started` lifecycle hook should fire for a phase
 * transition.
 *
 * The `/phase_transition` route always moves the session into `in_progress`, so
 * the hook must fire only when the session is *entering* that state (its first
 * phase) — i.e. when its previous status was not already `in_progress`. This
 * keeps `activity-started` from firing on ordinary phase-to-phase advances.
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

/**
 * Collects the union of enabled external-service ids across every phase of an
 * activity design.
 *
 * This is the resolution used for the `activity-finished` cleanup hook: a service
 * enabled in *any* phase must be notified when the activity ends, regardless of
 * which phase it finishes on, so no provider-side state (e.g. open chat rooms)
 * can leak past the end of the activity.
 *
 * @param {Array<Object>} phases - The design's `phases` array.
 * @returns {string[]} De-duplicated, trimmed list of enabled service ids.
 */
export function unionEnabledServiceIds(phases) {
    const ids = new Set();

    if (!Array.isArray(phases)) {
        return [];
    }

    for (const phase of phases) {
        const enabled = phase?.externalServices?.enabledServiceIds;
        if (!Array.isArray(enabled)) {
            continue;
        }
        for (const id of enabled) {
            const trimmed = String(id).trim();
            if (trimmed) {
                ids.add(trimmed);
            }
        }
    }

    return Array.from(ids);
}
