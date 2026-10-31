// What the activity bar of the teacher's dashboard shows about a running
// activity (#893, epic #892): its status, its current phase and how many
// students joined. Plain functions over the activity descriptor that
// GET /activities/:id/descriptor returns and the session's user list.

import * as StatusCode from "../../../../common/modules/session-status.js";

export const ACTIVITY_STATUSES = Object.freeze(["initiated", "in_progress", "finished"]);

// The translation key of each phase mode in the bar's phase chip.
const PHASE_MODE_KEYS = Object.freeze({
    team:       "activity_bar_phase_mode_team",
    individual: "activity_bar_phase_mode_individual",
});

// The role of students in `users.role`.
const STUDENT_ROLE = "A";

// The activity's status name ("initiated", "in_progress" or "finished"), from
// the descriptor's status, given by name or by code. `isFinished` wins: the
// dashboard marks the activity finished as soon as the teacher ends it,
// before the descriptor is read again. Null when the status is unknown.
export function activityStatus(status, isFinished = false) {
    if (isFinished) {
        return "finished";
    }
    if (status === null || status === undefined || status === "") {
        return null;
    }

    const code = Number(status);
    const name = Number.isInteger(code) ? StatusCode.getNameByCode(code) : String(status);
    return ACTIVITY_STATUSES.includes(name) ? name : null;
}

// The current phase for the bar's phase chip: its number, the number of
// phases in the design and the translation key of its mode. Null before the
// first phase starts, or while the design is not loaded yet.
export function currentPhaseSummary(descriptor, totalPhases) {
    const currentPhase = descriptor?.currentPhase;
    const number = Number(currentPhase?.number);
    const total = Number(totalPhases);

    if (!Number.isInteger(number) || number < 1 || !Number.isInteger(total) || total < 1) {
        return null;
    }

    // The current phase is the last one in `phases`; its entry carries the mode.
    const phase = descriptor.phases?.find(item => Number(item?.id) === Number(currentPhase.id))
        || currentPhase;
    const mode = phase?.mode === "team" ? "team" : "individual";

    return {
        number,
        total:   Math.max(total, number),
        modeKey: PHASE_MODE_KEYS[mode],
    };
}

// How many students joined the session. Users without a role come from a
// join announcement, which defaults to students.
export function connectedStudentCount(users) {
    if (!Array.isArray(users)) {
        return 0;
    }

    return users.filter(user => !user?.role || user.role === STUDENT_ROLE).length;
}
