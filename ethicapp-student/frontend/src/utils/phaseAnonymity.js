// Whether a phase is anonymous for the student, so peers appear by their
// anonymous mask letter instead of their name (#1166).
//
// The backend sends the phase's flag as `features.anonymity` in full_state
// and in the initial phase state (student-activity-state-helper.js).
// `groupAnonymous` comes from GET /phases/:id/user_group/:user_id, which the
// app loads for the current phase only; the phase flag must hold without it.
export function isPhaseAnonymous(phase) {
  return phase?.features?.anonymity === true || phase?.groupAnonymous === true;
}
