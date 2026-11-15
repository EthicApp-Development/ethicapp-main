/**
 * Session inputs that come from the case's analyses (#1220, epic
 * ethicapp-ai-additions#293; contract "Session Inputs From Case Analyses" in
 * the ethicapp-ai-additions README).
 *
 * A service's capability descriptor may declare, for a `session_inputs`
 * entry, where EthicApp obtains its value and which configurations need it:
 *
 *     "discussion_topics": {
 *       "source": { "kind": "case_analysis",
 *                   "document_schema": "topic-listing/v1",
 *                   "pointer": "/topics" },
 *       "required_when": [{ "field": "pipeline_type", "in": ["contentCoverage"] }]
 *     }
 *
 * This module reads only those two keys, so it serves any service without
 * knowing it. The design validation (services/case-input-validation.service.js)
 * uses it to refuse designs and phases that cannot run, and adapters use it to
 * build the inputs of a session or room.
 *
 * - An input is required when any `required_when` condition holds: the
 *   configuration's effective value of the condition's field (the stored
 *   value, else the descriptor field's default) is one of `in`. An input
 *   with a `source` and no `required_when` is optional.
 * - The value is the part, at the RFC 6901 JSON Pointer `source.pointer`, of
 *   the document of the case analysis whose schema is
 *   `source.document_schema` ('' is the whole document). An analysis is used
 *   only while it is `ready`; a draft the teacher has not reviewed is enough
 *   unless the source sets `require_reviewed`.
 * - The case analysis is found through the adapter catalog: the case-scoped
 *   adapters whose `produces` names the schema with unit `case`
 *   (manifest.json, ExternalServicesRegistry#getCaseAnalysisProducerIds()),
 *   read as `case_analyses (case_id, service_id)`. A pending row may not have
 *   `document_schema` set yet, so the column alone cannot find it.
 *
 * Statuses of an input that cannot be resolved (CASE_INPUT_STATUSES):
 * `absent` (no analysis, or one without a document of that schema),
 * `pending` (a generation is in flight), `failed` (the latest generation
 * failed or never answered, or the document lacks the pointed part), and
 * `not_reviewed` (ready but unreviewed, when `require_reviewed`).
 */
import { getCaseAnalysis as defaultGetCaseAnalysis } from "./case-analyses-helper.js";
import { normalizeSessionInputs } from "../services/capability-descriptors.service.js";

export const CASE_INPUT_STATUSES = Object.freeze({
    ABSENT:       "absent",
    PENDING:      "pending",
    FAILED:       "failed",
    NOT_REVIEWED: "not_reviewed",
});

// The status of an input whose analysis is usable; never in `missing`.
export const CASE_INPUT_READY = "ready";

// When several adapters produce the schema, the closest to usable is
// reported: an unreviewed draft, then a generation in flight, then a failure.
const STATUS_RANK = Object.freeze([
    CASE_INPUT_STATUSES.NOT_REVIEWED,
    CASE_INPUT_STATUSES.PENDING,
    CASE_INPUT_STATUSES.FAILED,
    CASE_INPUT_STATUSES.ABSENT,
]);

const IN_FLIGHT_STATUSES = new Set(["requested", "processing"]);

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

// The declarations of a normalized descriptor (getServiceInstanceConfiguration()
// of the registry), or of a raw one (`session_inputs`).
function declarationsOf(descriptor) {
    if (isPlainObject(descriptor?.sessionInputDeclarations)) {
        return descriptor.sessionInputDeclarations;
    }
    if (isPlainObject(descriptor?.session_inputs)) {
        return normalizeSessionInputs(descriptor.session_inputs).sessionInputDeclarations;
    }
    return {};
}

// The instance fields of a normalized descriptor, or of a raw one.
function fieldsOf(descriptor) {
    if (Array.isArray(descriptor?.fields)) {
        return descriptor.fields;
    }
    const raw = descriptor?.instance_configuration?.fields;
    return Array.isArray(raw) ? raw : [];
}

/**
 * The effective value of a configuration field: the stored value, else the
 * descriptor field's default, else undefined. A stored null counts as unset,
 * as the editor stores no value for "use the default".
 */
function effectiveValue(field, configuration, fieldsByKey) {
    const stored = isPlainObject(configuration) ? configuration[field] : undefined;
    if (stored !== undefined && stored !== null) {
        return stored;
    }
    const descriptorField = fieldsByKey.get(field);
    return descriptorField && Object.hasOwn(descriptorField, "default")
        ? descriptorField.default
        : undefined;
}

function conditionHolds(condition, configuration, fieldsByKey) {
    const value = effectiveValue(condition.field, configuration, fieldsByKey);
    return value !== undefined && condition.in.some(entry => entry === value);
}

/**
 * The case inputs a service needs under one configuration.
 *
 * @param {Object|null} descriptor - The service's normalized instance
 *     configuration (ExternalServicesRegistry#getServiceInstanceConfiguration()
 *     when `available`: `fields` and `sessionInputDeclarations`), or a raw
 *     capability descriptor.
 * @param {Object|null} [configuration] - The phase's stored configuration of
 *     the service (`phase.externalServices.configurations[serviceId]`), `{}`
 *     or null when it has none.
 * @returns {Array<{ key: string, source: { kind: string, documentSchema: string,
 *     pointer: string, requireReviewed: boolean }, required: boolean }>}
 *     Every `session_inputs` entry with a `source`, in descriptor order:
 *     `required` when one of its `required_when` conditions holds, false for
 *     an entry without `required_when`. Entries whose `required_when` does not
 *     hold are left out.
 */
export function caseSessionInputs(descriptor, configuration = {}) {
    const fieldsByKey = new Map(fieldsOf(descriptor)
        .filter(field => isPlainObject(field) && typeof field.key === "string")
        .map(field => [field.key, field]));

    return Object.entries(declarationsOf(descriptor)).flatMap(([key, declaration]) => {
        const source = declaration?.source;
        if (!isPlainObject(source)) {
            return [];
        }
        const conditions = declaration.requiredWhen;
        if (!Array.isArray(conditions)) {
            return [{ key, source: { ...source }, required: false }];
        }
        return conditions.some(condition => conditionHolds(condition, configuration, fieldsByKey))
            ? [{ key, source: { ...source }, required: true }]
            : [];
    });
}

/**
 * The value at an RFC 6901 JSON Pointer.
 *
 * @param {unknown} document
 * @param {string} pointer - '' for the whole document, else `/a/0/b~1c`.
 * @returns {{ found: true, value: unknown } | { found: false }}
 */
export function resolveJsonPointer(document, pointer) {
    if (pointer === "") {
        return { found: true, value: document };
    }
    if (typeof pointer !== "string" || !pointer.startsWith("/")) {
        return { found: false };
    }

    let current = document;
    for (const rawToken of pointer.slice(1).split("/")) {
        const token = rawToken.replaceAll("~1", "/").replaceAll("~0", "~");
        if (Array.isArray(current)) {
            if (!/^(?:0|[1-9][0-9]*)$/u.test(token) || Number(token) >= current.length) {
                return { found: false };
            }
            current = current[Number(token)];
        } else if (isPlainObject(current) && Object.hasOwn(current, token)) {
            current = current[token];
        } else {
            return { found: false };
        }
    }
    return { found: true, value: current };
}

/**
 * Where one case analysis row stands for a source. Pure.
 *
 * @param {Object|null} row - A `case_analyses` row (getCaseAnalysis()), with
 *     `status`, `is_stale`, `document_schema`, `document` and `reviewed_at`.
 * @param {{ documentSchema: string, pointer: string, requireReviewed?: boolean }} source
 * @returns {{ status: "ready", value: unknown } | { status: string }}
 */
export function caseAnalysisInputStatus(row, source) {
    if (!row) {
        return { status: CASE_INPUT_STATUSES.ABSENT };
    }
    if (IN_FLIGHT_STATUSES.has(row.status)) {
        // A generation that never answered (analyses-store-helper.js) failed.
        return { status: row.is_stale === true
            ? CASE_INPUT_STATUSES.FAILED
            : CASE_INPUT_STATUSES.PENDING };
    }
    if (row.status === "failed") {
        return { status: CASE_INPUT_STATUSES.FAILED };
    }
    if (row.status !== "ready" || row.document === null || row.document === undefined
        || (row.document_schema && row.document_schema !== source.documentSchema)) {
        return { status: CASE_INPUT_STATUSES.ABSENT };
    }

    const part = resolveJsonPointer(row.document, source.pointer);
    if (!part.found) {
        return { status: CASE_INPUT_STATUSES.FAILED };
    }
    if (source.requireReviewed === true && !row.reviewed_at) {
        return { status: CASE_INPUT_STATUSES.NOT_REVIEWED };
    }
    return { status: CASE_INPUT_READY, value: structuredClone(part.value) };
}

// The registry imports the adapters, which may import this helper, so it is
// imported when first needed.
async function defaultProducerServiceIds(documentSchema) {
    const { default: registry } = await import("../services/external-services.service.js");
    return registry.getCaseAnalysisProducerIds(documentSchema);
}

/**
 * The dependencies of resolveCaseSessionInputs(), with defaults for those
 * not given.
 *
 * @param {Object} [deps]
 * @param {(documentSchema: string) => string[]|Promise<string[]>} [deps.producerServiceIds]
 *     The adapters whose case analysis holds that schema; the registry's
 *     getCaseAnalysisProducerIds() by default.
 * @param {({ caseId, serviceId }) => Promise<Object|null>} [deps.getCaseAnalysis]
 *     One `case_analyses` row; case-analyses-helper.js by default.
 */
export function caseInputDependencies({
    producerServiceIds = defaultProducerServiceIds,
    getCaseAnalysis = defaultGetCaseAnalysis,
} = {}) {
    return { producerServiceIds, getCaseAnalysis };
}

function positiveId(value) {
    const id = Number(value);
    return value !== null && Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Where a case input's source stands for a case: the first usable analysis
 * among the adapters that produce the schema, in catalog order, else the
 * status closest to usable. Read failures are thrown.
 *
 * @param {Object} args
 * @param {Object} args.source - A normalized source (caseSessionInputs()).
 * @param {number|null} args.caseId
 * @param {Object} [args.deps] - See caseInputDependencies().
 * @returns {Promise<{ status: "ready", value: unknown } | { status: string }>}
 */
export async function caseInputStatus({ source, caseId, deps = {} }) {
    const { producerServiceIds, getCaseAnalysis } = caseInputDependencies(deps);
    const validCaseId = positiveId(caseId);
    if (validCaseId === null) {
        return { status: CASE_INPUT_STATUSES.ABSENT };
    }

    const serviceIds = await producerServiceIds(source.documentSchema) ?? [];
    const results = await Promise.all(serviceIds.map(async (serviceId) => {
        const row = await getCaseAnalysis({ caseId: validCaseId, serviceId });
        return caseAnalysisInputStatus(row, source);
    }));

    const ready = results.find(result => result.status === CASE_INPUT_READY);
    if (ready) {
        return ready;
    }
    const status = STATUS_RANK.find(candidate =>
        results.some(result => result.status === candidate)) ?? CASE_INPUT_STATUSES.ABSENT;
    return { status };
}

/**
 * The case inputs of one service under one configuration, read from the
 * case's analyses.
 *
 * @param {Object} args
 * @param {Object|null} args.descriptor - As caseSessionInputs() takes it.
 * @param {Object|null} [args.configuration] - As caseSessionInputs() takes it.
 * @param {number|null} args.caseId - The design's (or session's) case; with
 *     none, every input is `absent`.
 * @param {Object} [args.deps] - See caseInputDependencies().
 * @returns {Promise<{ values: Object<string, unknown>,
 *     missing: Array<{ key: string, documentSchema: string, status: string }> }>}
 *     `values` holds every input that resolved, required or optional, under
 *     its key (a copy of the pointed part). `missing` lists the required
 *     inputs that did not resolve; optional ones are just left out.
 */
export async function resolveCaseSessionInputs({
    descriptor,
    configuration = {},
    caseId,
    deps = {},
}) {
    const values = {};
    const missing = [];
    const inputs = caseSessionInputs(descriptor, configuration);
    const statuses = await Promise.all(inputs.map(input =>
        caseInputStatus({ source: input.source, caseId, deps })));

    inputs.forEach((input, index) => {
        const result = statuses[index];
        if (result.status === CASE_INPUT_READY) {
            values[input.key] = result.value;
        } else if (input.required) {
            missing.push({
                key:            input.key,
                documentSchema: input.source.documentSchema,
                status:         result.status,
            });
        }
    });

    return { values, missing };
}
