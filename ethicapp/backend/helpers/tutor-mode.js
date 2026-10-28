import { getCaseAnalysis } from "./case-analyses-helper.js";
import { getDesignAnalysis } from "./design-analyses-helper.js";
import { phaseExternalServices } from "./phase-external-services.js";
import {
    CLAIM_TYPOLOGY_SERVICE_ID,
    EVIDENCE_INVENTORY_SERVICE_ID,
    findQuestionTypology,
    isEvidenceInventory,
    toTutorClaimTypology,
    TYPOLOGY_ABSENT_REASONS,
} from "./tutor-claim-typology.js";

/**
 * The mode of an Argumentation Tutor session (#865, epic #861): the one rule
 * that decides it, shared by tutor session creation
 * (adapters/ats-feedback.adapter.js) and the design view
 * (helpers/design-analysis-view.js), so the rule exists once.
 *
 * A tutor question runs in the enhanced mode when
 *
 * - the case's `case-analyst-evidence-inventory` analysis has a document, and
 * - the design's `case-analyst-claim-typology` analysis has a typology for the
 *   question whose `questionTextHash` matches the question text,
 *
 * and both adapters are usable under the AI service policy, including their
 * per-adapter switches (#864). The session then receives both as
 * `case_context` (tutor-case-context/v1, ethicapp-ai-additions#209).
 * Otherwise it runs in the basic mode, receives no context, and the reason is
 * the first that applies, in this order:
 *
 *  1. `inventory-disabled`: the evidence inventory adapter is switched off or
 *     not usable;
 *  2. `inventory-failed`: the case has no inventory because its generation
 *     failed or never answered (or the inventory could not be read);
 *  3. `no-inventory`: the case has no inventory;
 *  4. `typology-disabled`: the claim typology adapter is switched off or not
 *     usable;
 *  5. `typology-pending`: the question has no usable typology and a
 *     generation is in flight;
 *  6. `typology-failed`: the question has no usable typology and the latest
 *     generation failed or never answered (or the typology could not be read
 *     or used);
 *  7. `typology-out-of-date`: the question's typology answers another text;
 *  8. `no-typology`: the question has no typology.
 *
 * The inventory comes first: a case without one cannot use the enhanced mode
 * whatever its typologies, and case analyses are chosen only when the case is
 * created. Two more reasons are known only when the session is created, from
 * the tutor's answer: `tutor-unsupported` (a tutor that predates #209 ignored
 * the context) and `context-rejected` (the tutor answered 400 about it, or
 * created the session in the basic mode anyway). A session keeps its mode.
 *
 * The teacher chooses the requested mode per phase (#870): the tutor's
 * `evaluation_mode` setting in `phase.externalServices.configurations`
 * (ethicapp-ai-additions#211), `enhanced` by default. `enhanced` follows the
 * rule above. `basic` runs basic on purpose, before any other reason
 * (`basic-selected`): the session receives no context, and the phase's
 * questions need no claim typology (tutorNeedsDesignAnalysis()). The
 * requested mode is sent to the tutor as `evaluation_mode` only when its
 * capability descriptor declares the field, so an older tutor keeps working.
 */

// The tutor's catalog id, which design phases enable.
export const ARGUMENTATION_TUTOR_SERVICE_ID = "argumentation-tutor-system";

export const TUTOR_CASE_CONTEXT_SCHEMA = "tutor-case-context/v1";

export const TUTOR_MODES = Object.freeze({
    ENHANCED: "enhanced",
    BASIC:    "basic",
});

export const TUTOR_MODE_REASONS = Object.freeze({
    BASIC_SELECTED:       "basic-selected",
    INVENTORY_DISABLED:   "inventory-disabled",
    INVENTORY_FAILED:     "inventory-failed",
    NO_INVENTORY:         "no-inventory",
    TYPOLOGY_DISABLED:    "typology-disabled",
    TYPOLOGY_PENDING:     "typology-pending",
    TYPOLOGY_FAILED:      "typology-failed",
    TYPOLOGY_OUT_OF_DATE: "typology-out-of-date",
    NO_TYPOLOGY:          "no-typology",
    TUTOR_UNSUPPORTED:    "tutor-unsupported",
    CONTEXT_REJECTED:     "context-rejected",
});

// The tutor's instance configuration field that requests a mode (#870,
// ethicapp-ai-additions#211), and the mode a phase requests without a stored
// value: the descriptor's default.
export const EVALUATION_MODE_FIELD = "evaluation_mode";
export const DEFAULT_REQUESTED_TUTOR_MODE = TUTOR_MODES.ENHANCED;

const REQUESTED_MODES = new Set(Object.values(TUTOR_MODES));

/**
 * The mode a phase's tutor configuration requests (#870): its
 * `evaluation_mode`, compared as the tutor compares it (trimmed,
 * case-insensitive), else DEFAULT_REQUESTED_TUTOR_MODE. Saving a design
 * rejects other values, so an unset value is the usual alternative.
 *
 * @param {Object|null} configuration - The phase's stored configuration of
 *     the tutor (`configurations["argumentation-tutor-system"]`), or a hook
 *     context's `serviceConfiguration`.
 * @returns {"enhanced"|"basic"}
 */
export function requestedTutorMode(configuration) {
    const value = configuration?.[EVALUATION_MODE_FIELD];
    const mode = typeof value === "string" ? value.trim().toLowerCase() : "";
    return REQUESTED_MODES.has(mode) ? mode : DEFAULT_REQUESTED_TUTOR_MODE;
}

/** The mode a design phase requests of the tutor (#870). See requestedTutorMode(). */
export function phaseRequestedTutorMode(phase) {
    return requestedTutorMode(
        phaseExternalServices(phase).configurations[ARGUMENTATION_TUTOR_SERVICE_ID] ?? null
    );
}

/**
 * Whether the tutor needs a design analysis it consumes, in a phase with this
 * configuration (#870): only phases that request the enhanced mode use the
 * claim typology. The adapter exports it as needsDesignAnalysis(), which the
 * registry consults when a producer selects its units
 * (helpers/design-analysis-units.js).
 *
 * @param {{configuration?: Object|null}} args
 * @returns {boolean}
 */
export function tutorNeedsDesignAnalysis({ configuration = null } = {}) {
    return requestedTutorMode(configuration) === TUTOR_MODES.ENHANCED;
}

const IN_FLIGHT_STATUSES = new Set(["requested", "processing"]);

const GENERATION = Object.freeze({
    IN_FLIGHT: "in-flight",
    FAILED:    "failed",
    SETTLED:   "settled",
});

// Where an analysis row's latest generation stands. A generation that is
// stale (analyses-store-helper.js) never answered, which counts as failed.
function generationOf(row) {
    if (!row) {
        return null;
    }
    if (IN_FLIGHT_STATUSES.has(row.status)) {
        return row.is_stale === true ? GENERATION.FAILED : GENERATION.IN_FLIGHT;
    }
    return row.status === "failed" ? GENERATION.FAILED : GENERATION.SETTLED;
}

function basic(reason, request) {
    return { mode: TUTOR_MODES.BASIC, reason, caseContext: null, ...request };
}

function inventoryPart(inventory) {
    const R = TUTOR_MODE_REASONS;
    if (inventory?.enabled !== true) {
        return { reason: R.INVENTORY_DISABLED };
    }
    if (inventory.loadFailed === true) {
        return { reason: R.INVENTORY_FAILED };
    }

    const document = inventory.analysis?.document ?? null;
    if (isEvidenceInventory(document)) {
        return { reason: null, document };
    }
    return {
        reason: generationOf(inventory.analysis) === GENERATION.FAILED
            ? R.INVENTORY_FAILED
            : R.NO_INVENTORY,
    };
}

function typologyPart(typology, question, inventoryDocument) {
    const R = TUTOR_MODE_REASONS;
    if (typology?.enabled !== true) {
        return { reason: R.TYPOLOGY_DISABLED };
    }
    if (typology.loadFailed === true) {
        return { reason: R.TYPOLOGY_FAILED };
    }
    if (!question?.id) {
        return { reason: R.NO_TYPOLOGY };
    }

    const found = findQuestionTypology(typology.analysis?.document ?? null, question);
    const claimTypology = found.typology
        ? toTutorClaimTypology(found.typology, inventoryDocument)
        : null;
    if (claimTypology) {
        return { reason: null, claimTypology };
    }

    // A document kept while a new generation is in flight is used while it
    // answers the question (above); otherwise the generation decides.
    const generation = generationOf(typology.analysis);
    if (generation === GENERATION.IN_FLIGHT) {
        return { reason: R.TYPOLOGY_PENDING };
    }
    // A matching typology that cannot be mapped is unusable.
    if (generation === GENERATION.FAILED || found.typology) {
        return { reason: R.TYPOLOGY_FAILED };
    }
    return {
        reason: found.reason === TYPOLOGY_ABSENT_REASONS.OUT_OF_DATE
            ? R.TYPOLOGY_OUT_OF_DATE
            : R.NO_TYPOLOGY,
    };
}

/**
 * The mode a tutor session for `question` gets. Pure.
 *
 * @param {Object} inputs - From loadTutorModeInputs().
 * @param {{enabled: boolean, analysis: Object|null, loadFailed?: boolean}} inputs.inventory
 *     The case's inventory analysis row (`status`, `is_stale`, `document`).
 * @param {{enabled: boolean, analysis: Object|null, loadFailed?: boolean}} inputs.typology
 *     The design's claim typology analysis row.
 * @param {{declaresEvaluationMode: boolean}} [inputs.tutor] - Whether the
 *     tutor's capability descriptor declares `evaluation_mode`; read only for
 *     sessions.
 * @param {{id: string, textHash: string}|null} question - A question unit
 *     (design-analysis-units.js), or null when the response maps to none.
 * @param {Object} [options]
 * @param {string} [options.requestedMode] - The phase's requested mode
 *     (requestedTutorMode()); DEFAULT_REQUESTED_TUTOR_MODE when omitted.
 * @returns {{mode: string, reason: string|null, caseContext: Object|null,
 *     requestedMode: string, evaluationMode: string|null}}
 *     `caseContext` (tutor-case-context/v1) only in the enhanced mode;
 *     `reason` only in the basic mode; `evaluationMode` is the
 *     `evaluation_mode` to send, null when the tutor does not declare it.
 */
export function decideTutorMode(
    { inventory, typology, tutor } = {},
    question = null,
    { requestedMode = DEFAULT_REQUESTED_TUTOR_MODE } = {}
) {
    const requested = requestedTutorMode({ [EVALUATION_MODE_FIELD]: requestedMode });
    const request = {
        requestedMode:  requested,
        evaluationMode: tutor?.declaresEvaluationMode === true ? requested : null,
    };
    if (requested === TUTOR_MODES.BASIC) {
        return basic(TUTOR_MODE_REASONS.BASIC_SELECTED, request);
    }

    const inventoryResult = inventoryPart(inventory);
    if (inventoryResult.reason) {
        return basic(inventoryResult.reason, request);
    }

    const typologyResult = typologyPart(typology, question, inventoryResult.document);
    if (typologyResult.reason) {
        return basic(typologyResult.reason, request);
    }

    return {
        mode:        TUTOR_MODES.ENHANCED,
        reason:      null,
        caseContext: {
            schemaVersion:     TUTOR_CASE_CONTEXT_SCHEMA,
            evidenceInventory: inventoryResult.document,
            claimTypology:     typologyResult.claimTypology,
        },
        ...request,
    };
}

// The registry imports the adapters, which import this helper, so it is
// imported when first needed.
async function defaultRegistry() {
    const { default: registry } = await import("../services/external-services.service.js");
    return registry;
}

async function readAnalysis(enabled, read, description) {
    if (!enabled) {
        return { analysis: null };
    }

    try {
        return { analysis: await read() ?? null };
    } catch (error) {
        console.warn(`[tutor-mode] Unable to read the ${description}; `
            + "the tutor runs in the basic mode.", {
            error: error?.message || "Unknown error",
        });
        return { analysis: null, loadFailed: true };
    }
}

function positiveId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// Descriptors are read for their field keys only, so one locale is enough;
// it is the one design validation reads, so both share a cache entry.
const DESCRIPTOR_LOCALE = "en_US";

// Whether the tutor's capability descriptor declares `evaluation_mode`
// (#870). A tutor that predates ethicapp-ai-additions#211 does not, and
// reports the field as unsupported; an unavailable descriptor counts as not
// declaring it, and the session is created without the field.
async function readDeclaresEvaluationMode(services, options) {
    try {
        const configuration = await services.getServiceInstanceConfiguration(
            ARGUMENTATION_TUTOR_SERVICE_ID,
            DESCRIPTOR_LOCALE,
            options
        );
        return configuration?.available === true
            && Array.isArray(configuration.fields)
            && configuration.fields.some(field => field?.key === EVALUATION_MODE_FIELD);
    } catch (error) {
        console.warn("[tutor-mode] Unable to read the tutor's capability descriptor; "
            + `the session is created without ${EVALUATION_MODE_FIELD}.`, {
            error: error?.message || "Unknown error",
        });
        return false;
    }
}

/**
 * What decideTutorMode() needs for the questions of one design: whether the
 * inventory and typology adapters are usable, the case's inventory analysis
 * and the design's typology analysis, and, for a session, whether the tutor
 * declares `evaluation_mode` (#870). A session follows the policy version it
 * is pinned to (#815), as its hooks do; the design view follows the current
 * one. A failed read is recorded, never thrown.
 *
 * @param {Object} args
 * @param {number|null} args.caseId
 * @param {number|null} args.designId
 * @param {number|null} [args.sessionId] - Use this session's pinned policy,
 *     and read the tutor's descriptor (`tutor.declaresEvaluationMode`).
 * @param {Object} [dependencies] - Overrides for tests: `registry`
 *     (usableServiceIds(), getSessionPolicyVersion(),
 *     getServiceInstanceConfiguration()), `getCaseAnalysisRow` and
 *     `getDesignAnalysisRow`.
 */
export async function loadTutorModeInputs(
    { caseId, designId, sessionId = null },
    {
        registry,
        getCaseAnalysisRow = getCaseAnalysis,
        getDesignAnalysisRow = getDesignAnalysis,
    } = {}
) {
    const services = registry ?? await defaultRegistry();
    const forSession = positiveId(sessionId) !== null;
    const options = forSession
        ? { policyVersion: await services.getSessionPolicyVersion(positiveId(sessionId)) }
        : {};
    const usable = new Set(await services.usableServiceIds(
        [EVIDENCE_INVENTORY_SERVICE_ID, CLAIM_TYPOLOGY_SERVICE_ID],
        options
    ));

    const validCaseId = positiveId(caseId);
    const validDesignId = positiveId(designId);
    const inventoryEnabled = usable.has(EVIDENCE_INVENTORY_SERVICE_ID);
    const typologyEnabled = usable.has(CLAIM_TYPOLOGY_SERVICE_ID);
    const [inventory, typology, declaresEvaluationMode] = await Promise.all([
        readAnalysis(
            inventoryEnabled && validCaseId !== null,
            () => getCaseAnalysisRow({
                caseId:    validCaseId,
                serviceId: EVIDENCE_INVENTORY_SERVICE_ID,
            }),
            "case's evidence inventory"
        ),
        readAnalysis(
            typologyEnabled && validDesignId !== null,
            () => getDesignAnalysisRow({
                designId:  validDesignId,
                serviceId: CLAIM_TYPOLOGY_SERVICE_ID,
            }),
            "design's claim typology"
        ),
        forSession ? readDeclaresEvaluationMode(services, options) : false,
    ]);

    return {
        inventory: { enabled: inventoryEnabled, ...inventory },
        typology:  { enabled: typologyEnabled, ...typology },
        ...(forSession ? { tutor: { declaresEvaluationMode } } : {}),
    };
}

// The mode a unit's phase requests, from the design (#870).
function unitRequestedMode(design, unit) {
    const phases = Array.isArray(design?.phases) ? design.phases : [];
    return phaseRequestedTutorMode(phases[unit.phaseNumber - 1] ?? null);
}

/**
 * The mode each question would get if its tutor session were created now,
 * under the current policy: `{ [unit id]: { mode, reason, requestedMode } }`.
 * A question of a phase that requests the basic mode is `basic-selected`
 * (#870); when every question is, no analysis is read.
 *
 * @param {Object} args
 * @param {Array<{id: string, phaseNumber: number, textHash: string}>} args.units
 *     The tutor's question units (design-analysis-units.js).
 * @param {Object|null} [args.design] - The design document, for each phase's
 *     requested mode; without it every phase requests the default.
 * @param {number|null} args.caseId
 * @param {number|null} args.designId
 * @param {Object} [dependencies] - As loadTutorModeInputs() takes them.
 */
export async function expectedTutorModes(
    { units, design = null, caseId, designId },
    dependencies = {}
) {
    if (!Array.isArray(units) || units.length === 0) {
        return {};
    }

    const requested = units.map(unit => unitRequestedMode(design, unit));
    const inputs = requested.some(mode => mode === TUTOR_MODES.ENHANCED)
        ? await loadTutorModeInputs({ caseId, designId }, dependencies)
        : {};
    return Object.fromEntries(units.map((unit, index) => {
        const { mode, reason, requestedMode } = decideTutorMode(
            inputs, unit, { requestedMode: requested[index] }
        );
        return [unit.id, { mode, reason, requestedMode }];
    }));
}

/**
 * The tutor's phases of a design and the mode each requests (#870), for the
 * design view: one entry per phase that enables the tutor, in design order,
 * with `reason: "basic-selected"` when it requests the basic mode (its
 * questions then need no claim typology), else null.
 *
 * @param {Object|null} design - A design document.
 * @returns {Array<{phaseNumber: number, requestedMode: string, reason: string|null}>}
 */
export function tutorPhaseModes(design) {
    const phases = Array.isArray(design?.phases) ? design.phases : [];
    return phases.flatMap((phase, index) => {
        const { enabledServiceIds } = phaseExternalServices(phase);
        if (!enabledServiceIds.includes(ARGUMENTATION_TUTOR_SERVICE_ID)) {
            return [];
        }
        const requestedMode = phaseRequestedTutorMode(phase);
        return [{
            phaseNumber: index + 1,
            requestedMode,
            reason:      requestedMode === TUTOR_MODES.BASIC
                ? TUTOR_MODE_REASONS.BASIC_SELECTED
                : null,
        }];
    });
}
