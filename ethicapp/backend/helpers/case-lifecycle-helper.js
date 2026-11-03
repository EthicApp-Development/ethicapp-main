import externalServicesRegistry from "../services/external-services.service.js";
import { dispatchReservedGenerations } from "./analysis-dispatch-helper.js";
import {
    insertRequestedCaseAnalyses,
    listCaseAnalyses,
    releaseUnstartedCaseAnalysis,
} from "./case-analyses-helper.js";

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
 * Resolves the analysis services a teacher chose when creating a case, or
 * later for it (POST /cases/:id/analyses, #1039). Each id
 * must name a usable service with the `case` scope (allowed by the current AI
 * service policy version, with a connection; #815); a value that is not a
 * list of ids is invalid too.
 *
 * @param {unknown} value - The `analysisServiceIds` field of the request, or
 *     the `serviceIds` of POST /cases/:id/analyses.
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
    return dispatchReservedGenerations(CASE_CREATED_HOOK, context, {
        reservations,
        registry,
        release: ({ case_id: caseId, service_id: serviceId, job_id: jobId }) =>
            releaseReservation({ caseId, serviceId, jobId }),
    });
}

/**
 * Requests services for an existing case: each one the case has not chosen
 * yet gets a row reserved for its first generation (insertRequestedCaseAnalyses),
 * and only those reservations are dispatched through `case-created`, as
 * POST /cases does. Services the case already has are left as they are, so of
 * two concurrent requests for a service one reserves and dispatches it. The
 * caller checks that the services are allowed.
 *
 * Resolves once the reservations are stored, with them and `dispatched`, the
 * promise of their settled handler outcomes. `dispatched` never rejects (a
 * failure is logged and gives []), so the caller may leave it unawaited.
 *
 * @param {Object} request
 * @param {Object} request.caseRow - The case's `ethical_cases` row (see
 *     buildCaseCreatedContext()).
 * @param {string[]} request.serviceIds - The services to request.
 * @param {number} request.userId - The teacher who requests them.
 * @param {number|null} [request.pdfRenderJobId] - The case's render job, if any.
 * @param {Object} [dependencies] - Overrides for tests.
 * @returns {Promise<{reservations: Array, dispatched: Promise<Array>}>}
 */
export async function requestCaseAnalyses(
    { caseRow, serviceIds, userId, pdfRenderJobId = null },
    {
        registry = externalServicesRegistry,
        insertRequested = insertRequestedCaseAnalyses,
        dispatch = dispatchCaseCreatedHook,
    } = {}
) {
    const caseId = toPositiveInteger(caseRow?.id);
    const reservations = await insertRequested({ caseId, serviceIds, userId });
    if (reservations.length === 0) {
        return { reservations, dispatched: Promise.resolve([]) };
    }

    const dispatched = Promise.resolve()
        .then(() => dispatch(
            buildCaseCreatedContext(caseRow, { userId, pdfRenderJobId }),
            { reservations, registry }
        ))
        .catch((error) => {
            console.error("[case-analyses] Could not dispatch the analyses of a case.", {
                caseId,
                error,
            });
            return [];
        });

    return { reservations, dispatched };
}

/**
 * Requests the analyses a copy of a case did not inherit (#1038), once the
 * copy is committed: copyReadyCaseAnalyses() gave it the source's ready
 * analyses, and each other service the source chose (requested, processing,
 * or failed without a document) is reserved for the copy's first generation,
 * with the copying teacher as requester, and dispatched through `case-created`
 * (requestCaseAnalyses). A service the current AI service policy no longer
 * allows for cases is left out, as it would be at creation. A source without
 * chosen services reserves nothing.
 *
 * Meant to be called fire-and-forget after the copy's answer: it never
 * rejects, and logs what fails instead.
 *
 * @param {Object} copy
 * @param {number} copy.sourceCaseId - The case that was copied.
 * @param {Object} copy.copiedCase - The copy's `ethical_cases` row (see
 *     buildCaseCreatedContext()).
 * @param {number} copy.userId - The teacher who made the copy.
 * @param {number|null} [copy.pdfRenderJobId] - The copy's render job, if any.
 * @param {Object} [dependencies] - Overrides for tests.
 * @returns {Promise<Array>} Settled handler outcomes, or [] when nothing ran.
 */
export async function requestCaseCopyAnalyses(
    { sourceCaseId, copiedCase, userId, pdfRenderJobId = null },
    {
        registry = externalServicesRegistry,
        listAnalyses = listCaseAnalyses,
        insertRequested = insertRequestedCaseAnalyses,
        dispatch = dispatchCaseCreatedHook,
    } = {}
) {
    const caseId = toPositiveInteger(copiedCase?.id);

    try {
        const sourceServiceIds = (await listAnalyses(sourceCaseId))
            .map(row => row.service_id);
        if (!caseId || sourceServiceIds.length === 0) {
            return [];
        }

        await registry.initialize();
        const allowed = new Set(await registry.getUsableServiceIdsForScope("case"));
        // The inherited analyses are already the copy's rows, so the insert
        // reserves only the services the copy lacks.
        const { dispatched } = await requestCaseAnalyses({
            caseRow:    copiedCase,
            serviceIds: sourceServiceIds.filter(serviceId => allowed.has(serviceId)),
            userId,
            pdfRenderJobId,
        }, { registry, insertRequested, dispatch });

        return await dispatched;
    } catch (error) {
        console.error("[case-analyses] Could not request the analyses of a case copy.", {
            sourceCaseId,
            caseId,
            error,
        });
        return [];
    }
}
