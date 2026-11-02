// Fields the design list adds to each design for the launch wizard (#967,
// epic #965): when the design was created and whether it uses AI services.

import { unionEnabledServiceIds } from "./phase-external-services.js";

/**
 * @param {Date|string|null|undefined} value `designs.created_at`, which pg
 *   reads as a Date; null for designs created before the column existed.
 * @returns {string|null} an ISO 8601 string, or null when unknown or invalid.
 */
export function designCreatedAt(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * @param {object} design the design document (`designs.design`)
 * @returns {boolean} true when some phase enables an external (AI) service.
 */
export function designUsesAiServices(design) {
    return unionEnabledServiceIds(design?.phases).length > 0;
}
