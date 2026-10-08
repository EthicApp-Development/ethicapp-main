import externalServicesRegistry from "../services/external-services.service.js";

export const CASE_CREATED_HOOK = "case-created";

function toPositiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
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
 * Dispatches `case-created` to the services that opted into it through
 * `globalHooks` in the manifest. Errors are logged and swallowed so adapter
 * failures never affect the case creation request.
 *
 * @param {Object} context - Context from buildCaseCreatedContext().
 * @param {Object} [options]
 * @param {Object} [options.registry] - Registry override for tests.
 * @returns {Promise<Array>} Settled handler outcomes, or [] on failure.
 */
export async function dispatchCaseCreatedHook(
    context,
    { registry = externalServicesRegistry } = {}
) {
    try {
        return await registry.dispatchGlobalHook(CASE_CREATED_HOOK, context);
    } catch (error) {
        console.error("[external-services] Error dispatching case-created hook.", error);
        return [];
    }
}
