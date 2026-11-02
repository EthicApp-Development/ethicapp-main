// The AI services card of the launch wizard's second step (#972, epic #965):
// which of the design's services can run in an activity launched now, whether
// the teacher may turn them off, and what the action bar says about them.
//
// The services come from GET /designs/:id/ai-services (#969), one entry per
// phase and service, `{ phaseNumber, serviceId, canRun }`. "Can run" means
// what the dashboard's launch notice means (policy, AI Additions connection,
// registered adapter); it is not a live health probe. Names come from the
// adapters' UI texts through `serviceName(id)`, null when unknown.

export const AI_SERVICES_STATE = Object.freeze({
    // The check is running.
    LOADING:     "loading",
    // The check failed: the launch keeps the server's default.
    FAILED:      "failed",
    // The design enables no AI service.
    NONE:        "none",
    // Every service can run; the switch is on.
    ALL:         "all",
    // Some services can run; the switch is on for those.
    SOME:        "some",
    // No service can run: no switch, and the "not available" notice.
    UNAVAILABLE: "unavailable",
    // The teacher turned the services off for this activity.
    OFF:         "off",
});

function serviceEntries(services, serviceName) {
    return (Array.isArray(services) ? services : [])
        .filter(entry => typeof entry?.serviceId === "string" && entry.serviceId !== "")
        .map((entry, order) => ({
            order,
            entry: {
                phaseNumber: Number(entry.phaseNumber) || 0,
                serviceId:   entry.serviceId,
                name:        serviceName(entry.serviceId) || null,
                canRun:      entry.canRun === true,
            },
        }))
        .sort((left, right) => left.entry.phaseNumber - right.entry.phaseNumber
            || left.order - right.order)
        .map(({ entry }) => entry);
}

function countDistinctServices(entries) {
    return new Set(entries.map(entry => entry.serviceId)).size;
}

function summary(key, params = {}) {
    return { key, params };
}

/**
 * What step 2 shows about the design's AI services.
 *
 * @param {{
 *   services?: Array<{ phaseNumber: number, serviceId: string, canRun: boolean }>,
 *   loading?: boolean,
 *   failed?: boolean,
 *   enabled?: boolean,
 *   serviceName?: (serviceId: string) => string|null,
 * }} input `enabled` is the switch: false turns the services off.
 * @returns {{
 *   state: string,
 *   hasSwitch: boolean,
 *   runnable: Array<{ phaseNumber: number, serviceId: string, name: string|null, canRun: true }>,
 *   blocked: Array<{ phaseNumber: number, serviceId: string, name: string|null, canRun: false }>,
 *   summary: { key: string, params: object },
 * }} `runnable` are the services that can run, `blocked` the ones that
 *   cannot, each in phase order. `summary` is the action bar's text.
 */
export function launchAiServicesView({
    services = [],
    loading = false,
    failed = false,
    enabled = true,
    serviceName = () => null,
} = {}) {
    if (loading) {
        return {
            state:     AI_SERVICES_STATE.LOADING,
            hasSwitch: false,
            runnable:  [],
            blocked:   [],
            summary:   summary("launch_wizard_ai_summary_checking"),
        };
    }
    if (failed) {
        return {
            state:     AI_SERVICES_STATE.FAILED,
            hasSwitch: false,
            runnable:  [],
            blocked:   [],
            summary:   summary("launch_wizard_ai_summary_unchecked"),
        };
    }

    const entries = serviceEntries(services, serviceName);
    const runnable = entries.filter(entry => entry.canRun);
    const blocked = entries.filter(entry => !entry.canRun);

    if (entries.length === 0) {
        return {
            state:     AI_SERVICES_STATE.NONE,
            hasSwitch: false,
            runnable,
            blocked,
            summary:   summary("launch_wizard_ai_summary_none"),
        };
    }
    if (runnable.length === 0) {
        return {
            state:     AI_SERVICES_STATE.UNAVAILABLE,
            hasSwitch: false,
            runnable,
            blocked,
            summary:   summary("launch_wizard_ai_summary_unavailable"),
        };
    }
    if (enabled === false) {
        return {
            state:     AI_SERVICES_STATE.OFF,
            hasSwitch: true,
            runnable,
            blocked,
            summary:   summary("launch_wizard_ai_summary_none"),
        };
    }

    const count = countDistinctServices(runnable);
    return {
        state:     blocked.length > 0 ? AI_SERVICES_STATE.SOME : AI_SERVICES_STATE.ALL,
        hasSwitch: true,
        runnable,
        blocked,
        summary:   summary(
            count === 1 ? "launch_wizard_ai_summary_one" : "launch_wizard_ai_summary_other",
            { count }),
    };
}

/**
 * The `aiServices` field of POST /activities for this view (#970): false only
 * when the teacher turned the services off; otherwise the field is left out
 * and the server keeps the design's services on.
 * @returns {boolean|undefined}
 */
export function launchAiServicesFlag(view) {
    return view?.state === AI_SERVICES_STATE.OFF ? false : undefined;
}
