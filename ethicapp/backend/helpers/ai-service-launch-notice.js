import externalServicesRegistry from "../services/external-services.service.js";
import { unionEnabledServiceIds } from "./phase-external-services.js";

/**
 * The external services a design enables that will not run in an activity
 * launched under `policyVersionId` (#815): the pinned AI service policy
 * version does not allow them, no AI Additions connection is stored, or the
 * service is not registered in this installation. The teacher UI shows them
 * as a notice after launch; the launch itself never fails because of them.
 *
 * @param {{ design: object|string|null, policyVersionId: number|null }} launch
 *        the launched design (`designs.design`) and the session's pinned version.
 * @param {{ registry?: object }} [dependencies]
 * @returns {Promise<Array<{ id: string, ui: { translations: object|null } }>>}
 *          in design order; each entry carries the adapter's UI texts so the
 *          UI can name it in its language, or null without them.
 */
export async function listServicesNotRunning(
    { design, policyVersionId },
    { registry = externalServicesRegistry } = {}
) {
    const parsed = typeof design === "string" ? JSON.parse(design) : design;
    const enabledServiceIds = unionEnabledServiceIds(parsed?.phases);
    if (enabledServiceIds.length === 0) {
        return [];
    }

    await registry.initialize();
    const policyVersion = policyVersionId === null || policyVersionId === undefined
        ? null
        : await registry.getPolicyVersion(policyVersionId);
    const effective = new Set(await registry.effectiveServiceIds(enabledServiceIds, policyVersion));

    return Promise.all(enabledServiceIds
        .filter(serviceId => !effective.has(serviceId))
        .map(async serviceId => ({
            id: serviceId,
            ui: { translations: await registry.getServiceUiTranslations(serviceId) },
        })));
}
