import externalServicesRegistry from "../services/external-services.service.js";
import { getPhaseExternalServices } from "./designs-helper.js";

// Hooks the registry must receive even when the phase enables no service, or
// its design cannot be read: they also close the phase's room jobs (#833).
const FINALIZING_HOOKS = new Set(["phase-ended"]);

/**
 * Dispatches a phase hook to the services the phase enables, each with the
 * configuration the design stores for it in that phase (#734). The design is
 * read now, so handlers see what it holds when the hook fires.
 * @param {string} hookName
 * @param {object} context hook context; `context.phaseId` selects the phase
 * @returns {Promise<PromiseSettledResult[]>} one outcome per handler run
 */
export async function dispatchPhaseHook(hookName, context, {
    registry = externalServicesRegistry,
    loadPhaseExternalServices = getPhaseExternalServices,
} = {}) {
    const finalizing = FINALIZING_HOOKS.has(hookName);
    let phaseServices;
    try {
        phaseServices = await loadPhaseExternalServices(context.phaseId);
    } catch (error) {
        if (!finalizing) {
            throw error;
        }
        console.error(`[external-services] Could not read the services of phase ${context.phaseId}; `
            + `${hookName} only closes its room jobs.`, error);
        phaseServices = { enabledServiceIds: [], configurations: {} };
    }

    const { enabledServiceIds, configurations } = phaseServices;
    if (enabledServiceIds.length === 0 && !finalizing) {
        return [];
    }

    return registry.dispatchHook(hookName, context, {
        enabledServiceIds,
        serviceConfigurations: configurations,
    });
}
