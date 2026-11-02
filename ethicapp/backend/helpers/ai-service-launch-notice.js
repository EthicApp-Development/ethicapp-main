import externalServicesRegistry from "../services/external-services.service.js";
import { phaseExternalServices, unionEnabledServiceIds } from "./phase-external-services.js";

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

/**
 * The AI services a design enables, phase by phase, and whether each can run
 * in an activity launched now (#969): it applies listServicesNotRunning's
 * rules under the version a launch would pin at this moment, the current one
 * (the highest id, as `current_ai_service_policy_version_id()` in the launch
 * transaction). The launch wizard checks them before the launch; it is not a
 * live health probe of the remote service (#642).
 *
 * A service enabled in several phases is listed once per phase. Only ids are
 * returned: the client names services from GET /external-services.
 *
 * @param {object|string|null} design the design document (`designs.design`).
 * @param {{ registry?: object }} [dependencies]
 * @returns {Promise<Array<{ phaseNumber: number, serviceId: string, canRun: boolean }>>}
 *          in phase order, then in the phase's order; empty when the design
 *          enables no service. Phase numbers start at 1, as `stages.number`.
 */
export async function checkDesignServicesBeforeLaunch(
    design,
    { registry = externalServicesRegistry } = {}
) {
    const parsed = typeof design === "string" ? JSON.parse(design) : design;
    const phases = Array.isArray(parsed?.phases) ? parsed.phases : [];
    const enabledByPhase = phases.map(phase => phaseExternalServices(phase).enabledServiceIds);
    if (enabledByPhase.every(serviceIds => serviceIds.length === 0)) {
        return [];
    }

    await registry.initialize();
    const currentVersion = await registry.getCurrentPolicyVersion();
    const notRunning = await listServicesNotRunning({
        design:          parsed,
        policyVersionId: currentVersion?.id ?? null,
    }, { registry });
    const notRunningIds = new Set(notRunning.map(({ id }) => id));

    return enabledByPhase.flatMap((serviceIds, index) => serviceIds.map(serviceId => ({
        phaseNumber: index + 1,
        serviceId,
        canRun:      !notRunningIds.has(serviceId),
    })));
}

/**
 * The launch notice of `POST /activities`: the services that will not run
 * (listServicesNotRunning), or none when the activity was launched with its AI
 * services turned off (#970), since then no service runs by the teacher's
 * choice. A failure here never fails the launch: the notice is then empty.
 *
 * @param {{ design: object|string|null, policyVersionId: number|null,
 *          aiServicesEnabled: boolean }} launch
 * @param {{ list?: typeof listServicesNotRunning, logger?: { error: Function } }} [dependencies]
 * @returns {Promise<Array<{ id: string, ui: { translations: object|null } }>>}
 */
export async function servicesNotRunningAtLaunch(
    { design, policyVersionId, aiServicesEnabled },
    { list = listServicesNotRunning, logger = console } = {}
) {
    if (aiServicesEnabled === false) {
        return [];
    }
    try {
        return await list({ design, policyVersionId });
    } catch (error) {
        logger.error("[external-services] Could not list the services that will not run.", error);
        return [];
    }
}
