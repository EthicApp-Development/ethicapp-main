/**
 * The hooks that carry design analyses (epic #846, #862). Both fire outside
 * any session, so they are NON_SESSION_HOOKS and follow the current AI
 * service policy version.
 *
 * - `design-created`: a new design, created with POST /designs or as a copy
 *   of another one (duplicate or import).
 * - `design-updated`: a saved design (PATCH /designs/:id), and an explicit
 *   regeneration of one analysis, which carries the current design.
 *
 * Their context carries `trigger`, what caused the dispatch (DESIGN_HOOK_TRIGGERS).
 * This module has no dependencies, so adapters can import it.
 */

export const DESIGN_CREATED_HOOK = "design-created";
export const DESIGN_UPDATED_HOOK = "design-updated";

export const DESIGN_ANALYSIS_HOOKS = Object.freeze([DESIGN_CREATED_HOOK, DESIGN_UPDATED_HOOK]);

export const DESIGN_HOOK_TRIGGERS = Object.freeze({
    CREATED:  "created",
    UPDATED:  "updated",
    GENERATE: "generate",
});

const HOOK_BY_TRIGGER = Object.freeze({
    [DESIGN_HOOK_TRIGGERS.CREATED]:  DESIGN_CREATED_HOOK,
    [DESIGN_HOOK_TRIGGERS.UPDATED]:  DESIGN_UPDATED_HOOK,
    [DESIGN_HOOK_TRIGGERS.GENERATE]: DESIGN_UPDATED_HOOK,
});

/**
 * The hook a trigger dispatches: `design-created` for `created`,
 * `design-updated` for `updated` and `generate`.
 *
 * @param {string} trigger - One of DESIGN_HOOK_TRIGGERS.
 * @returns {string}
 * @throws {TypeError} For an unknown trigger.
 */
export function designHookForTrigger(trigger) {
    if (!Object.hasOwn(HOOK_BY_TRIGGER, trigger)) {
        throw new TypeError(`Unknown design hook trigger: ${String(trigger)}.`);
    }

    return HOOK_BY_TRIGGER[trigger];
}
