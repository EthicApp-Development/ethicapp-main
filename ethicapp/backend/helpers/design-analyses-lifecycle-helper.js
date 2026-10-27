import * as config from "../config/database.config.js";
import * as rpg2 from "../db/rest-pg-2.js";
import externalServicesRegistry from "../services/external-services.service.js";
import { dispatchReservedGenerations } from "./analysis-dispatch-helper.js";
import { DESIGN_HOOK_TRIGGERS, designHookForTrigger } from "./design-analysis-hooks.js";
import {
    designFingerprintSql,
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
 * `design-created` and `design-updated` hooks (#862, design-analysis-hooks.js),
 * which fire outside any session and therefore follow the current AI service
 * policy version (NON_SESSION_HOOKS).
 *
 * Two paths dispatch them:
 * - creating a design (POST /designs, or a copy by duplicate or import) and
 *   saving one (PATCH /designs/:id) request the analyses of every
 *   design-scoped adapter that applies, unless the stored analysis already
 *   covers the same input (requestDesignAnalyses(), #848). A creation sends
 *   `design-created`, a save `design-updated`;
 * - an explicit regeneration (POST /designs/:id/analyses/:serviceId/generate)
 *   requests one service's analysis whatever the stored input, and sends
 *   `design-updated` with the current design.
 */

// The triggers that request the analyses of every applicable service. An
// explicit regeneration (`generate`) requests one service's analysis instead.
const REQUEST_TRIGGERS = Object.freeze([
    DESIGN_HOOK_TRIGGERS.CREATED,
    DESIGN_HOOK_TRIGGERS.UPDATED,
]);

// Why a created or saved design requested no analysis at all.
export const DESIGN_ANALYSES_SKIPPED = Object.freeze({
    NOT_FOUND:   "not-found",
    LOCKED:      "locked",
    INVALID:     "invalid",
    NO_CASE:     "no-case",
    NO_SERVICES: "no-services",
});

// What a created or saved design did for each design-scoped service.
export const DESIGN_ANALYSIS_OUTCOMES = Object.freeze({
    REQUESTED:      "requested",
    UNCHANGED:      "unchanged",
    NOT_APPLICABLE: "not-applicable",
    DESIGN_CHANGED: "design-changed",
    ERROR:          "error",
});

function toPositiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
}

/**
 * Builds the context of a design hook (`design-created` or `design-updated`)
 * from a `designs` row joined with its case's language (`case_language_code`).
 * `trigger` says what caused the dispatch and selects the hook
 * (designHookForTrigger()). `userId` is the teacher who requested the
 * generation, so the external-service job carries `user_id`; session and phase
 * columns stay NULL because no activity is in scope. `analysis` is what the
 * adapter's designAnalysisInput() returned for this generation: its input and
 * input hash.
 *
 * @param {Object} designRow - `designs` row with `id`, `creator`, `case_id`,
 *     `design` and `case_language_code`.
 * @param {Object} options
 * @param {string} options.trigger - One of DESIGN_HOOK_TRIGGERS.
 * @param {number} [options.userId] - Requesting user id; the creator by default.
 * @param {{input: unknown, hash: string|null}|null} [options.analysis]
 * @returns {Object} Hook context.
 * @throws {TypeError} For an unknown trigger.
 */
export function buildDesignHookContext(designRow, { trigger, userId, analysis = null } = {}) {
    designHookForTrigger(trigger);

    return {
        trigger,
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
 * Dispatches the hook of `context.trigger` (`design-created` or
 * `design-updated`) for the generations reserved in `design_analyses`
 * (reserveDesignAnalysisGeneration()): each reserved service receives the hook
 * under the job id of its reservation, and a reservation its adapter did not
 * start is released once its dispatch settles (see
 * dispatchReservedGenerations()). Errors are logged and swallowed.
 *
 * @param {Object} context - Context from buildDesignHookContext().
 * @param {Object} [options]
 * @param {Array<{design_id: number, service_id: string, job_id: string}>} [options.reservations]
 * @param {Object} [options.registry] - Registry override for tests.
 * @param {Function} [options.releaseReservation] - Release override for tests.
 * @returns {Promise<Array>} Settled handler outcomes, or [] when nothing ran.
 * @throws {TypeError} For an unknown trigger, which a context from
 *     buildDesignHookContext() never has.
 */
export async function dispatchDesignHook(
    context,
    {
        reservations = [],
        registry = externalServicesRegistry,
        releaseReservation = releaseUnstartedDesignAnalysis,
    } = {}
) {
    return dispatchReservedGenerations(designHookForTrigger(context?.trigger), context, {
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
 * @param {Object} designRow - As for buildDesignHookContext().
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

/**
 * The design row a save prepares its analyses from, with the fingerprint that
 * binds their reservations to it (designSnapshotOf()).
 */
export async function readDesignForAnalyses(designId, query = rpg2.execSQL) {
    const rows = await query({
        dbcon: config.dbconnString,
        sql:   `
            SELECT d.id, d.creator, d.locked, d.case_id, d.design,
                   ${designFingerprintSql("d")} AS design_fingerprint,
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

/**
 * The snapshot a reservation is bound to: the fingerprint and case of the
 * design row its input was prepared from. The reservation is rejected when
 * the stored design no longer matches it (see reservationSql() in
 * design-analyses-helper.js).
 *
 * @param {Object} designRow - A row with `design_fingerprint` and `case_id`.
 * @returns {{fingerprint: string|null, caseId: number|null}}
 */
export function designSnapshotOf(designRow) {
    return {
        fingerprint: designRow?.design_fingerprint ?? null,
        caseId:      toPositiveInteger(designRow?.case_id),
    };
}

const defaultSaveDependencies = {
    getDesignRow: designId => readDesignForAnalyses(designId),
    loadCase:     loadDesignCase,
    registry:     externalServicesRegistry,
    reserve:      reserveDesignAnalysisForSavedInput,
    dispatch:     dispatchDesignHook,
};

async function requestServiceAnalysis(
    serviceId,
    { trigger, designRow, design, designCase, userId, deps }
) {
    const designId = Number(designRow.id);

    try {
        const analysis = await buildDesignAnalysisInput(
            deps.registry.getDesignAnalysisInputBuilder(serviceId),
            { design, designCase }
        );
        if (!analysis) {
            return { serviceId, outcome: DESIGN_ANALYSIS_OUTCOMES.NOT_APPLICABLE };
        }

        const { designChanged, reservation } = await deps.reserve({
            designId,
            serviceId,
            inputHash:      analysis.hash,
            userId,
            designSnapshot: designSnapshotOf(designRow),
        });
        // A newer save changed the design while this one prepared its input:
        // that save owns the analysis.
        if (designChanged) {
            return { serviceId, outcome: DESIGN_ANALYSIS_OUTCOMES.DESIGN_CHANGED };
        }
        if (!reservation) {
            return { serviceId, outcome: DESIGN_ANALYSIS_OUTCOMES.UNCHANGED };
        }

        await deps.dispatch(
            buildDesignHookContext(designRow, { trigger, userId, analysis }),
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
 * Requests the analyses of a design that was just created or saved (#848), as
 * stored right now. A new design (`trigger: "created"`) dispatches
 * `design-created`; a copy of a design (duplicate or import) is a new design,
 * requested after its ready analyses were copied. A saved design
 * (`trigger: "updated"`) dispatches `design-updated`.
 *
 * Nothing is requested for a locked design, a design whose document is not
 * `valid: true`, or a design without a case. Otherwise each design-scoped
 * adapter that is usable under the current policy version and exports
 * designAnalysisInput() is asked whether it applies and for its input hash.
 * A generation is reserved and the trigger's hook dispatched, unless the stored
 * analysis already covers that input hash (see
 * reserveDesignAnalysisForSavedInput()). A generation in flight for a
 * different input is superseded.
 *
 * Each reservation is bound to the design row read here
 * (designSnapshotOf()): when a newer save changes the design while this one
 * prepares its inputs, this one reserves nothing (`design-changed`), so it
 * can never supersede the newer save's generation with an older input.
 *
 * Errors of one service are logged and do not affect the others. The
 * returned promise settles when every dispatched handler has settled.
 *
 * @param {number} designId
 * @param {Object} options
 * @param {string} options.trigger - `created` or `updated` (DESIGN_HOOK_TRIGGERS).
 * @param {number} [options.userId] - The teacher who created or saved the
 *     design; the creator by default.
 * @param {Object} [options.dependencies] - Overrides for tests.
 * @returns {Promise<{skipped: string|null, services: Array<{serviceId: string,
 *     outcome: string, jobId?: string}>}>}
 * @throws {TypeError} For another trigger, before anything is read.
 */
export async function requestDesignAnalyses(
    designId,
    { trigger, userId = null, dependencies = {} } = {}
) {
    if (!REQUEST_TRIGGERS.includes(trigger)) {
        throw new TypeError(`Design analyses cannot be requested on trigger ${String(trigger)}.`);
    }

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
        { trigger, designRow, design, designCase, userId: requestUserId, deps }
    )));

    return { skipped: null, services };
}

/**
 * Runs requestDesignAnalyses() in the background, after the current request
 * has answered: creating or saving a design never waits for it, and its errors
 * are only logged.
 *
 * @param {number} designId
 * @param {Object} options - As for requestDesignAnalyses(), with its `trigger`.
 * @param {Function} [options.request] - requestDesignAnalyses() override for tests.
 */
export function scheduleDesignAnalyses(designId, options = {}) {
    const { request = requestDesignAnalyses, ...requestOptions } = options;

    setImmediate(() => {
        Promise.resolve()
            .then(() => request(designId, requestOptions))
            .catch(error => console.error(
                `[design-analyses] Could not request the analyses of design ${designId}.`,
                error
            ));
    });
}
