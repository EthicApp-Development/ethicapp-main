// Validation of the case inputs a design's services require (#1220, epic
// ethicapp-ai-additions#293).
//
// A service declares in its capability descriptor which session inputs come
// from the case's analyses and under which configurations it needs them
// (`session_inputs[key].source` and `.required_when`). For a design, or one
// of its phases, this validator lists, per enabled service and its stored
// configuration, the case inputs required and whether the case's analyses
// provide them, using helpers/case-session-inputs.js. It knows no service:
// everything comes from the descriptors and the adapter catalog.
//
// It runs
// - when a design is saved (POST /designs, PATCH /designs/:id, which is also
//   how a design's case changes): a required input whose analysis is absent,
//   failed or pending refuses the save; a ready draft the teacher has not
//   reviewed is enough unless the source requires a review;
// - when the editor asks (POST /designs/case-inputs), to show the result next
//   to each service's configuration;
// - when a phase starts (helpers/phase-start-helper.js): a phase that cannot
//   run is refused and the teacher is told instead of the room starting.
//
// A service the AI service policy does not allow is skipped (it will not
// run), and so is one whose descriptor cannot be read now: nothing can be
// known of its inputs, and its configuration validation already warns
// (`not_validated`). Both are reported in `unchecked`.

import {
    CASE_INPUT_READY,
    caseInputDependencies,
    caseSessionInputs,
    resolveCaseSessionInputs,
} from "../helpers/case-session-inputs.js";
import { phaseExternalServices } from "../helpers/phase-external-services.js";

export const MISSING_CASE_INPUTS_CODE = "MISSING_CASE_INPUTS";

// Descriptors are read for their declarations and defaults only, so one
// locale is enough; it is the one configuration validation reads, so both
// share a cache entry.
const VALIDATION_LOCALE = "en_US";

function phasesOf(design) {
    return Array.isArray(design?.phases) ? design.phases : [];
}

// Reads each case analysis once per check, however many phases need it.
function memoizedDependencies(deps) {
    const resolved = caseInputDependencies(deps);
    const rows = new Map();
    return {
        producerServiceIds: resolved.producerServiceIds,
        getCaseAnalysis:    ({ caseId, serviceId }) => {
            const key = `${caseId}\u0000${serviceId}`;
            if (!rows.has(key)) {
                rows.set(key, Promise.resolve(resolved.getCaseAnalysis({ caseId, serviceId })));
            }
            return rows.get(key);
        },
    };
}

/**
 * Lists the case inputs that the enabled services of a design's phases
 * require, and which of them the case's analyses do not provide.
 *
 * @param {Object} options
 * @param {Object} options.design - A design document.
 * @param {number|null} options.caseId - The design's case; without one,
 *     every required input is `absent`.
 * @param {number[]|null} [options.phaseIndexes] - 0-based phases to check;
 *     every phase when null.
 * @param {Iterable<string>|null} [options.usableServiceIds] - The services
 *     usable under the policy version that applies; when given, others are
 *     skipped (`unchecked`, reason `not_allowed`).
 * @param {(serviceId: string, locale: string) => Promise<Object|null>}
 *     options.getInstanceConfiguration - The registry's
 *     getServiceInstanceConfiguration(), bound to that policy version.
 * @param {Object} [options.deps] - For tests: `producerServiceIds` and
 *     `getCaseAnalysis` (helpers/case-session-inputs.js).
 * @returns {Promise<{ inputs: Object[], missing: Object[], unchecked: Object[] }>}
 *     `inputs` lists each required input as `{ phaseIndex, serviceId, key,
 *     documentSchema, analysisServiceIds, status }`, `status` being `ready`
 *     or a CASE_INPUT_STATUSES value; `missing` is those not `ready`;
 *     `unchecked` lists `{ phaseIndex, serviceId, reason }`.
 */
export async function checkCaseInputs({
    design,
    caseId,
    phaseIndexes = null,
    usableServiceIds = null,
    getInstanceConfiguration,
    deps = {},
}) {
    const usable = usableServiceIds === null ? null : new Set(usableServiceIds);
    const dependencies = memoizedDependencies(deps);
    const descriptors = new Map();
    const descriptorOf = (serviceId) => {
        if (!descriptors.has(serviceId)) {
            descriptors.set(serviceId, Promise.resolve(
                getInstanceConfiguration(serviceId, VALIDATION_LOCALE)));
        }
        return descriptors.get(serviceId);
    };

    const targets = [];
    phasesOf(design).forEach((phase, phaseIndex) => {
        if (phaseIndexes !== null && !phaseIndexes.includes(phaseIndex)) {
            return;
        }
        const { enabledServiceIds, configurations } = phaseExternalServices(phase);
        for (const serviceId of enabledServiceIds) {
            targets.push({ phaseIndex, serviceId, configuration: configurations[serviceId] ?? {} });
        }
    });

    const inputs = [];
    const unchecked = [];
    for (const { phaseIndex, serviceId, configuration } of targets) {
        if (usable !== null && !usable.has(serviceId)) {
            unchecked.push({ phaseIndex, serviceId, reason: "not_allowed" });
            continue;
        }
        const descriptor = await descriptorOf(serviceId);
        if (!descriptor) {
            continue; // A service without a descriptor declares no inputs.
        }
        if (!descriptor.available) {
            unchecked.push({ phaseIndex, serviceId, reason: descriptor.reason ?? "unavailable" });
            continue;
        }

        const required = caseSessionInputs(descriptor, configuration)
            .filter(input => input.required);
        if (required.length === 0) {
            continue;
        }
        const { missing } = await resolveCaseSessionInputs({
            descriptor, configuration, caseId, deps: dependencies,
        });
        const statusByKey = new Map(missing.map(entry => [entry.key, entry.status]));
        for (const input of required) {
            inputs.push({
                phaseIndex,
                serviceId,
                key:                input.key,
                documentSchema:     input.source.documentSchema,
                analysisServiceIds: await dependencies.producerServiceIds(
                    input.source.documentSchema) ?? [],
                status: statusByKey.get(input.key) ?? CASE_INPUT_READY,
            });
        }
    }

    return {
        inputs,
        missing: inputs.filter(input => input.status !== CASE_INPUT_READY),
        unchecked,
    };
}

/**
 * checkCaseInputs() bound to the external services registry, under the
 * current AI service policy version or `policyVersion`.
 *
 * @param {Object} options
 * @param {Object} options.design
 * @param {number|null} options.caseId
 * @param {number[]|null} [options.phaseIndexes]
 * @param {Object} options.registry - ExternalServicesRegistry (or a fake with
 *     getCurrentPolicyVersion(), usableServiceIds(),
 *     getServiceInstanceConfiguration() and getCaseAnalysisProducerIds()).
 * @param {Object|null} [options.policyVersion] - The version to apply, such
 *     as a session's pinned one; the current one when undefined.
 * @param {Object} [options.deps] - Overrides, as checkCaseInputs() takes them.
 */
export async function checkCaseInputsWithRegistry({
    design,
    caseId,
    phaseIndexes = null,
    registry,
    policyVersion,
    deps = {},
}) {
    const enabledServiceIds = [...new Set(phasesOf(design)
        .filter((_, index) => phaseIndexes === null || phaseIndexes.includes(index))
        .flatMap(phase => phaseExternalServices(phase).enabledServiceIds))];
    if (enabledServiceIds.length === 0) {
        return { inputs: [], missing: [], unchecked: [] };
    }

    const version = policyVersion === undefined
        ? await registry.getCurrentPolicyVersion()
        : policyVersion;
    return checkCaseInputs({
        design,
        caseId,
        phaseIndexes,
        usableServiceIds: await registry.usableServiceIds(enabledServiceIds,
            { policyVersion: version }),
        getInstanceConfiguration: (serviceId, locale) => registry
            .getServiceInstanceConfiguration(serviceId, locale, { policyVersion: version }),
        deps: {
            producerServiceIds: documentSchema =>
                registry.getCaseAnalysisProducerIds(documentSchema),
            ...deps,
        },
    });
}

// One line per missing input, in English, naming the analysis by its schema.
function describeMissing(missing) {
    return missing
        .map(entry => `phase ${entry.phaseIndex + 1}, ${entry.serviceId}: ${entry.key} `
            + `needs the case's ${entry.documentSchema} analysis (${entry.status})`)
        .join("; ");
}

/**
 * The 400 answer for a design save refused because a required case input is
 * missing.
 *
 * @param {{ missing: Object[] }} check - checkCaseInputs()'s result.
 * @param {Object[]} [warnings] - The configuration validation's warnings.
 */
export function missingCaseInputsResponse({ missing }, warnings = []) {
    return {
        status: 400,
        body:   {
            status:  "err",
            code:    MISSING_CASE_INPUTS_CODE,
            message: "The case has no ready analysis for an input a phase's service needs: "
                + `${describeMissing(missing)}.`,
            errors: missing,
            warnings,
        },
    };
}

/**
 * Why a phase cannot start because of its case inputs, for the phase start's
 * `missing_case_inputs` outcome; null when nothing is missing.
 *
 * @param {{ missing: Object[] }} check - checkCaseInputs()'s result for the phase.
 * @returns {string|null}
 */
export function missingCaseInputsProblem({ missing }) {
    return missing.length === 0
        ? null
        : `The phase cannot start: ${describeMissing(missing)}.`;
}
