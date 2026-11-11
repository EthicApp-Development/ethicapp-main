// The notice the teacher's dashboard shows when the last phase of a
// hard-mode activity runs out of time (#1116, epic #1105).
//
// A deadline never finishes an activity (decision of 2026-11-04): at 00:00
// of the last phase the server sends `onPhaseDeadlineReached { sessionId,
// phaseId, isLastPhase: true }`, and the dashboard invites the teacher to
// finish the activity with the existing button.
//
// The notice is for one deadline, `{ phaseId, endsAt }`:
// - it shows once the server says that deadline was reached, or once the
//   kept clock says it passed (a dashboard opened after 00:00);
// - it goes away when the deadline moves ("+1 min", #1112), the phase
//   changes or the activity finishes;
// - once the teacher closes it, it stays closed for that deadline; a later
//   deadline of the same phase shows it again.

import { deadlinePassed, isSessionEvent } from "./phase-clock-state.js";

/**
 * The deadline that `onPhaseDeadlineReached` reports, or null when the
 * event does not call for the notice (another activity, a phase that is not
 * the last, or a phase other than the kept clock's).
 *
 * @param {Object} event The `onPhaseDeadlineReached` payload.
 * @param {Object|null} phaseClock The kept clock (phase-clock-state.js).
 * @param {number|string} sessionId The dashboard's activity.
 * @returns {{ phaseId: number, endsAt: string|null }|null}
 */
export function reachedDeadline(event, phaseClock, sessionId) {
    if (!isSessionEvent(event, sessionId) || event.isLastPhase !== true || !Number(event.phaseId)) {
        return null;
    }
    if (phaseClock && Number(phaseClock.phaseId) !== Number(event.phaseId)) {
        return null;
    }
    return { phaseId: Number(event.phaseId), endsAt: phaseClock?.endsAt ?? null };
}

/**
 * The notice to show, or null.
 *
 * @param {Object|null} phaseClock The kept clock.
 * @param {Object} options
 * @param {number} options.localNowMs
 * @param {{ phaseId: number, endsAt: string|null }|null} [options.reached]
 *   The deadline the server reported, from reachedDeadline.
 * @param {string|null} [options.dismissedKey] The key of the notice the
 *   teacher closed.
 * @returns {{ key: string, phaseId: number, endsAt: string }|null}
 */
export function lastPhaseDeadlineNotice(phaseClock, {
    localNowMs,
    reached = null,
    dismissedKey = null,
}) {
    if (!phaseClock || phaseClock.finished === true || phaseClock.timeMode !== "hard"
        || phaseClock.isLastPhase !== true || !Number(phaseClock.phaseId) || !phaseClock.endsAt) {
        return null;
    }

    const phaseId = Number(phaseClock.phaseId);
    const endsAt = phaseClock.endsAt;
    const reportedReached = Boolean(reached) && Number(reached.phaseId) === phaseId
        && reached.endsAt === endsAt;
    if (!reportedReached && !deadlinePassed(phaseClock, localNowMs)) {
        return null;
    }

    const key = `${phaseId}|${endsAt}`;
    return key === dismissedKey ? null : { key, phaseId, endsAt };
}
