// The case inputs a Polyadic room is created with (#1221, epic
// ethicapp-ai-additions#293), such as the `discussion_topics` of a
// `contentCoverage` room: the `topics` of the case's `topic-listing/v1`.
//
// Polyadic's descriptor declares each one under `session_inputs` with a
// `source` and a `required_when` ("Session Inputs From Case Analyses" in the
// ethicapp-ai-additions README). helpers/case-session-inputs.js reads those
// declarations and the case's analyses; this module only applies its answer
// to a room:
//
// - a room whose configuration requires nothing gets nothing, so its payload
//   is the one it had before;
// - a required input the case cannot provide stops the room before any
//   request, and so does an unreadable analysis when an input is required;
// - what was sent is recorded by the analysis it came from (service, case,
//   generation job and times) and the ids of its items, never their texts.

import {
    CASE_INPUT_READY,
    caseAnalysisInputStatus,
    caseInputDependencies,
    caseSessionInputs,
    resolveCaseSessionInputs,
} from "../../helpers/case-session-inputs.js";

// The case input of Polyadic's `contentCoverage` mode (ethicapp-ai-additions#295).
// Named here so that a 400 about it never leads to the retry without the
// configured settings, even while the descriptor cannot be read.
export const DISCUSSION_TOPICS_INPUT = "discussion_topics";

// Why a room was not created, recorded on its room job and in the hook's
// result.
export const ROOM_FAILURE_REASONS = Object.freeze({
    // A required case input has no usable analysis (helper `missing`).
    MISSING_CASE_INPUTS:     "missing_case_inputs",
    // A case analysis could not be read while an input was required.
    CASE_INPUTS_UNREADABLE:  "case_inputs_unreadable",
    // Polyadic answered 400 naming a case input.
    CASE_INPUT_REJECTED:     "case_input_rejected",
    // Polyadic answered 400 for a configuration that requires a case input;
    // without its settings the room would run another mode, so it is not
    // retried.
    CONFIGURATION_REJECTED:  "configuration_rejected",
    // Any other failure (Polyadic unreachable, 5xx, a 400 retried in vain).
    SESSION_CREATION_FAILED: "session_creation_failed",
});

const MAX_REJECTION_TEXT_LENGTH = 500;

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isoTimeOf(value) {
    if (value === null || value === undefined) {
        return null;
    }
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

// The ids of a list of objects that all have a string `id` (the `T#` of each
// topic), or null for any other value.
function itemIdsOf(value) {
    if (!Array.isArray(value) || !value.every(item => typeof item?.id === "string")) {
        return null;
    }
    return value.map(item => item.id);
}

/**
 * The record of one case input sent to a room: which analysis it came from
 * and the ids of its items. The texts are left out: the analysis may change
 * later, and its generation and review times tell whether it did.
 *
 * @param {Object} args
 * @param {string} args.key - The session input's key.
 * @param {{ documentSchema: string, pointer: string }} args.source
 * @param {string|null} args.serviceId - The adapter whose analysis was used.
 * @param {Object|null} args.row - That `case_analyses` row.
 * @param {number|null} args.caseId
 * @param {unknown} args.value - The value sent.
 */
export function sentCaseInputRecord({ key, source, serviceId, row, caseId, value }) {
    const ids = itemIdsOf(value);
    return {
        key,
        serviceId:      serviceId ?? null,
        caseId:         caseId ?? null,
        documentSchema: source.documentSchema,
        pointer:        source.pointer,
        jobId:          row?.job_id ?? null,
        generatedAt:    isoTimeOf(row?.generated_at),
        reviewedAt:     isoTimeOf(row?.reviewed_at),
        ...(ids ? { ids } : {}),
    };
}

// The case analysis rows read during one resolution, by adapter id. Every
// input of a room reads the same case, so one row per adapter.
function recordingDependencies(deps) {
    const resolved = caseInputDependencies(deps);
    const rows = new Map();
    return {
        rows,
        deps: {
            producerServiceIds: resolved.producerServiceIds,
            getCaseAnalysis:    async ({ caseId, serviceId }) => {
                const row = await resolved.getCaseAnalysis({ caseId, serviceId });
                rows.set(serviceId, row ?? null);
                return row;
            },
        },
    };
}

// The adapter whose analysis the helper used for a resolved input: the first
// producer, in catalog order, whose row is usable for the source, as
// caseInputStatus() chooses it.
async function usedAnalysisOf(source, { rows, deps }) {
    const serviceIds = await deps.producerServiceIds(source.documentSchema) ?? [];
    const serviceId = serviceIds.find(id => rows.has(id)
        && caseAnalysisInputStatus(rows.get(id), source).status === CASE_INPUT_READY);
    return { serviceId: serviceId ?? null, row: serviceId ? rows.get(serviceId) : null };
}

/**
 * The case inputs of a room under the configuration it is created with.
 *
 * @param {Object} args
 * @param {Object|null} args.descriptor - Polyadic's normalized instance
 *     configuration (registry getServiceInstanceConfiguration()); null or
 *     unavailable when it cannot be read, and then nothing is sent.
 * @param {Object} args.configuration - The configuration the room is created
 *     with: the request body without its prompt.
 * @param {number|null} args.caseId - The session's case.
 * @param {unknown} [args.caseIdError] - Why the session's case could not be
 *     read, if it could not: an unreadable analysis, then.
 * @param {Object} [args.deps] - helpers/case-session-inputs.js dependencies.
 * @returns {Promise<{ values: Object, sent: Object[], keys: string[],
 *     required: boolean, failure?: Object }>} `values` go into the request
 *     body under their keys; `sent` records each one; `keys` names every case
 *     input of the configuration; `required` says whether any is required.
 *     With `failure` (`{ reason, missing? }`) the room must not be created.
 */
export async function resolveRoomCaseInputs({
    descriptor, configuration, caseId, caseIdError = null, deps = {},
}) {
    const none = { values: {}, sent: [], keys: [], required: false };
    if (!descriptor || descriptor.available === false) {
        return none;
    }

    const inputs = caseSessionInputs(descriptor, configuration);
    if (inputs.length === 0) {
        return none;
    }
    const keys = inputs.map(input => input.key);
    const required = inputs.some(input => input.required);

    const recording = recordingDependencies(deps);
    let resolution;
    try {
        if (caseIdError) {
            throw caseIdError;
        }
        resolution = await resolveCaseSessionInputs({
            descriptor, configuration, caseId, deps: recording.deps,
        });
    } catch (error) {
        if (required) {
            return {
                ...none, keys, required,
                failure: { reason: ROOM_FAILURE_REASONS.CASE_INPUTS_UNREADABLE },
                error,
            };
        }
        // Only optional inputs: the room is created without them.
        return { ...none, keys, error };
    }

    if (resolution.missing.length > 0) {
        return {
            ...none, keys, required,
            failure: {
                reason:  ROOM_FAILURE_REASONS.MISSING_CASE_INPUTS,
                missing: resolution.missing.map(entry => ({ ...entry })),
            },
        };
    }

    const sent = [];
    for (const input of inputs) {
        if (!Object.hasOwn(resolution.values, input.key)) {
            continue;
        }
        const { serviceId, row } = await usedAnalysisOf(input.source, recording);
        sent.push(sentCaseInputRecord({
            key:    input.key,
            source: input.source,
            serviceId,
            row,
            caseId,
            value:  resolution.values[input.key],
        }));
    }
    return { values: resolution.values, sent, keys, required };
}

/**
 * The case input a Polyadic 400 names (`{ detail: { field } }`, Polyadic's
 * answer for a missing or invalid `discussion_topics`), or null when the
 * error is not such a rejection.
 *
 * @param {unknown} error - The AI Additions client's error.
 * @param {string[]} keys - The case inputs of the room's configuration.
 */
export function rejectedCaseInput(error, keys = []) {
    if (Number(error?.statusCode) !== 400) {
        return null;
    }
    const field = error?.responseBody?.detail?.field;
    if (typeof field !== "string") {
        return null;
    }
    return field === DISCUSSION_TOPICS_INPUT || keys.includes(field) ? field : null;
}

function shortText(value) {
    return typeof value === "string" ? value.slice(0, MAX_REJECTION_TEXT_LENGTH) : null;
}

/**
 * What a rejection of a case input may record: the field, Polyadic's error
 * and the JSON Pointer of each invalid part. Polyadic's messages are left
 * out, since they may quote the input's texts.
 */
export function caseInputRejection(error) {
    const detail = isPlainObject(error?.responseBody?.detail) ? error.responseBody.detail : {};
    const errors = Array.isArray(detail.errors)
        ? detail.errors.map(entry => shortText(entry?.path)).filter(path => path !== null)
        : [];
    return {
        field: shortText(detail.field),
        error: shortText(detail.error),
        ...(errors.length > 0 ? { paths: errors } : {}),
    };
}
