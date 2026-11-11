// What the teacher's dashboard does with an `onPhaseTransition` event
// (#1116, epic #1105).
//
// The server sends it to every dashboard of the activity whenever a phase
// starts: `{ sessionId, phaseId, phaseNumber, reason }`, `reason` being
// "teacher" (a teacher's request, from this dashboard or another one) or
// "deadline" (the deadline runner of a hard-mode activity). The dashboard
// reads the phases again once per new phase:
//
// - "ignore": the event is for another activity, the activity is not loaded
//   or is finished, or the dashboard already shows that phase or a later one
//   (the teacher's own start, already read, or an event that arrived late);
// - "defer": this dashboard's own request to start the next phase is still
//   running. That request reads the phases when it ends, after which the
//   event is checked again, and is usually ignored;
// - "apply": a phase the dashboard does not know yet started.

import { isSessionEvent } from "./phase-clock-state.js";

export const TRANSITION_ACTIONS = Object.freeze({
    IGNORE: "ignore",
    DEFER:  "defer",
    APPLY:  "apply",
});

export const TRANSITION_REASONS = Object.freeze({
    TEACHER:  "teacher",
    DEADLINE: "deadline",
});

/**
 * @param {Object} event The `onPhaseTransition` payload.
 * @param {Object} context
 * @param {number|string} context.sessionId The dashboard's activity.
 * @param {Object|undefined} context.descriptor The activity descriptor the
 *   dashboard has, with `status` and `currentPhase: { id, number }`.
 * @param {boolean} context.ownStartPending Whether this dashboard's request
 *   to start the next phase is running.
 * @returns {"ignore"|"defer"|"apply"}
 */
export function phaseTransitionAction(event, { sessionId, descriptor, ownStartPending }) {
    if (!isSessionEvent(event, sessionId) || !Number(event.phaseId)) {
        return TRANSITION_ACTIONS.IGNORE;
    }
    if (!descriptor || descriptor.status === "finished") {
        return TRANSITION_ACTIONS.IGNORE;
    }
    if (ownStartPending) {
        return TRANSITION_ACTIONS.DEFER;
    }

    const current = descriptor.currentPhase;
    if (current && Number(current.id) === Number(event.phaseId)) {
        return TRANSITION_ACTIONS.IGNORE;
    }
    const eventNumber = Number(event.phaseNumber);
    if (current && Number.isFinite(eventNumber) && eventNumber <= Number(current.number)) {
        return TRANSITION_ACTIONS.IGNORE;
    }
    return TRANSITION_ACTIONS.APPLY;
}

/**
 * What the dashboard is told after reading the phases for a transition: the
 * phase the activity is at now, which may be later than the event's when
 * two phases started in a row, and the event's reason. Null when the
 * activity has no current phase.
 *
 * @param {number|string} sessionId
 * @param {Object|undefined} descriptor The descriptor read again.
 * @param {string|null} reason The event's reason; null when the change was
 *   found by reading the activity again after a reconnect.
 * @returns {{ sessionId: number, phaseId: number, phaseNumber: number,
 *   reason: string|null }|null}
 */
export function phaseTransitionNotice(sessionId, descriptor, reason) {
    const current = descriptor?.currentPhase;
    if (!current || !Number(current.id)) {
        return null;
    }
    return {
        sessionId:   Number(sessionId),
        phaseId:     Number(current.id),
        phaseNumber: Number(current.number),
        reason:      reason ?? null,
    };
}

/**
 * Whether the dashboard tells the teacher that the time ran out and the
 * next phase started: only for an advance by the deadline, never for a
 * phase a teacher started.
 *
 * @param {Object|null} notice A phaseTransitionNotice.
 * @returns {boolean}
 */
export function isDeadlineAdvance(notice) {
    return notice?.reason === TRANSITION_REASONS.DEADLINE;
}
