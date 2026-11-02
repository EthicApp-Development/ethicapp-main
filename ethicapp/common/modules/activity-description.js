// The activity's description (#968, epic #965). The activity's name is the
// design's title, so the description is what tells apart activities launched
// from the same design: a launch requires one. The server and the teacher's
// launch page share this rule.
//
// This module imports nothing.

/** The description as stored: trimmed, or "" when it is not a string. */
export function normalizeActivityDescription(value) {
    return typeof value === "string" ? value.trim() : "";
}

/** Whether `value` is a usable description: a string that is not blank. */
export function isActivityDescriptionValid(value) {
    return normalizeActivityDescription(value) !== "";
}
