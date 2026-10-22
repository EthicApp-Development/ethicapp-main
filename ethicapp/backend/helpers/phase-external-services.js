// The external services a design phase enables and their per-phase settings
// (#729, #734). Shared by every hook dispatch site, so they all read the
// design the same way.

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function enabledIdsOf(phase) {
    const enabled = phase?.externalServices?.enabledServiceIds;
    return Array.isArray(enabled) ? enabled : [];
}

/**
 * @param {object} phase a design phase (`design.phases[n]`)
 * @returns {{ enabledServiceIds: string[], configurations: Object<string, object> }}
 *   trimmed, de-duplicated enabled ids, and a copy of the stored configuration
 *   of each enabled service that has one. Configurations of services that are
 *   not enabled are left out: they are kept in the design but ignored.
 */
export function phaseExternalServices(phase) {
    const enabledServiceIds = unionEnabledServiceIds([phase]);
    const stored = isPlainObject(phase?.externalServices?.configurations)
        ? phase.externalServices.configurations
        : {};

    const configurations = {};
    for (const serviceId of enabledServiceIds) {
        if (isPlainObject(stored[serviceId])) {
            configurations[serviceId] = { ...stored[serviceId] };
        }
    }

    return { enabledServiceIds, configurations };
}

/**
 * The union of enabled service ids across `phases`, trimmed and de-duplicated.
 * Used for `activity-finished`, which must reach every service any phase
 * enabled, whichever phase the activity ends on.
 * @param {object[]} phases the design's `phases`
 * @returns {string[]}
 */
export function unionEnabledServiceIds(phases) {
    const ids = new Set();
    for (const phase of Array.isArray(phases) ? phases : []) {
        for (const id of enabledIdsOf(phase)) {
            const trimmed = String(id).trim();
            if (trimmed) {
                ids.add(trimmed);
            }
        }
    }
    return Array.from(ids);
}
