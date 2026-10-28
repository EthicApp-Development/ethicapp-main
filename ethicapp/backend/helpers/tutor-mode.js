import { getCaseAnalysis } from "./case-analyses-helper.js";
import { getDesignAnalysis } from "./design-analyses-helper.js";
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
 */

// The tutor's catalog id, which design phases enable.
export const ARGUMENTATION_TUTOR_SERVICE_ID = "argumentation-tutor-system";

export const TUTOR_CASE_CONTEXT_SCHEMA = "tutor-case-context/v1";

export const TUTOR_MODES = Object.freeze({
    ENHANCED: "enhanced",
    BASIC:    "basic",
});

export const TUTOR_MODE_REASONS = Object.freeze({
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

function basic(reason) {
    return { mode: TUTOR_MODES.BASIC, reason, caseContext: null };
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
 * @param {{id: string, textHash: string}|null} question - A question unit
 *     (design-analysis-units.js), or null when the response maps to none.
 * @returns {{mode: string, reason: string|null, caseContext: Object|null}}
 *     `caseContext` (tutor-case-context/v1) only in the enhanced mode;
 *     `reason` only in the basic mode.
 */
export function decideTutorMode({ inventory, typology } = {}, question = null) {
    const inventoryResult = inventoryPart(inventory);
    if (inventoryResult.reason) {
        return basic(inventoryResult.reason);
    }

    const typologyResult = typologyPart(typology, question, inventoryResult.document);
    if (typologyResult.reason) {
        return basic(typologyResult.reason);
    }

    return {
        mode:        TUTOR_MODES.ENHANCED,
        reason:      null,
        caseContext: {
            schemaVersion:     TUTOR_CASE_CONTEXT_SCHEMA,
            evidenceInventory: inventoryResult.document,
            claimTypology:     typologyResult.claimTypology,
        },
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

/**
 * What decideTutorMode() needs for the questions of one design: whether the
 * inventory and typology adapters are usable, the case's inventory analysis
 * and the design's typology analysis. A session follows the policy version it
 * is pinned to (#815), as its hooks do; the design view follows the current
 * one. A failed read is recorded, never thrown.
 *
 * @param {Object} args
 * @param {number|null} args.caseId
 * @param {number|null} args.designId
 * @param {number|null} [args.sessionId] - Use this session's pinned policy.
 * @param {Object} [dependencies] - Overrides for tests: `registry`
 *     (usableServiceIds(), getSessionPolicyVersion()), `getCaseAnalysisRow`
 *     and `getDesignAnalysisRow`.
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
    const options = positiveId(sessionId)
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
    const [inventory, typology] = await Promise.all([
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
    ]);

    return {
        inventory: { enabled: inventoryEnabled, ...inventory },
        typology:  { enabled: typologyEnabled, ...typology },
    };
}

/**
 * The mode each question would get if its tutor session were created now,
 * under the current policy: `{ [unit id]: { mode, reason } }`.
 *
 * @param {Object} args
 * @param {Array<{id: string, textHash: string}>} args.units - The tutor's
 *     question units (design-analysis-units.js).
 * @param {number|null} args.caseId
 * @param {number|null} args.designId
 * @param {Object} [dependencies] - As loadTutorModeInputs() takes them.
 */
export async function expectedTutorModes({ units, caseId, designId }, dependencies = {}) {
    if (!Array.isArray(units) || units.length === 0) {
        return {};
    }

    const inputs = await loadTutorModeInputs({ caseId, designId }, dependencies);
    return Object.fromEntries(units.map((unit) => {
        const { mode, reason } = decideTutorMode(inputs, unit);
        return [unit.id, { mode, reason }];
    }));
}
