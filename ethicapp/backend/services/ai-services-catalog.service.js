import fs from "node:fs/promises";

import aiAdditionsClient from "./ai-additions-client.service.js";
import { isAiAdditionsNotConfigured } from "../helpers/ai-additions-connection.js";
import { assertValidCatalog, validateCatalog } from "../external-services/catalog.js";

/**
 * The AI Additions service catalog as the management console sees it (#816).
 *
 * The console holds no AI Additions credentials. It asks ethicapp, over the
 * internal network, to read the catalog through the stored connection or to
 * test a connection before saving it. Both answers carry typed error codes
 * instead of messages, and nothing here logs tokens, secrets or bodies.
 */

export const AI_SERVICES_ERROR = Object.freeze({
    NOT_CONFIGURED:   "not_configured",
    UNREACHABLE:      "unreachable",
    UNAUTHORIZED:     "unauthorized",
    INVALID_RESPONSE: "invalid_response",
});

export const CATALOG_PATH = "/catalog/v1/services";
export const CATALOG_CONTRACT_VERSION = "1";

// The console gives up after 15 s (catalog) and 20 s (connection test). Each
// step answers before that, so a slow AI Additions shows up as `unreachable`
// instead of a console-side timeout.
const DEFAULT_CATALOG_DEADLINE_MS = 12000;
const DEFAULT_TOKEN_STEP_DEADLINE_MS = 8000;
const DEFAULT_CATALOG_STEP_DEADLINE_MS = 8000;

const DEFAULT_MANIFEST_URL = new URL("../external-services/manifest.json", import.meta.url);

const SERVICE_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/u;
const SERVICE_STATUSES = new Set(["available", "unavailable"]);
const NETWORK_ERROR_CODES = new Set([
    "ECONNREFUSED",
    "ECONNRESET",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "ENOTFOUND",
    "EAI_AGAIN",
    "ETIMEDOUT",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_BODY_TIMEOUT",
    "UND_ERR_SOCKET",
]);

const MAX_CONNECTION_URL_LENGTH = 2048;
// http(s)://<authority>[/<path>] on the raw text: an explicit authority
// without userinfo, an optional path prefix, no query, fragment, backslash or
// whitespace. Same rule as the console (management-console PR #830).
const CONNECTION_URL_PATTERN = /^https?:\/\/([^/?#@\\\s]+)(\/[^?#\\\s]*)?$/iu;

/**
 * Whether a connection URL typed by the operator is acceptable for a test.
 * The WHATWG parser repairs forms such as `http:host`, so the raw text is
 * checked first.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidConnectionUrl(value) {
    if (typeof value !== "string") {
        return false;
    }

    const trimmed = value.trim();
    const match = CONNECTION_URL_PATTERN.exec(trimmed);
    if (!match || trimmed.length > MAX_CONNECTION_URL_LENGTH) {
        return false;
    }

    const path = match[2] || "";
    if (path.split("/").some(segment => segment === "." || segment === "..")) {
        return false;
    }

    try {
        const parsed = new URL(trimmed);
        return Boolean(parsed.hostname) && !parsed.username && !parsed.password
            && !parsed.search && !parsed.hash;
    } catch {
        return false;
    }
}

/**
 * EthicApp locale for a `locale` parameter or header: `es_CL` when it is
 * Spanish, `en_US` otherwise.
 * @param {unknown} value
 * @returns {"es_CL" | "en_US"}
 */
export function normalizeCatalogLocale(value) {
    return /^es(?:[-_]|$)/iu.test(String(value ?? "").trim()) ? "es_CL" : "en_US";
}

/** The `Accept-Language` sent to AI Additions for an EthicApp locale. */
export function acceptLanguageFor(locale) {
    return normalizeCatalogLocale(locale) === "es_CL" ? "es-CL" : "en-US";
}

/** The response did not have the shape of the catalog contract. */
export class InvalidCatalogResponseError extends Error {
    constructor(reason) {
        super(`Invalid AI Additions catalog response: ${reason}`);
        this.name = "InvalidCatalogResponseError";
        this.code = AI_SERVICES_ERROR.INVALID_RESPONSE;
    }
}

class DeadlineExceededError extends Error {
    constructor() {
        super("The AI Additions request took too long.");
        this.name = "TimeoutError";
    }
}

function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}

function validateCatalogService(service, index) {
    if (!service || typeof service !== "object" || Array.isArray(service)) {
        throw new InvalidCatalogResponseError(`services[${index}] is not an object`);
    }
    if (typeof service.id !== "string" || !SERVICE_ID_PATTERN.test(service.id)) {
        throw new InvalidCatalogResponseError(`services[${index}].id is not a service id`);
    }
    for (const key of ["name", "description", "descriptorPath", "apiBasePath"]) {
        if (!isNonEmptyString(service[key])) {
            throw new InvalidCatalogResponseError(`services[${index}].${key} is missing`);
        }
    }
    if (typeof service.usesLlm !== "boolean") {
        throw new InvalidCatalogResponseError(`services[${index}].usesLlm is not a boolean`);
    }
    if (!SERVICE_STATUSES.has(service.status)) {
        throw new InvalidCatalogResponseError(`services[${index}].status is not a known status`);
    }

    return {
        id:          service.id,
        name:        service.name,
        description: service.description,
        usesLlm:     service.usesLlm,
        status:      service.status,
    };
}

/**
 * Validates a `GET /catalog/v1/services` body against contract version 1
 * (`service-catalog.v1.schema.json` in ethicapp-ai-additions) and keeps only
 * the fields EthicApp passes on. Unknown extra fields are ignored.
 * @param {unknown} body
 * @returns {{ contractVersion: string, services: object[] }}
 * @throws {InvalidCatalogResponseError}
 */
export function parseCatalogResponse(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new InvalidCatalogResponseError("the body is not a JSON object");
    }
    if (body.contractVersion !== CATALOG_CONTRACT_VERSION) {
        throw new InvalidCatalogResponseError("unsupported contractVersion");
    }
    if (!Array.isArray(body.services)) {
        throw new InvalidCatalogResponseError("services is not an array");
    }

    const services = body.services.map(validateCatalogService);
    if (new Set(services.map(service => service.id)).size !== services.length) {
        throw new InvalidCatalogResponseError("a service id is repeated");
    }

    return { contractVersion: body.contractVersion, services };
}

/**
 * The EthicApp adapters each AI Additions service enables: the non-development
 * catalog entries whose `requires` include it.
 * @param {{ services: object[] }} adapterCatalog  The parsed `manifest.json`.
 * @returns {Map<string, { id: string, description: string|null }[]>}
 */
export function adaptersByRequiredService(adapterCatalog) {
    const adapters = new Map();

    for (const entry of adapterCatalog?.services ?? []) {
        if (entry?.development === true || !Array.isArray(entry?.requires)) {
            continue;
        }
        for (const serviceId of entry.requires) {
            const list = adapters.get(serviceId) ?? [];
            list.push({
                id:          entry.id,
                description: typeof entry.description === "string" ? entry.description : null,
            });
            adapters.set(serviceId, list);
        }
    }

    return adapters;
}

function isNetworkError(error) {
    if (!error) {
        return false;
    }
    if (error instanceof DeadlineExceededError
        || error.name === "AbortError" || error.name === "TimeoutError") {
        return true;
    }
    if (NETWORK_ERROR_CODES.has(error.code) || NETWORK_ERROR_CODES.has(error.cause?.code)) {
        return true;
    }
    // undici reports every transport failure as `TypeError: fetch failed`.
    return error instanceof TypeError;
}

/**
 * The typed error code for a failed exchange with AI Additions.
 * @param {unknown} error
 * @returns {"not_configured" | "unreachable" | "unauthorized" | "invalid_response"}
 */
export function classifyAiAdditionsError(error) {
    if (isAiAdditionsNotConfigured(error)) {
        return AI_SERVICES_ERROR.NOT_CONFIGURED;
    }

    const status = Number(error?.statusCode);
    if (Number.isInteger(status) && status > 0) {
        if (status === 401 || status === 403) {
            return AI_SERVICES_ERROR.UNAUTHORIZED;
        }
        // A gateway that cannot reach its upstream.
        if (status === 502 || status === 503 || status === 504) {
            return AI_SERVICES_ERROR.UNREACHABLE;
        }
        return AI_SERVICES_ERROR.INVALID_RESPONSE;
    }

    if (isNetworkError(error)) {
        return AI_SERVICES_ERROR.UNREACHABLE;
    }

    // Anything else went wrong with what AI Additions answered, for example a
    // token response without `access_token`.
    return AI_SERVICES_ERROR.INVALID_RESPONSE;
}

// Only the code, the HTTP status and the error class: messages carry URLs and
// bodies, and neither belongs in the log.
function describeFailure(error, code) {
    const status = Number(error?.statusCode);
    const parts = [`error=${code}`];
    if (Number.isInteger(status) && status > 0) {
        parts.push(`status=${status}`);
    } else if (error?.name) {
        parts.push(`cause=${error.name}`);
    }
    return parts.join(" ");
}

async function loadManifestFromDisk(manifestUrl = DEFAULT_MANIFEST_URL) {
    const manifest = JSON.parse(await fs.readFile(manifestUrl, "utf8"));
    assertValidCatalog(validateCatalog(manifest), "manifest.json");
    return manifest;
}

/**
 * @param {object} [options]
 * @param {import("./ai-additions-client.service.js").AiAdditionsClient} [options.client]
 *   Client bound to the stored connection; its `withConnection()` serves tests.
 * @param {() => Promise<{ services: object[] }>} [options.loadAdapterCatalog]
 * @param {{ warn: Function }} [options.logger]
 */
export function createAiServicesCatalogService({
    client = aiAdditionsClient,
    loadAdapterCatalog = loadManifestFromDisk,
    logger = console,
    catalogDeadlineMs = DEFAULT_CATALOG_DEADLINE_MS,
    tokenStepDeadlineMs = DEFAULT_TOKEN_STEP_DEADLINE_MS,
    catalogStepDeadlineMs = DEFAULT_CATALOG_STEP_DEADLINE_MS,
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
} = {}) {
    let adapterCatalogRequest = null;

    // The adapter catalog is shipped code: read it once. A failed read is not
    // cached, so the next call tries again.
    function adapterCatalog() {
        if (!adapterCatalogRequest) {
            adapterCatalogRequest = Promise.resolve()
                .then(loadAdapterCatalog)
                .catch((error) => {
                    adapterCatalogRequest = null;
                    throw error;
                });
        }
        return adapterCatalogRequest;
    }

    function withDeadline(promise, deadlineMs) {
        let timeoutId;
        const deadline = new Promise((resolve, reject) => {
            timeoutId = setTimeoutImpl(() => reject(new DeadlineExceededError()), deadlineMs);
        });
        return Promise.race([promise, deadline]).finally(() => clearTimeoutImpl(timeoutId));
    }

    async function fetchCatalog(targetClient, locale, timeoutMs) {
        const body = await targetClient.requestJson(CATALOG_PATH, {
            method:  "GET",
            headers: {
                "Accept":          "application/json",
                "Accept-Language": acceptLanguageFor(locale),
            },
            timeoutMs,
        });
        return parseCatalogResponse(body);
    }

    function hasClientCredentials(targetClient) {
        return Boolean(targetClient.getKeycloakClientId()
            && targetClient.getKeycloakClientSecret());
    }

    function failure(step, error) {
        const code = classifyAiAdditionsError(error);
        logger.warn(`[ai-services] ${step} failed: ${describeFailure(error, code)}`);
        return code;
    }

    /**
     * Reads the catalog through the stored connection.
     * @param {{ locale?: string }} [options]
     * @returns {Promise<object>} `{ ok: true, contractVersion, locale, services }`
     *   or `{ ok: false, error }`.
     * @throws when the connection cannot be read (a database failure) or the
     *   adapter catalog is broken: those are EthicApp's own errors.
     */
    async function readCatalog({ locale } = {}) {
        const normalizedLocale = normalizeCatalogLocale(locale);

        // Reading the connection is EthicApp's own business: a database
        // failure propagates instead of being reported as an AI Additions error.
        try {
            await client.getEndpoints();
        } catch (error) {
            if (isAiAdditionsNotConfigured(error)) {
                return { ok: false, error: AI_SERVICES_ERROR.NOT_CONFIGURED };
            }
            throw error;
        }

        if (!hasClientCredentials(client)) {
            logger.warn("[ai-services] catalog read failed: "
                + "error=unauthorized cause=MissingClientCredentials");
            return { ok: false, error: AI_SERVICES_ERROR.UNAUTHORIZED };
        }

        const adapters = adaptersByRequiredService(await adapterCatalog());

        let catalog;
        try {
            catalog = await withDeadline(
                fetchCatalog(client, normalizedLocale, catalogDeadlineMs),
                catalogDeadlineMs
            );
        } catch (error) {
            return { ok: false, error: failure("catalog read", error) };
        }

        return {
            ok:              true,
            contractVersion: catalog.contractVersion,
            locale:          normalizedLocale,
            services:        catalog.services.map(service => ({
                ...service,
                available: service.status === "available",
                adapters:  (adapters.get(service.id) ?? []).map(adapter => ({ ...adapter })),
            })),
        };
    }

    /**
     * Obtains a token and reads the catalog against an unsaved connection.
     * Nothing is stored, and the shared client's token cache is not touched.
     * @param {{ baseUrl: string, keycloakPublicUrl?: string|null, locale?: string }} input
     *   URLs already validated with `isValidConnectionUrl`.
     * @returns {Promise<object>} `{ ok, token: { ok, error? }, catalog: { ok, error?,
     *   skipped? }, serviceCount }`.
     */
    async function testConnection({ baseUrl, keycloakPublicUrl = null, locale } = {}) {
        const testClient = client.withConnection({
            baseUrl:           baseUrl.trim(),
            keycloakPublicUrl: keycloakPublicUrl ? keycloakPublicUrl.trim() : null,
        });
        const result = {
            ok:           false,
            token:        { ok: false },
            catalog:      { ok: false, skipped: true },
            serviceCount: null,
        };

        if (!hasClientCredentials(testClient)) {
            logger.warn("[ai-services] connection test token failed: "
                + "error=unauthorized cause=MissingClientCredentials");
            result.token = { ok: false, error: AI_SERVICES_ERROR.UNAUTHORIZED };
            return result;
        }

        try {
            await withDeadline(testClient.getAccessToken(), tokenStepDeadlineMs);
            result.token = { ok: true };
        } catch (error) {
            result.token = { ok: false, error: failure("connection test token", error) };
            return result;
        }

        try {
            const catalog = await withDeadline(
                fetchCatalog(testClient, locale, catalogStepDeadlineMs),
                catalogStepDeadlineMs
            );
            result.catalog = { ok: true };
            result.serviceCount = catalog.services.length;
            result.ok = true;
        } catch (error) {
            result.catalog = { ok: false, error: failure("connection test catalog", error) };
        }

        return result;
    }

    return { readCatalog, testConnection };
}

const aiServicesCatalogService = createAiServicesCatalogService();

export default aiServicesCatalogService;
