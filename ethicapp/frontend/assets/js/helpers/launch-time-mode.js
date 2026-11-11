// The "Time" card of the launch wizard's second step (#1109, epic #1105):
// how the activity enforces its phase durations. The card is shown only when
// the design has at least one phase with a duration, as the wizard's preview
// counts them (`plannedDesignDuration` in helpers/phase-duration.js); phases
// without one run untimed in any mode. The server stores the choice in
// `sessions.time_mode`, once per activity.

export const TIME_MODE = Object.freeze({
    // The teacher moves on by hand; after 00:00 the teacher's count goes on
    // below zero.
    SOFT: "soft",
    // At 00:00 the activity moves to the next phase by itself.
    HARD: "hard",
    // No clock.
    NONE: "none",
});

// Soft is preselected (epic #1105, decision of 2026-11-04).
export const DEFAULT_LAUNCH_TIME_MODE = TIME_MODE.SOFT;

// The card's options, in the order it shows them.
export const LAUNCH_TIME_MODE_OPTIONS = Object.freeze([
    {
        value:    TIME_MODE.SOFT,
        labelKey: "launch_wizard_time_soft",
        helpKey:  "launch_wizard_time_soft_help",
    },
    {
        value:    TIME_MODE.HARD,
        labelKey: "launch_wizard_time_hard",
        helpKey:  "launch_wizard_time_hard_help",
    },
    {
        value:    TIME_MODE.NONE,
        labelKey: "launch_wizard_time_none",
        helpKey:  "launch_wizard_time_none_help",
    },
].map(Object.freeze));

function countOf(value) {
    const count = Number(value);
    return Number.isSafeInteger(count) && count > 0 ? count : 0;
}

function countSummary({ totalMinutes, timedPhaseCount, phaseCount }) {
    const params = { minutes: totalMinutes, timed: timedPhaseCount, total: phaseCount };
    if (phaseCount === 1) {
        return { key: "launch_wizard_time_phases_single", params };
    }
    if (timedPhaseCount === phaseCount) {
        return { key: "launch_wizard_time_phases_all", params };
    }
    return { key: "launch_wizard_time_phases_some", params };
}

/**
 * What the card shows for a design.
 *
 * @param {{ totalMinutes: number, timedPhaseCount: number, phaseCount: number }|null|undefined}
 *        planned the design's planned duration (`plannedDesignDuration`)
 * @returns {{
 *   shown: boolean,
 *   summary: { key: string, params: object }|null,
 *   hasUntimedPhases: boolean,
 * }} `shown` is false for a design without any duration, and then
 *   `summary` is null. `summary` says how many phases have a duration and
 *   their planned total; `hasUntimedPhases` adds that the others run untimed.
 */
export function launchTimeModeView(planned) {
    const counts = {
        totalMinutes:    countOf(planned?.totalMinutes),
        timedPhaseCount: countOf(planned?.timedPhaseCount),
        phaseCount:      countOf(planned?.phaseCount),
    };
    if (counts.timedPhaseCount === 0) {
        return { shown: false, summary: null, hasUntimedPhases: false };
    }
    return {
        shown:            true,
        summary:          countSummary(counts),
        hasUntimedPhases: counts.timedPhaseCount < counts.phaseCount,
    };
}

/**
 * The `timeMode` field of POST /activities: the chosen mode when the card is
 * shown; otherwise the field is left out and the server stores "none".
 * @returns {string|undefined}
 */
export function launchTimeModeField(view, timeMode) {
    if (view?.shown !== true) {
        return undefined;
    }
    return Object.values(TIME_MODE).includes(timeMode) ? timeMode : DEFAULT_LAUNCH_TIME_MODE;
}
