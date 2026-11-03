// The status of an activity in the teacher's activities table (#1049, epic
// #1046), the tab it belongs to, and the words that say its status. Plain
// functions over the rows of GET /activities: `status` (by code or name),
// `currentPhase` ({ number, mode } or null), `phaseCount` and `archived`.
//
// The status is one of:
// - "not-started": launched, with no phase started. Its participants can join
//   and wait.
// - "in-progress": a phase is running, with its number, the number of phases
//   in the design and its mode, as the dashboard's bar shows it.
// - "finished": the teacher ended it.
//
// Rows added to the catalog by a launch, before the list is loaded again,
// carry no current phase and read as not started.

import { activityStatus, phaseModeKey } from "./activity-bar.js";

export const LIST_STATUS_NOT_STARTED = "not-started";
export const LIST_STATUS_IN_PROGRESS = "in-progress";
export const LIST_STATUS_FINISHED = "finished";

// The tabs of the page: "En curso" holds every activity that is not finished
// and not archived, started or not; "Terminadas" the finished ones that are
// not archived; "Archivadas" the archived ones.
export const ACTIVITY_TAB_ONGOING = "ongoing";
export const ACTIVITY_TAB_FINISHED = "finished";
export const ACTIVITY_TAB_ARCHIVED = "archived";

export const ACTIVITY_TABS = Object.freeze([
    ACTIVITY_TAB_ONGOING,
    ACTIVITY_TAB_FINISHED,
    ACTIVITY_TAB_ARCHIVED,
]);

const NOT_STARTED_KEY = "activities_status_not_started";
// An activity in progress whose phase is not known reads "En curso".
const IN_PROGRESS_KEY = "in_progress";
const PHASE_LABEL_KEY = "activity_bar_phase_label";
const FINISHED_KEY = "finished";

function phaseOf(activity) {
    const number = Number(activity?.currentPhase?.number);
    if (!Number.isInteger(number) || number < 1) {
        return null;
    }

    const count = Number(activity?.phaseCount);
    return {
        number,
        // A design never has fewer phases than the one running, as in the bar.
        total: Number.isInteger(count) && count > number ? count : number,
        mode:  activity.currentPhase.mode === "team" ? "team" : "individual",
    };
}

/**
 * The status of an activity in the list. `phase` is set only for an activity
 * in progress whose current phase is known.
 * @param {object} activity a row of GET /activities
 * @returns {{
 *   id: "not-started"|"in-progress"|"finished",
 *   phase: { number: number, total: number, mode: "team"|"individual" }|null,
 * }}
 */
export function activityListStatus(activity) {
    const status = activityStatus(activity?.status);
    if (status === "finished") {
        return { id: LIST_STATUS_FINISHED, phase: null };
    }

    const phase = phaseOf(activity);
    if (phase || status === "in_progress") {
        return { id: LIST_STATUS_IN_PROGRESS, phase };
    }
    return { id: LIST_STATUS_NOT_STARTED, phase: null };
}

/**
 * The tab an activity belongs to. An archived activity is in "Archivadas"
 * whatever its status.
 * @param {object} activity a row of GET /activities
 * @returns {"ongoing"|"finished"|"archived"}
 */
export function activityTab(activity) {
    if (activity?.archived === true) {
        return ACTIVITY_TAB_ARCHIVED;
    }
    return activityListStatus(activity).id === LIST_STATUS_FINISHED
        ? ACTIVITY_TAB_FINISHED
        : ACTIVITY_TAB_ONGOING;
}

/**
 * The translation key and values that say a status, from
 * `activityListStatus`. An activity in progress reads as the dashboard's bar,
 * "Fase n de m · Grupal": the caller translates `modeKey` and passes it as
 * the `mode` value of `activity_bar_phase_label`. `modeKey` is null for the
 * other statuses.
 * @param {{ id: string, phase: object|null }} listStatus
 * @returns {{ key: string, params: object, modeKey: string|null }}
 */
export function activityListStatusLabel(listStatus) {
    if (listStatus?.id === LIST_STATUS_FINISHED) {
        return { key: FINISHED_KEY, params: {}, modeKey: null };
    }
    if (listStatus?.id === LIST_STATUS_IN_PROGRESS) {
        const phase = listStatus.phase;
        if (!phase) {
            return { key: IN_PROGRESS_KEY, params: {}, modeKey: null };
        }
        return {
            key:     PHASE_LABEL_KEY,
            params:  { number: phase.number, total: phase.total },
            modeKey: phaseModeKey(phase.mode),
        };
    }
    return { key: NOT_STARTED_KEY, params: {}, modeKey: null };
}
