import externalServicesRegistry from "../services/external-services.service.js";
import { dispatchReservedGenerations } from "./analysis-dispatch-helper.js";
import { releaseUnstartedDesignAnalysis } from "./design-analyses-helper.js";

/**
 * Dispatch of design analyses (epic #846). Design-scoped adapters receive the
 * `design-saved` hook, which fires outside any session and therefore follows
 * the current AI service policy version (NON_SESSION_HOOKS).
 *
 * Today only an explicit regeneration (POST /designs/:id/analyses/:serviceId/
 * generate) dispatches it, for the one reserved service. Dispatching it when a
 * design is saved, and deciding which adapters apply, is #848, which reuses
 * this hook name, context and dispatch.
 */

export const DESIGN_SAVED_HOOK = "design-saved";

function toPositiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
}

/**
 * Builds the `design-saved` hook context from a `designs` row joined with its
 * case's language (`case_language_code`). `userId` is the teacher who requested
 * the generation, so the external-service job carries `user_id`; session and
 * phase columns stay NULL because no activity is in scope.
 *
 * @param {Object} designRow - `designs` row with `id`, `creator`, `case_id`,
 *     `design` and `case_language_code`.
 * @param {Object} [options]
 * @param {number} [options.userId] - Requesting user id; the creator by default.
 * @returns {Object} Hook context.
 */
export function buildDesignSavedContext(designRow, { userId } = {}) {
    return {
        designId:     toPositiveInteger(designRow?.id),
        userId:       toPositiveInteger(userId ?? designRow?.creator),
        caseId:       toPositiveInteger(designRow?.case_id),
        languageCode: designRow?.case_language_code ?? null,
        design:       designRow?.design ?? null,
    };
}

/**
 * Dispatches `design-saved` for the generations reserved in `design_analyses`
 * (reserveDesignAnalysisGeneration()): each reserved service receives the hook
 * under the job id of its reservation, and a reservation its adapter did not
 * start is released once its dispatch settles (see
 * dispatchReservedGenerations()). Errors are logged and swallowed.
 *
 * @param {Object} context - Context from buildDesignSavedContext().
 * @param {Object} [options]
 * @param {Array<{design_id: number, service_id: string, job_id: string}>} [options.reservations]
 * @param {Object} [options.registry] - Registry override for tests.
 * @param {Function} [options.releaseReservation] - Release override for tests.
 * @returns {Promise<Array>} Settled handler outcomes, or [] when nothing ran.
 */
export async function dispatchDesignSavedHook(
    context,
    {
        reservations = [],
        registry = externalServicesRegistry,
        releaseReservation = releaseUnstartedDesignAnalysis,
    } = {}
) {
    return dispatchReservedGenerations(DESIGN_SAVED_HOOK, context, {
        reservations,
        registry,
        release: ({ design_id: designId, service_id: serviceId, job_id: jobId }) =>
            releaseReservation({ designId, serviceId, jobId }),
    });
}
