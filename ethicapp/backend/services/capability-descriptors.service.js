// Capability descriptors (#687, #727). Each AI service publishes, at
// GET <prefix>/api/capabilities, the settings EthicApp may store per activity
// (`instance_configuration`). This module fetches a service's descriptor
// through the AI additions client, checks it against contract version "1"
// (ethicapp-ai-additions, shared/schemas/capability-descriptor.v1.schema.json),
// normalizes its instance fields and caches the result in memory per process.
// Nothing is stored in Redis. `runtime_configuration` is never returned.

export const DESCRIPTOR_CONTRACT_VERSION = "1";

const FIELD_TYPES = Object.freeze(["enum", "integer", "number", "boolean", "text"]);

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

function hasFieldGroup(group) {
    return isPlainObject(group) && Array.isArray(group.fields);
}

/**
 * Checks a raw descriptor against contract version "1" and normalizes its
 * instance configuration. Unknown keys are ignored, as the contract requires.
 * Unusable fields and repeated keys are dropped and reported in `warnings`.
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
    const fields = [];
    const seenKeys = new Set();

    raw.instance_configuration.fields.forEach((rawField, index) => {
        const { field, error } = normalizeFieldDescriptor(rawField);
        const label = isPlainObject(rawField) && isNonEmptyString(rawField.key)
            ? `"${rawField.key}"`
            : `#${index}`;

        if (error) {
            warnings.push(`field ${label} ${error}`);
            return;
        }
        if (seenKeys.has(field.key)) {
            warnings.push(`field ${label} is repeated`);
            return;
        }

        seenKeys.add(field.key);
        fields.push(field);
    });

    return {
        ok:         true,
        descriptor: {
            serviceId: service.id,
            name:      service.name,
            usesLlm:   service.uses_llm,
            fields,
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
    }

    /**
     * The normalized instance configuration of a service, in the descriptor
     * locale for `locale`.
     *
     * Returns null when the service declares no descriptor. Otherwise returns
     * `{ available: true, ... }`, or `{ available: false, reason }` when the
     * descriptor cannot be fetched or is invalid. A descriptor fetched
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

    clearCache() {
        this._cache.clear();
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
        };
    }
}
