import externalServicesRegistry from "../services/external-services.service.js";
import { getPhaseExternalServices } from "./designs-helper.js";

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
    const { enabledServiceIds, configurations } = await loadPhaseExternalServices(context.phaseId);
    if (enabledServiceIds.length === 0) {
        return [];
    }

    return registry.dispatchHook(hookName, context, {
        enabledServiceIds,
        serviceConfigurations: configurations,
    });
}
