import externalServicesRegistry from "../services/external-services.service.js";
import { releaseUnstartedCaseAnalysis } from "./case-analyses-helper.js";

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
 * must name a usable service with the `case` scope (allowed by the current AI
 * service policy version, with a connection; #815); a value that is not a
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
    // Bounded by the current AI service policy version (#815): the author
    // may only choose services it allows.
    const availableServiceIds = await registry.getUsableServiceIdsForScope("case");
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
 * Dispatches `case-created` for the generations reserved in `case_analyses`:
 * each reserved service receives the hook under the job id of its reservation,
 * which its adapter starts before its handler settles. Without reservations
 * nothing is dispatched. Errors are logged and swallowed so adapter failures
 * never affect the request that reserved the generations.
 *
 * Once a service's dispatch settles, its reservation is released if it was not
 * started: the service has no handler, the dispatch failed, or the handler
 * failed or returned before starting it. Otherwise it would block the analysis
 * until it is stale.
 *
 * @param {Object} context - Context from buildCaseCreatedContext().
 * @param {Object} [options]
 * @param {Array<{case_id: number, service_id: string, job_id: string}>} [options.reservations] -
 *     Rows from insertRequestedCaseAnalyses() or reserveCaseAnalysisGeneration().
 * @param {Object} [options.registry] - Registry override for tests.
 * @param {Function} [options.releaseReservation] - Release override for tests.
 * @returns {Promise<Array>} Settled handler outcomes, or [] when nothing ran.
 */
export async function dispatchCaseCreatedHook(
    context,
    {
        reservations = [],
        registry = externalServicesRegistry,
        releaseReservation = releaseUnstartedCaseAnalysis,
    } = {}
) {
    // One dispatch per reservation, so each is released as soon as its own
    // handler settles rather than after the slowest one.
    const outcomes = await Promise.all(reservations.map(reservation =>
        dispatchReservation(context, reservation, { registry, releaseReservation })
    ));

    return outcomes.flat();
}

async function dispatchReservation(context, reservation, { registry, releaseReservation }) {
    const { case_id: caseId, service_id: serviceId, job_id: jobId } = reservation;
    let outcomes = [];

    try {
        outcomes = await registry.dispatchHook(CASE_CREATED_HOOK, context, {
            enabledServiceIds: [serviceId],
            jobIds:            { [serviceId]: jobId },
        });
    } catch (error) {
        console.error("[external-services] Error dispatching case-created hook.", error);
    }

    try {
        await releaseReservation({ caseId, serviceId, jobId });
    } catch (error) {
        console.error(`[external-services] Could not release the ${serviceId} reservation.`, error);
    }

    return outcomes;
}
