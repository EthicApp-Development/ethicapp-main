import * as config from "../config/database.config.js";
import * as rpg2 from "../db/rest-pg-2.js";
import externalServicesRegistry from "../services/external-services.service.js";
import { dispatchReservedGenerations } from "./analysis-dispatch-helper.js";
import {
    releaseUnstartedDesignAnalysis,
    reserveDesignAnalysisForSavedInput,
} from "./design-analyses-helper.js";
import {
    buildDesignAnalysisInput,
    loadDesignCase,
    parseDesignDocument,
} from "./design-analysis-input-helper.js";

/**
 * Dispatch of design analyses (epic #846). Design-scoped adapters receive the
 * `design-saved` hook, which fires outside any session and therefore follows
 * the current AI service policy version (NON_SESSION_HOOKS).
 *
 * Two paths dispatch it:
 * - saving a design (PATCH /designs/:id) and creating a copy of one
 *   (duplicate or import) request the analyses of every design-scoped adapter
 *   that applies, unless the stored analysis already covers the same input
 *   (requestDesignAnalysesOnSave(), #848);
 * - an explicit regeneration (POST /designs/:id/analyses/:serviceId/generate)
 *   requests one service's analysis whatever the stored input.
 */

export const DESIGN_SAVED_HOOK = "design-saved";

// Why a saved design requested no analysis at all.
export const DESIGN_ANALYSES_SKIPPED = Object.freeze({
    NOT_FOUND:   "not-found",
    LOCKED:      "locked",
    INVALID:     "invalid",
    NO_CASE:     "no-case",
    NO_SERVICES: "no-services",
});

// What a saved design did for each design-scoped service.
export const DESIGN_ANALYSIS_OUTCOMES = Object.freeze({
    REQUESTED:      "requested",
    UNCHANGED:      "unchanged",
    NOT_APPLICABLE: "not-applicable",
    ERROR:          "error",
});

function toPositiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
}

/**
 * Builds the `design-saved` hook context from a `designs` row joined with its
 * case's language (`case_language_code`). `userId` is the teacher who requested
 * the generation, so the external-service job carries `user_id`; session and
 * phase columns stay NULL because no activity is in scope. `analysis` is what
 * the adapter's designAnalysisInput() returned for this generation: its input
 * and input hash.
 *
 * @param {Object} designRow - `designs` row with `id`, `creator`, `case_id`,
 *     `design` and `case_language_code`.
 * @param {Object} [options]
 * @param {number} [options.userId] - Requesting user id; the creator by default.
 * @param {{input: unknown, hash: string|null}|null} [options.analysis]
 * @returns {Object} Hook context.
 */
export function buildDesignSavedContext(designRow, { userId, analysis = null } = {}) {
    return {
        designId:      toPositiveInteger(designRow?.id),
        userId:        toPositiveInteger(userId ?? designRow?.creator),
        caseId:        toPositiveInteger(designRow?.case_id),
        languageCode:  designRow?.case_language_code ?? null,
        design:        parseDesignDocument(designRow?.design),
        analysisInput: analysis?.input ?? null,
        inputHash:     analysis?.hash ?? null,
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

/**
 * The input of one service's analysis of a design, from its adapter's
 * designAnalysisInput() (see design-analysis-input-helper.js).
 *
 * @param {Object} designRow - As for buildDesignSavedContext().
 * @param {string} serviceId
 * @param {Object} [options]
 * @param {Object} [options.registry] - Registry override for tests.
 * @param {Function} [options.loadCase] - loadDesignCase() override for tests.
 * @returns {Promise<{input: unknown, hash: string|null}|null>} null when the
 *     adapter does not apply to the design; `{ input: null, hash: null }`
 *     when the adapter exports no designAnalysisInput().
 */
export async function resolveDesignAnalysisInput(
    designRow,
    serviceId,
    { registry = externalServicesRegistry, loadCase = loadDesignCase } = {}
) {
    await registry.initialize();
    const buildInput = registry.getDesignAnalysisInputBuilder(serviceId);
    if (!buildInput) {
        return { input: null, hash: null };
    }

    return buildDesignAnalysisInput(buildInput, {
        design:     parseDesignDocument(designRow?.design),
        designCase: await loadCase(designRow?.case_id ?? null),
    });
}

async function getDesignRow(designId) {
    const rows = await rpg2.execSQL({
        dbcon: config.dbconnString,
        sql:   `
            SELECT d.id, d.creator, d.locked, d.case_id, d.design,
                   c.language_code AS case_language_code
            FROM designs AS d
            LEFT JOIN ethical_cases AS c
                ON c.id = d.case_id
            WHERE d.id = $1;
        `,
        sqlParams: [designId],
    });

    return rows[0] || null;
}

const defaultSaveDependencies = {
    getDesignRow,
    loadCase: loadDesignCase,
    registry: externalServicesRegistry,
    reserve:  reserveDesignAnalysisForSavedInput,
    dispatch: dispatchDesignSavedHook,
};

async function requestServiceAnalysis(serviceId, { designRow, design, designCase, userId, deps }) {
    const designId = Number(designRow.id);

    try {
        const analysis = await buildDesignAnalysisInput(
            deps.registry.getDesignAnalysisInputBuilder(serviceId),
            { design, designCase }
        );
        if (!analysis) {
            return { serviceId, outcome: DESIGN_ANALYSIS_OUTCOMES.NOT_APPLICABLE };
        }

        const reservation = await deps.reserve({
            designId,
            serviceId,
            inputHash: analysis.hash,
            userId,
        });
        if (!reservation) {
            return { serviceId, outcome: DESIGN_ANALYSIS_OUTCOMES.UNCHANGED };
        }

        await deps.dispatch(
            buildDesignSavedContext(designRow, { userId, analysis }),
            { reservations: [reservation] }
        );
        return {
            serviceId,
            outcome: DESIGN_ANALYSIS_OUTCOMES.REQUESTED,
            jobId:   reservation.job_id,
        };
    } catch (error) {
        console.error(
            `[design-analyses] Could not request the ${serviceId} analysis of design ${designId}.`,
            error
        );
        return { serviceId, outcome: DESIGN_ANALYSIS_OUTCOMES.ERROR };
    }
}

/**
 * Requests the analyses of a saved design (#848), as stored right now. Also
 * used for a new copy of a design, after its ready analyses were copied.
 *
 * Nothing is requested for a locked design, a design whose document is not
 * `valid: true`, or a design without a case. Otherwise each design-scoped
 * adapter that is usable under the current policy version and exports
 * designAnalysisInput() is asked whether it applies and for its input hash.
 * A generation is reserved and `design-saved` dispatched, unless the stored
 * analysis already covers that input hash (see
 * reserveDesignAnalysisForSavedInput()). A generation in flight for a
 * different input is superseded.
 *
 * Errors of one service are logged and do not affect the others. The
 * returned promise settles when every dispatched handler has settled.
 *
 * @param {number} designId
 * @param {Object} [options]
 * @param {number} [options.userId] - The teacher who saved; the creator by default.
 * @param {Object} [options.dependencies] - Overrides for tests.
 * @returns {Promise<{skipped: string|null, services: Array<{serviceId: string,
 *     outcome: string, jobId?: string}>}>}
 */
export async function requestDesignAnalysesOnSave(
    designId,
    { userId = null, dependencies = {} } = {}
) {
    const deps = { ...defaultSaveDependencies, ...dependencies };
    const skipped = reason => ({ skipped: reason, services: [] });

    const designRow = await deps.getDesignRow(designId);
    if (!designRow) {
        return skipped(DESIGN_ANALYSES_SKIPPED.NOT_FOUND);
    }
    if (designRow.locked === true) {
        return skipped(DESIGN_ANALYSES_SKIPPED.LOCKED);
    }

    const design = parseDesignDocument(designRow.design);
    if (design?.valid !== true) {
        return skipped(DESIGN_ANALYSES_SKIPPED.INVALID);
    }
    if (!designRow.case_id) {
        return skipped(DESIGN_ANALYSES_SKIPPED.NO_CASE);
    }

    await deps.registry.initialize();
    const serviceIds = (await deps.registry.getUsableServiceIdsForScope("design"))
        .filter(serviceId => deps.registry.getDesignAnalysisInputBuilder(serviceId));
    if (serviceIds.length === 0) {
        return skipped(DESIGN_ANALYSES_SKIPPED.NO_SERVICES);
    }

    const designCase = await deps.loadCase(designRow.case_id);
    if (!designCase) {
        return skipped(DESIGN_ANALYSES_SKIPPED.NO_CASE);
    }

    const requestUserId = toPositiveInteger(userId ?? designRow.creator);
    const services = await Promise.all(serviceIds.map(serviceId => requestServiceAnalysis(
        serviceId,
        { designRow, design, designCase, userId: requestUserId, deps }
    )));

    return { skipped: null, services };
}

/**
 * Runs requestDesignAnalysesOnSave() in the background, after the current
 * request has answered: saving never waits for it, and its errors are only
 * logged.
 *
 * @param {number} designId
 * @param {Object} [options] - As for requestDesignAnalysesOnSave().
 * @param {Function} [options.request] - requestDesignAnalysesOnSave() override for tests.
 */
export function scheduleDesignAnalysesOnSave(designId, options = {}) {
    const { request = requestDesignAnalysesOnSave, ...requestOptions } = options;

    setImmediate(() => {
        Promise.resolve()
            .then(() => request(designId, requestOptions))
            .catch(error => console.error(
                `[design-analyses] Could not request the analyses of design ${designId}.`,
                error
            ));
    });
}
