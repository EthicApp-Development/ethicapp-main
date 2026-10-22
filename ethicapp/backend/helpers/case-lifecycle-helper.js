import externalServicesRegistry from "../services/external-services.service.js";

export const CASE_CREATED_HOOK = "case-created";

function toPositiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
}

// The services chosen for a new case arrive as a JSON array of service ids, like
// tag_ids. Returns null when the value is not such a list.
function parseServiceIds(value) {
    if (value === undefined || value === null || value === "") {
        return [];
    }

    let parsed = value;
    if (typeof value === "string") {
        try {
            parsed = JSON.parse(value);
        } catch {
            return null;
        }
    }

    if (!Array.isArray(parsed) || !parsed.every(id => typeof id === "string" && id.trim())) {
        return null;
    }

    return Array.from(new Set(parsed.map(id => id.trim())));
}

/**
 * Resolves the analysis services a teacher chose when creating a case. Each id
 * must name an enabled service with the `case` scope; a value that is not a
 * list of ids is invalid too.
 *
 * @param {unknown} value - The `analysisServiceIds` field of the request.
 * @param {Object} [options]
 * @param {Object} [options.registry] - Registry override for tests.
 * @returns {Promise<{serviceIds: string[], valid: boolean}>} The chosen ids.
 */
export async function resolveCaseAnalysisServiceIds(
    value,
    { registry = externalServicesRegistry } = {}
) {
    const serviceIds = parseServiceIds(value);
    if (serviceIds === null) {
        return { serviceIds: [], valid: false };
    }

    if (serviceIds.length === 0) {
        return { serviceIds, valid: true };
    }

    await registry.initialize();
    const availableServiceIds = registry.getEnabledServiceIdsForScope("case");
    return {
        serviceIds,
        valid: serviceIds.every(serviceId => availableServiceIds.includes(serviceId)),
    };
}

/**
 * Builds the `case-created` hook context from a freshly inserted `ethical_cases`
 * row. `userId` is the creator, so the external-service job carries `user_id`;
 * session/phase columns stay NULL because no activity is in scope.
 *
 * @param {Object} createdCase - Row returned by the INSERT into `ethical_cases`.
 * @param {Object} [options]
 * @param {number} [options.userId] - Creator user id.
 * @param {number|null} [options.pdfRenderJobId] - Queued PDF render job id, if any.
 * @returns {Object} Hook context.
 */
export function buildCaseCreatedContext(
    createdCase,
    { userId = null, pdfRenderJobId = null } = {}
) {
    return {
        caseId:         toPositiveInteger(createdCase?.id),
        caseUuid:       createdCase?.case_uuid ?? null,
        userId:         toPositiveInteger(userId),
        title:          createdCase?.title ?? null,
        pdfPath:        createdCase?.pdf_path ?? null,
        languageCode:   createdCase?.language_code ?? null,
        visibility:     createdCase?.visibility ?? null,
        pdfRenderJobId: pdfRenderJobId ?? null,
    };
}

/**
 * Dispatches `case-created` to the services the teacher chose for the case.
 * Without chosen services nothing is dispatched. Errors are logged and
 * swallowed so adapter failures never affect the case creation request.
 *
 * @param {Object} context - Context from buildCaseCreatedContext().
 * @param {Object} [options]
 * @param {string[]} [options.serviceIds] - Services chosen for the case.
 * @param {Object} [options.registry] - Registry override for tests.
 * @returns {Promise<Array>} Settled handler outcomes, or [] when nothing ran.
 */
export async function dispatchCaseCreatedHook(
    context,
    { serviceIds = [], registry = externalServicesRegistry } = {}
) {
    if (serviceIds.length === 0) {
        return [];
    }

    try {
        return await registry.dispatchHook(CASE_CREATED_HOOK, context, {
            enabledServiceIds: serviceIds,
        });
    } catch (error) {
        console.error("[external-services] Error dispatching case-created hook.", error);
        return [];
    }
}
