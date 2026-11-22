// Capability descriptors (#687, #727). Each AI service publishes, at
// GET <prefix>/api/capabilities, the settings EthicApp may store per activity
// (`instance_configuration`). This module fetches a service's descriptor
// through the AI additions client, checks it against contract version "1"
// (ethicapp-ai-additions, shared/schemas/capability-descriptor.v1.schema.json),
// normalizes its instance fields (with their `applies_when`, #1234), the
// documents it declares for students (`student_outputs`, epic #1124, #1131)
// and the session inputs it accepts (`session_inputs`, #1178, with the case
// inputs' `source` and `required_when`, #1220), and caches the result in
// memory per process.
// Nothing is stored in Redis. `runtime_configuration` is never returned.

export const DESCRIPTOR_CONTRACT_VERSION = "1";

const FIELD_TYPES = Object.freeze(["enum", "integer", "number", "boolean", "text"]);

// The EthicApp scopes in which a service may declare that its documents reach
// students (`student_outputs[].scopes`). `case` and `design` serve teachers.
export const STUDENT_OUTPUT_SCOPES = Object.freeze(["response", "chat"]);

const STUDENT_OUTPUT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const STUDENT_OUTPUT_ID_MAX_LENGTH = 64;
// A document schema name, `<name>/v<major>`, such as `student-result/v1`.
const DOCUMENT_SCHEMA_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\/v[1-9][0-9]*$/u;

// The descriptor is read in this locale when no caller asked for one
// (refreshStudentOutputs(), sessionInputs()); only its display text depends
// on the locale.
const DEFAULT_DESCRIPTOR_LOCALE = "en_US";

const DESCRIPTOR_TTL_MS       = 10 * 60 * 1000;
const DESCRIPTOR_RETRY_MS     = 60 * 1000;
const DESCRIPTOR_TIMEOUT_MS   = 5000;

/**
 * Descriptor locale for an EthicApp locale: Spanish only when the locale is
 * Spanish (`es`, `es_CL`, `es-AR`...), English otherwise.
 * @param {string | null | undefined} locale
 * @returns {"es-CL" | "en-US"}
 */
export function descriptorLocale(locale) {
    return /^es(?:[-_]|$)/iu.test(String(locale || "").trim()) ? "es-CL" : "en-US";
}

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}

function optionalString(value) {
    return typeof value === "string" ? value : null;
}

function optionalNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Lifecycle metadata applies to fields and to enum entries. Anything other
// than "deprecated" counts as active.
function normalizeLifecycle(entity, { supersededByMustBeString }) {
    const status = entity.status === "deprecated" ? "deprecated" : "active";
    let supersededBy = entity.superseded_by ?? null;

    if (supersededByMustBeString && !isNonEmptyString(supersededBy)) {
        supersededBy = null;
    }

    return { status, supersededBy };
}

function normalizeEnumEntries(entries) {
    if (!Array.isArray(entries)) {
        return [];
    }

    return entries
        .filter(entry => isPlainObject(entry) && Object.hasOwn(entry, "value")
            && isNonEmptyString(entry.label))
        .map(entry => ({
            value: entry.value,
            label: entry.label,
            ...normalizeLifecycle(entry, { supersededByMustBeString: false }),
        }));
}

function normalizeValidation(type, validation) {
    switch (type) {
    case "enum":
        return { entries: normalizeEnumEntries(validation.enum) };
    case "integer":
    case "number":
        return {
            minimum: optionalNumber(validation.minimum),
            maximum: optionalNumber(validation.maximum),
            step:    optionalNumber(validation.step),
        };
    case "text":
        return {
            maxLength: Number.isInteger(validation.max_length) && validation.max_length >= 0
                ? validation.max_length
                : null,
            pattern:   optionalString(validation.pattern),
            multiline: validation.multiline === true,
        };
    default:
        return {};
    }
}

/**
 * Normalizes one field descriptor, or explains why it is unusable.
 * @returns {{ field: object } | { error: string }}
 */
export function normalizeFieldDescriptor(raw) {
    if (!isPlainObject(raw)) {
        return { error: "is not an object" };
    }
    if (!isNonEmptyString(raw.key)) {
        return { error: "has no key" };
    }
    if (!FIELD_TYPES.includes(raw.type)) {
        return { error: `has unsupported type "${raw.type}"` };
    }
    if (typeof raw.required !== "boolean" || !Object.hasOwn(raw, "default")) {
        return { error: "lacks required or default" };
    }
    if (!isPlainObject(raw.display) || !isNonEmptyString(raw.display.label)) {
        return { error: "has no display label" };
    }
    if (!isPlainObject(raw.validation)) {
        return { error: "has no validation block" };
    }

    const validation = normalizeValidation(raw.type, raw.validation);
    if (raw.type === "enum" && validation.entries.length === 0) {
        return { error: "is an enum without valid entries" };
    }

    return {
        field: {
            key:         raw.key,
            type:        raw.type,
            required:    raw.required,
            default:     raw.default,
            label:       raw.display.label,
            description: optionalString(raw.display.description),
            group:       optionalString(raw.display.group),
            order:       Number.isInteger(raw.display.order) ? raw.display.order : null,
            ...normalizeLifecycle(raw, { supersededByMustBeString: true }),
            validation,
        },
    };
}

/**
 * Normalizes one `student_outputs` entry, or explains why it is unusable.
 * Unknown keys are ignored. Scopes other than `response` and `chat` are
 * dropped, and an entry left without a scope is unusable.
 * @returns {{ output: object, droppedScopes: number } | { error: string }}
 */
export function normalizeStudentOutput(raw) {
    if (!isPlainObject(raw)) {
        return { error: "is not an object" };
    }
    if (typeof raw.id !== "string" || raw.id.length > STUDENT_OUTPUT_ID_MAX_LENGTH
        || !STUDENT_OUTPUT_ID_PATTERN.test(raw.id)) {
        return { error: "has no valid id" };
    }
    if (typeof raw.document_schema !== "string"
        || !DOCUMENT_SCHEMA_PATTERN.test(raw.document_schema)) {
        return { error: "has no valid document_schema" };
    }
    if (!Array.isArray(raw.scopes)) {
        return { error: "has no scopes" };
    }
    const scopes = STUDENT_OUTPUT_SCOPES.filter(scope => raw.scopes.includes(scope));
    if (scopes.length === 0) {
        return { error: "declares no student scope (response or chat)" };
    }
    if (!isPlainObject(raw.display) || !isNonEmptyString(raw.display.label)
        || !isNonEmptyString(raw.display.description)) {
        return { error: "has no display label and description" };
    }

    return {
        output: {
            id:             raw.id,
            documentSchema: raw.document_schema,
            scopes,
            label:          raw.display.label,
            description:    raw.display.description,
        },
        droppedScopes: raw.scopes.filter(scope => !STUDENT_OUTPUT_SCOPES.includes(scope)).length,
    };
}

/**
 * Normalizes a descriptor's optional `student_outputs` (epic #1124, #1131):
 * the documents the service publishes to students, by scope. Absent means
 * none. Unusable and repeated entries are dropped and reported in `warnings`;
 * they never make the descriptor unusable, since its instance fields stay
 * valid.
 * @param {unknown} raw
 * @returns {{ studentOutputs: object[], warnings: string[] }}
 */
export function normalizeStudentOutputs(raw) {
    if (raw === undefined || raw === null) {
        return { studentOutputs: [], warnings: [] };
    }
    if (!Array.isArray(raw)) {
        return { studentOutputs: [], warnings: ["student_outputs is not a list"] };
    }

    const studentOutputs = [];
    const warnings = [];
    const seenIds = new Set();
    raw.forEach((rawOutput, index) => {
        const { output, droppedScopes, error } = normalizeStudentOutput(rawOutput);
        // The id is shown only once it is known to be a short kebab-case name.
        const label = output ? `"${output.id}"` : `#${index}`;

        if (error) {
            warnings.push(`student output ${label} ${error}`);
            return;
        }
        if (seenIds.has(output.id)) {
            warnings.push(`student output ${label} is repeated`);
            return;
        }
        if (droppedScopes > 0) {
            warnings.push(`student output ${label} has ${droppedScopes} unknown scope(s)`);
        }

        seenIds.add(output.id);
        studentOutputs.push(output);
    });

    return { studentOutputs, warnings };
}

// A case input's `source` (ethicapp-ai-additions#293, contract "Session Inputs
// From Case Analyses"): closed, of kind `case_analysis`, with the schema of the
// case analysis document and an RFC 6901 JSON Pointer into it.
const SESSION_INPUT_SOURCE_KEYS = Object.freeze([
    "kind", "document_schema", "pointer", "require_reviewed",
]);
const CONDITION_KEYS = Object.freeze(["field", "in"]);
export const CASE_ANALYSIS_SOURCE_KIND = "case_analysis";
const SOURCE_DOCUMENT_SCHEMA_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*\/v[1-9][0-9]*$/u;
const JSON_POINTER_PATTERN = /^(?:\/(?:[^~/]|~[01])*)*$/u;

function hasOnlyKeys(value, keys) {
    return Object.keys(value).every(key => keys.includes(key));
}

/**
 * Normalizes a session input's `source`, or explains why it is unusable.
 * @returns {{ source: { kind: string, documentSchema: string, pointer: string,
 *   requireReviewed: boolean } } | { error: string }}
 */
export function normalizeSessionInputSource(raw) {
    if (!isPlainObject(raw) || !hasOnlyKeys(raw, SESSION_INPUT_SOURCE_KEYS)) {
        return { error: "has a source that is not an object of known keys" };
    }
    if (raw.kind !== CASE_ANALYSIS_SOURCE_KIND) {
        return { error: "has a source of unknown kind" };
    }
    if (typeof raw.document_schema !== "string"
        || !SOURCE_DOCUMENT_SCHEMA_PATTERN.test(raw.document_schema)) {
        return { error: "has a source without a valid document_schema" };
    }
    if (typeof raw.pointer !== "string" || !JSON_POINTER_PATTERN.test(raw.pointer)) {
        return { error: "has a source without a valid pointer" };
    }
    if (raw.require_reviewed !== undefined && typeof raw.require_reviewed !== "boolean") {
        return { error: "has a source whose require_reviewed is not a boolean" };
    }
    return {
        source: {
            kind:            raw.kind,
            documentSchema:  raw.document_schema,
            pointer:         raw.pointer,
            requireReviewed: raw.require_reviewed === true,
        },
    };
}

// A list of `{ field, in }` conditions, the shape of a session input's
// `required_when` and of an instance field's `applies_when` (#1234), or why
// it is unusable: a non-empty list of objects with exactly those keys,
// `field` a non-empty string and `in` a non-empty list.
// `name` is the key with its article, as warnings read it.
function normalizeConditions(raw, name) {
    if (!Array.isArray(raw) || raw.length === 0) {
        return { error: `has ${name} that is not a non-empty list` };
    }
    const valid = raw.every(condition => isPlainObject(condition)
        && hasOnlyKeys(condition, CONDITION_KEYS)
        && isNonEmptyString(condition.field)
        && Array.isArray(condition.in) && condition.in.length > 0);
    if (!valid) {
        return { error: `has ${name} with an invalid condition` };
    }
    return {
        conditions: raw.map(condition => ({ field: condition.field, in: [...condition.in] })),
    };
}

/**
 * Normalizes a session input's `required_when`, or explains why it is
 * unusable: a non-empty list of `{ field, in }`, `in` a non-empty list.
 * @returns {{ requiredWhen: Array<{ field: string, in: unknown[] }> } | { error: string }}
 */
export function normalizeSessionInputConditions(raw) {
    const result = normalizeConditions(raw, "a required_when");
    return result.error ? result : { requiredWhen: result.conditions };
}

/**
 * Normalizes an instance field's `applies_when` (#1234,
 * ethicapp-ai-additions#319), or explains why its shape is unusable. It has
 * the shape of a `required_when`. Whether its conditions name usable fields
 * is checked against the whole descriptor (normalizeFieldConditions()).
 * @returns {{ appliesWhen: Array<{ field: string, in: unknown[] }> } | { error: string }}
 */
export function normalizeAppliesWhen(raw) {
    const result = normalizeConditions(raw, "an applies_when");
    return result.error ? result : { appliesWhen: result.conditions };
}

// Why a well-shaped `applies_when` of field `key` cannot be evaluated, or
// null: each condition must name another instance field of the descriptor,
// and one without an `applies_when` of its own, since conditions never chain.
function appliesWhenProblem(key, appliesWhen, knownKeys, conditionalKeys) {
    for (const condition of appliesWhen) {
        if (condition.field === key) {
            return "has an applies_when on itself";
        }
        if (!knownKeys.has(condition.field)) {
            return `has an applies_when on an unknown field "${condition.field}"`;
        }
        if (conditionalKeys.has(condition.field)) {
            return `has an applies_when on "${condition.field}", which has its own applies_when`;
        }
    }
    return null;
}

/**
 * Adds `appliesWhen` to the normalized instance fields that declare a usable
 * `applies_when` (#1234). An unusable one (a wrong shape, a condition on the
 * field itself, on a field the descriptor does not define or on a field with
 * its own `applies_when`) is dropped with a warning, and the field then
 * always applies. Fields without `applies_when` are returned unchanged, so a
 * descriptor that uses none normalizes exactly as before.
 * @param {object[]} fields - Normalized fields, in descriptor order.
 * @param {Map<string, object>} rawFieldsByKey - Their raw descriptors.
 * @returns {{ fields: object[], warnings: string[] }}
 */
export function normalizeFieldConditions(fields, rawFieldsByKey) {
    const shaped = new Map();
    const shapeErrors = new Map();
    for (const field of fields) {
        const raw = rawFieldsByKey.get(field.key)?.applies_when;
        if (raw === undefined) {
            continue;
        }
        const result = normalizeAppliesWhen(raw);
        if (result.error) {
            shapeErrors.set(field.key, result.error);
        } else {
            shaped.set(field.key, result.appliesWhen);
        }
    }

    const knownKeys = new Set(fields.map(field => field.key));
    const conditionalKeys = new Set(shaped.keys());
    const warnings = [];
    const normalized = fields.map((field) => {
        if (shapeErrors.has(field.key)) {
            warnings.push(`field "${field.key}" ${shapeErrors.get(field.key)}`);
            return field;
        }
        const appliesWhen = shaped.get(field.key);
        if (!appliesWhen) {
            return field;
        }
        const problem = appliesWhenProblem(field.key, appliesWhen, knownKeys, conditionalKeys);
        if (problem) {
            warnings.push(`field "${field.key}" ${problem}`);
            return field;
        }
        return { ...field, appliesWhen };
    });
    return { fields: normalized, warnings };
}

/**
 * The case-input part of one `session_inputs` entry: its `source` and
 * `required_when`, normalized, each null when absent. An unusable `source`
 * or `required_when` is dropped with a warning, and so is a `required_when`
 * without a usable `source`, which the contract forbids: EthicApp could not
 * tell where the value comes from. The rest of the entry is the service's
 * contract with its adapter and is not interpreted.
 * @returns {{ declaration: { source: object|null, requiredWhen: object[]|null },
 *   warnings: string[] }}
 */
function normalizeSessionInputDeclaration(name, entry) {
    const warnings = [];
    let source = null;
    let requiredWhen = null;

    if (entry.source !== undefined) {
        const result = normalizeSessionInputSource(entry.source);
        if (result.error) {
            warnings.push(`session input "${name}" ${result.error}`);
        } else {
            source = result.source;
        }
    }
    if (entry.required_when !== undefined) {
        const result = normalizeSessionInputConditions(entry.required_when);
        if (result.error) {
            warnings.push(`session input "${name}" ${result.error}`);
        } else if (source === null) {
            warnings.push(`session input "${name}" has a required_when without a valid source`);
        } else {
            requiredWhen = result.requiredWhen;
        }
    }

    return { declaration: { source, requiredWhen }, warnings };
}

/**
 * The session inputs a descriptor declares (#1178): the keys of its optional
 * `session_inputs` whose entry is an object. A session input is a value
 * EthicApp computes for each room or session it creates, such as Polyadic's
 * `phase_clock`, rather than a setting a teacher stores. Absent means none.
 * An entry that is not an object is dropped with a warning.
 *
 * `sessionInputDeclarations` keeps, per input, the two keys EthicApp reads
 * generically (ethicapp-ai-additions#293): where a case input comes from
 * (`source`) and which configurations need it (`requiredWhen`); see
 * helpers/case-session-inputs.js. The rest of each entry is the service's
 * contract with its adapter and is not interpreted here.
 * @param {unknown} raw
 * @returns {{ sessionInputs: string[], sessionInputDeclarations: Object<string, {
 *   source: object|null, requiredWhen: object[]|null }>, warnings: string[] }}
 */
export function normalizeSessionInputs(raw) {
    if (raw === undefined || raw === null) {
        return { sessionInputs: [], sessionInputDeclarations: {}, warnings: [] };
    }
    if (!isPlainObject(raw)) {
        return {
            sessionInputs:            [],
            sessionInputDeclarations: {},
            warnings:                 ["session_inputs is not an object"],
        };
    }

    const sessionInputs = [];
    const sessionInputDeclarations = {};
    const warnings = [];
    for (const [name, entry] of Object.entries(raw)) {
        if (isPlainObject(entry) && isNonEmptyString(name)) {
            sessionInputs.push(name);
            const normalized = normalizeSessionInputDeclaration(name, entry);
            sessionInputDeclarations[name] = normalized.declaration;
            warnings.push(...normalized.warnings);
        } else {
            warnings.push(`session input "${name}" is not an object`);
        }
    }
    return { sessionInputs, sessionInputDeclarations, warnings };
}

function hasFieldGroup(group) {
    return isPlainObject(group) && Array.isArray(group.fields);
}

/**
 * Checks a raw descriptor against contract version "1" and normalizes its
 * instance configuration and its student outputs. Unknown keys are ignored, as
 * the contract requires. Unusable fields and student outputs, and repeated
 * keys and ids, are dropped and reported in `warnings`. A field keeps a usable
 * `applies_when` as `appliesWhen` (normalizeFieldConditions(), #1234).
 * @param {unknown} raw
 * @param {string} expectedServiceId the descriptor id the manifest maps to
 * @returns {{ ok: true, descriptor: object, warnings: string[] }
 *   | { ok: false, reason: string }}
 */
export function normalizeDescriptor(raw, expectedServiceId) {
    if (!isPlainObject(raw)) {
        return { ok: false, reason: "invalid_descriptor" };
    }
    if (raw.contract_version !== DESCRIPTOR_CONTRACT_VERSION) {
        return { ok: false, reason: "unsupported_contract_version" };
    }

    const service = raw.service;
    if (!isPlainObject(service) || !isNonEmptyString(service.id)
        || !isNonEmptyString(service.name) || typeof service.uses_llm !== "boolean") {
        return { ok: false, reason: "invalid_descriptor" };
    }
    if (service.id !== expectedServiceId) {
        return { ok: false, reason: "service_id_mismatch" };
    }
    if (!hasFieldGroup(raw.instance_configuration) || !hasFieldGroup(raw.runtime_configuration)) {
        return { ok: false, reason: "invalid_descriptor" };
    }

    const warnings = [];
    const accepted = [];
    const rawFieldsByKey = new Map();

    raw.instance_configuration.fields.forEach((rawField, index) => {
        const { field, error } = normalizeFieldDescriptor(rawField);
        const label = isPlainObject(rawField) && isNonEmptyString(rawField.key)
            ? `"${rawField.key}"`
            : `#${index}`;

        if (error) {
            warnings.push(`field ${label} ${error}`);
            return;
        }
        if (rawFieldsByKey.has(field.key)) {
            warnings.push(`field ${label} is repeated`);
            return;
        }

        rawFieldsByKey.set(field.key, rawField);
        accepted.push(field);
    });

    const { fields, warnings: conditionWarnings } =
        normalizeFieldConditions(accepted, rawFieldsByKey);
    warnings.push(...conditionWarnings);

    const studentOutputs = normalizeStudentOutputs(raw.student_outputs);
    warnings.push(...studentOutputs.warnings);
    const sessionInputs = normalizeSessionInputs(raw.session_inputs);
    warnings.push(...sessionInputs.warnings);

    return {
        ok:         true,
        descriptor: {
            serviceId:      service.id,
            name:           service.name,
            usesLlm:        service.uses_llm,
            fields,
            studentOutputs: studentOutputs.studentOutputs,
            sessionInputs:  sessionInputs.sessionInputs,
            sessionInputDeclarations: sessionInputs.sessionInputDeclarations,
        },
        warnings,
    };
}

export class CapabilityDescriptorsClient {
    /**
     * @param {object} options
     * @param {(serviceId: string) => ({ serviceId: string, path: string } | null)}
     *   options.getDescriptorLink the manifest link of a service
     *   (`ExternalServicesRegistry#getServiceDescriptor`)
     * @param {(path: string, options: object) => Promise<unknown>} options.requestJson
     *   authenticated GET relative to the connection's base URL
     *   (`AiAdditionsClient#requestJson`)
     * @param {() => Promise<string|null>} [options.getConnectionKey] the
     *   fingerprint of the AI Additions connection, null when none is stored
     *   (`AiAdditionsClient#getConnectionFingerprint`). Without a connection no
     *   descriptor is requested; when it changes, cached descriptors are dropped.
     *   Omitted, the connection is assumed constant.
     */
    constructor({
        getDescriptorLink,
        requestJson,
        getConnectionKey = async () => "",
        now = () => Date.now(),
        ttlMs = DESCRIPTOR_TTL_MS,
        retryMs = DESCRIPTOR_RETRY_MS,
        timeoutMs = DESCRIPTOR_TIMEOUT_MS,
        logger = console,
    }) {
        this._getDescriptorLink = getDescriptorLink;
        this._requestJson       = requestJson;
        this._getConnectionKey  = getConnectionKey;
        this._connectionKey     = null;
        this._now               = now;
        this._ttlMs             = ttlMs;
        this._retryMs           = retryMs;
        this._timeoutMs         = timeoutMs;
        this._logger            = logger;
        this._cache             = new Map();
        this._inflight          = new Map();
        // serviceId -> { studentOutputs, fetchedAtMs }: the student outputs of
        // the last descriptor fetched successfully for the service, in any
        // locale. Kept after failed fetches and connection changes, and
        // replaced only by a newer successful fetch (see knownStudentOutputs()).
        this._studentOutputs    = new Map();
    }

    /**
     * The normalized instance configuration of a service, in the descriptor
     * locale for `locale`, with the student outputs it declares.
     *
     * Returns null when the service declares no descriptor. Otherwise returns
     * `{ available: true, ..., fields, studentOutputs }`, or
     * `{ available: false, reason }` when the descriptor cannot be fetched or
     * is invalid. A descriptor fetched
     * successfully earlier is kept (with `stale: true`) while the service is
     * unavailable, and the fetch is retried after a short delay.
     *
     * Without an AI Additions connection it returns
     * `{ available: false, reason: "not_configured" }` without any request.
     */
    async getInstanceConfiguration(serviceId, locale) {
        const link = this._getDescriptorLink(serviceId);
        if (!link) {
            return null;
        }

        let connectionKey;
        try {
            connectionKey = await this._getConnectionKey();
        } catch (error) {
            this._logger.warn(
                `[capability-descriptors] ${serviceId}: AI Additions connection unreadable `
                + `(${error?.message || error?.name || "unknown error"})`
            );
            return { available: false, reason: "unreachable" };
        }

        if (connectionKey !== this._connectionKey) {
            // The connection changed or was removed: descriptors fetched from
            // the previous host no longer apply.
            this._cache.clear();
            this._connectionKey = connectionKey;
        }
        if (connectionKey === null) {
            return { available: false, reason: "not_configured" };
        }

        const acceptLanguage = descriptorLocale(locale);
        // The connection is part of the key, so a request still in flight for
        // a previous connection never fills the cache of the current one.
        const cacheKey = `${connectionKey}\u0000${serviceId}\u0000${acceptLanguage}`;
        const cached = this._cache.get(cacheKey);

        if (cached && cached.expiresAtMs > this._now()) {
            return cached.value;
        }
        if (this._inflight.has(cacheKey)) {
            return this._inflight.get(cacheKey);
        }

        const request = this._fetch(serviceId, link, acceptLanguage)
            .then((result) => {
                if (result.available) {
                    this._studentOutputs.set(serviceId, {
                        studentOutputs: result.studentOutputs,
                        fetchedAtMs:    this._now(),
                    });
                    this._cache.set(cacheKey, {
                        value:       result,
                        lastGood:    result,
                        expiresAtMs: this._now() + this._ttlMs,
                    });
                    return result;
                }

                const lastGood = cached?.lastGood ?? null;
                const value = lastGood ? { ...lastGood, stale: true } : result;
                this._cache.set(cacheKey, {
                    value,
                    lastGood,
                    expiresAtMs: this._now() + this._retryMs,
                });
                return value;
            })
            .finally(() => this._inflight.delete(cacheKey));

        this._inflight.set(cacheKey, request);
        return request;
    }

    /**
     * The student outputs EthicApp knows for a service (epic #1124, #1131):
     * those of the last descriptor fetched successfully for it since the
     * process started, whatever happened afterwards. A later failed fetch, a
     * service that went down or a changed or removed AI Additions connection
     * keeps them; only a newer successful fetch replaces them. Results
     * already published were published under them, so a student's rebuilt
     * results do not vanish with the service or the connection.
     *
     * It makes no request and reads no connection. `stale` is true once they
     * are older than the descriptor TTL; refreshStudentOutputs() asks again.
     *
     * @param {string} serviceId - The registry's (manifest) service id.
     * @returns {{ studentOutputs: object[], stale: boolean } | null} null when
     *     no descriptor of the service has been fetched yet.
     */
    knownStudentOutputs(serviceId) {
        const known = this._studentOutputs.get(serviceId);
        if (!known) {
            return null;
        }
        return {
            studentOutputs: known.studentOutputs,
            stale:          this._now() - known.fetchedAtMs >= this._ttlMs,
        };
    }

    /**
     * Fetches the service's descriptor when the cache has none in date, as
     * getInstanceConfiguration() does, then returns knownStudentOutputs(). It
     * never throws, and it waits at most for one descriptor request.
     */
    async refreshStudentOutputs(serviceId) {
        await this.getInstanceConfiguration(serviceId, DEFAULT_DESCRIPTOR_LOCALE);
        return this.knownStudentOutputs(serviceId);
    }

    /**
     * The session inputs the service's descriptor declares (#1178), such as
     * Polyadic's `phase_clock`, from the cached descriptor or a fetch when the
     * cache has none in date, as getInstanceConfiguration() does. A
     * descriptor kept as stale after a failure still answers. It never
     * throws: a service without a descriptor, or whose descriptor cannot be
     * fetched or is invalid, declares none, so adapters send no input the
     * service may not know.
     * @param {string} serviceId - The registry's (manifest) service id.
     * @returns {Promise<string[]>}
     */
    async sessionInputs(serviceId) {
        const configuration = await this.getInstanceConfiguration(serviceId,
            DEFAULT_DESCRIPTOR_LOCALE);
        return configuration?.available ? configuration.sessionInputs : [];
    }

    clearCache() {
        this._cache.clear();
        this._studentOutputs.clear();
    }

    async _fetch(serviceId, link, acceptLanguage) {
        let raw;
        try {
            raw = await this._requestJson(link.path, {
                headers:   { "Accept-Language": acceptLanguage },
                timeoutMs: this._timeoutMs,
            });
        } catch (error) {
            // The connection was removed after it was checked: no request left.
            if (error?.code === "not_configured") {
                return { available: false, reason: "not_configured" };
            }
            this._logger.warn(
                `[capability-descriptors] ${serviceId}: descriptor unavailable `
                + `(${error?.message || error?.name || "unknown error"})`
            );
            return { available: false, reason: "unreachable" };
        }

        const result = normalizeDescriptor(raw, link.serviceId);
        if (!result.ok) {
            this._logger.warn(`[capability-descriptors] ${serviceId}: ${result.reason}.`);
            return { available: false, reason: result.reason };
        }

        for (const warning of result.warnings) {
            this._logger.warn(`[capability-descriptors] ${serviceId}: ${warning}; ignored.`);
        }

        return {
            available:           true,
            stale:               false,
            descriptorServiceId: result.descriptor.serviceId,
            name:                result.descriptor.name,
            usesLlm:             result.descriptor.usesLlm,
            locale:              acceptLanguage,
            fields:              result.descriptor.fields,
            studentOutputs:      result.descriptor.studentOutputs,
            sessionInputs:       result.descriptor.sessionInputs,
            // `source` and `required_when` of each session input (#1220).
            sessionInputDeclarations: result.descriptor.sessionInputDeclarations,
        };
    }
}
