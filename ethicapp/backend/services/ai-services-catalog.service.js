import fs from "node:fs/promises";

import aiAdditionsClient, {
    AI_ADDITIONS_CREDENTIALS_MISSING,
    isAiAdditionsCredentialsMissing,
} from "./ai-additions-client.service.js";
import {
    isAiAdditionsNotConfigured,
    isValidAiAdditionsUrl,
} from "../helpers/ai-additions-connection.js";
import { getConnection as getStoredConnection } from "../helpers/ai-service-policy.js";
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
    NOT_CONFIGURED:      "not_configured",
    CREDENTIALS_MISSING: AI_ADDITIONS_CREDENTIALS_MISSING,
    UNREACHABLE:         "unreachable",
    UNAUTHORIZED:        "unauthorized",
    INVALID_RESPONSE:    "invalid_response",
    ISSUER_MISMATCH:     "issuer_mismatch",
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

function withoutTrailingSlash(value) {
    return value.endsWith("/") ? value.slice(0, -1) : value;
}

/**
 * The `iss` claim of an access token, read WITHOUT verifying the token: the
 * connection test only compares it with the issuer that callbacks will be
 * checked against. Nothing else from the token leaves this function.
 * @param {unknown} token
 * @returns {string|null} The issuer when the token is a JWT whose payload has
 *   an http(s) `iss` (at most 2048 characters); null otherwise.
 */
export function readUnverifiedIssuer(token) {
    if (typeof token !== "string") {
        return null;
    }
    const parts = token.split(".");
    if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/u.test(parts[1])) {
        return null;
    }

    let payload;
    try {
        payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    } catch {
        return null;
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return null;
    }

    const issuer = payload.iss;
    return isValidAiAdditionsUrl(issuer) && issuer === issuer.trim() ? issuer : null;
}

/**
 * Whether a token issuer matches the expected one. The comparison is exact,
 * letter case included, as the callback verification compares `iss`; only a
 * single trailing slash is ignored on both sides.
 * @param {string} expected
 * @param {string} actual
 */
export function issuersMatch(expected, actual) {
    return withoutTrailingSlash(expected) === withoutTrailingSlash(actual);
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
 * catalog entries whose `requires` include it, with the scopes they work on
 * (`case`, `design`, `response`, `chat`), so the console can group them.
 * @param {{ services: object[] }} adapterCatalog  The parsed `manifest.json`.
 * @returns {Map<string, { id: string, description: string|null, scopes: string[] }[]>}
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
                scopes:      Array.isArray(entry.scopes)
                    ? entry.scopes.filter(scope => typeof scope === "string")
                    : [],
            });
            adapters.set(serviceId, list);
        }
    }

    return adapters;
}

/**
 * An adapter as the catalog read returns it: its id, scopes, and the label and
 * description its `getUiTranslations()` gives for `locale`. Without them the
 * label is null and the description is the catalog's own (in English).
 * @param {{ id: string, description: string|null, scopes: string[] }} adapter
 * @param {object|null} translations  `{ es_CL: { label, description }, en_US: ... }`
 * @param {"es_CL"|"en_US"} locale
 */
export function describeAdapter(adapter, translations, locale) {
    const texts = translations?.[locale] ?? null;
    return {
        id:          adapter.id,
        scopes:      [...adapter.scopes],
        label:       isNonEmptyString(texts?.label) ? texts.label : null,
        description: isNonEmptyString(texts?.description) ? texts.description : adapter.description,
    };
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
 * @returns {"not_configured" | "credentials_missing" | "unreachable" | "unauthorized"
 *   | "invalid_response"}
 */
export function classifyAiAdditionsError(error) {
    if (isAiAdditionsNotConfigured(error)) {
        return AI_SERVICES_ERROR.NOT_CONFIGURED;
    }
    if (isAiAdditionsCredentialsMissing(error)) {
        return AI_SERVICES_ERROR.CREDENTIALS_MISSING;
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

// The adapter's UI texts through the external services registry, which
// validates and caches them. Imported lazily: only the catalog read needs the
// registry, and only once the console asks for it.
async function loadAdapterTranslationsFromRegistry(adapterId) {
    const { default: registry } = await import("./external-services.service.js");
    await registry.initialize();
    return registry.getServiceUiTranslations(adapterId);
}

async function loadManifestFromDisk(manifestUrl = DEFAULT_MANIFEST_URL) {
    const manifest = JSON.parse(await fs.readFile(manifestUrl, "utf8"));
    assertValidCatalog(validateCatalog(manifest), "manifest.json");
    return manifest;
}

/**
 * @param {object} [options]
 * @param {import("./ai-additions-client.service.js").AiAdditionsClient} [options.client]
 *   Source of the credentials, fetch and timers; every request goes through a
 *   `withConnection()` copy bound to one connection snapshot.
 * @param {() => Promise<object|null>} [options.getConnection]  Reads the stored
 *   connection, uncached; defaults to the database.
 * @param {() => Promise<{ services: object[] }>} [options.loadAdapterCatalog]
 * @param {(adapterId: string) => Promise<object|null>} [options.loadAdapterTranslations]
 *   An adapter's `getUiTranslations()` texts, or null; defaults to the registry.
 * @param {{ warn: Function }} [options.logger]
 */
export function createAiServicesCatalogService({
    client = aiAdditionsClient,
    getConnection = getStoredConnection,
    loadAdapterCatalog = loadManifestFromDisk,
    loadAdapterTranslations = loadAdapterTranslationsFromRegistry,
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

    // The texts of every adapter in `adapters`, by id. A failure only costs
    // the labels: the console then shows the adapter ids.
    async function adapterTranslations(adapters) {
        const ids = [...new Set([...adapters.values()].flat().map(adapter => adapter.id))];
        const entries = await Promise.all(ids.map(async (id) => {
            try {
                return [id, await loadAdapterTranslations(id)];
            } catch (error) {
                logger.warn(`[ai-services] UI texts of ${id} are unavailable: `
                    + `cause=${error?.name ?? "Error"}`);
                return [id, null];
            }
        }));
        return new Map(entries);
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

    // Missing client credentials are a gap in EthicApp's own deployment
    // configuration: report them as such, before any request.
    function credentialsMissing(step) {
        logger.warn(`[ai-services] ${step} failed: `
            + "error=credentials_missing cause=MissingClientCredentials");
        return AI_SERVICES_ERROR.CREDENTIALS_MISSING;
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
     *   or `{ ok: false, error }`. Each service lists the EthicApp `adapters` it
     *   enables as `{ id, scopes, label, description }` (see describeAdapter).
     * @throws when the connection cannot be read (a database failure) or the
     *   adapter catalog is broken: those are EthicApp's own errors.
     */
    async function readCatalog({ locale } = {}) {
        const normalizedLocale = normalizeCatalogLocale(locale);

        // The console reloads the catalog right after saving or removing the
        // connection, so this read bypasses the shared client's connection
        // cache: it reads the stored connection now and binds the token and
        // the catalog request to that snapshot. Reading it is EthicApp's own
        // business: a database failure propagates instead of being reported
        // as an AI Additions error.
        const connection = (await getConnection()) ?? null;
        const snapshotClient = client.withConnection(connection);
        try {
            await snapshotClient.getEndpoints();
        } catch (error) {
            if (isAiAdditionsNotConfigured(error)) {
                return { ok: false, error: AI_SERVICES_ERROR.NOT_CONFIGURED };
            }
            throw error;
        }

        if (!hasClientCredentials(snapshotClient)) {
            return { ok: false, error: credentialsMissing("catalog read") };
        }

        const adapters = adaptersByRequiredService(await adapterCatalog());

        let catalog;
        try {
            catalog = await withDeadline(
                fetchCatalog(snapshotClient, normalizedLocale, catalogDeadlineMs),
                catalogDeadlineMs
            );
        } catch (error) {
            return { ok: false, error: failure("catalog read", error) };
        }

        const translations = await adapterTranslations(adapters);
        return {
            ok:              true,
            contractVersion: catalog.contractVersion,
            locale:          normalizedLocale,
            services:        catalog.services.map(service => ({
                ...service,
                available: service.status === "available",
                adapters:  (adapters.get(service.id) ?? []).map(adapter => describeAdapter(
                    adapter,
                    translations.get(adapter.id),
                    normalizedLocale
                )),
            })),
        };
    }

    /**
     * The issuer step: compares the token's `iss`, read without verification,
     * with the issuer EthicApp derives for this connection. Only the two
     * issuers are returned; the token and its other claims are not.
     */
    function checkIssuer(token, expected) {
        const actual = readUnverifiedIssuer(token);
        if (!actual) {
            logger.warn("[ai-services] connection test issuer failed: "
                + "error=invalid_response cause=UnreadableIssuer");
            return { ok: false, error: AI_SERVICES_ERROR.INVALID_RESPONSE, expected };
        }
        if (!issuersMatch(expected, actual)) {
            logger.warn("[ai-services] connection test issuer failed: error=issuer_mismatch");
            return { ok: false, error: AI_SERVICES_ERROR.ISSUER_MISMATCH, expected, actual };
        }
        return { ok: true, expected, actual };
    }

    /**
     * Obtains a token, checks its issuer and reads the catalog against an
     * unsaved connection. Nothing is stored, and the shared client's token
     * cache is not touched.
     * @param {{ baseUrl: string, keycloakPublicUrl?: string|null, locale?: string }} input
     *   URLs already validated with `isValidAiAdditionsUrl`.
     * @returns {Promise<object>} `{ ok, token: { ok, error? }, issuer: { ok, error?,
     *   skipped?, expected, actual? }, catalog: { ok, error?, skipped? }, serviceCount }`.
     */
    async function testConnection({ baseUrl, keycloakPublicUrl = null, locale } = {}) {
        const testClient = client.withConnection({
            baseUrl:           baseUrl.trim(),
            keycloakPublicUrl: keycloakPublicUrl ? keycloakPublicUrl.trim() : null,
        });
        // The issuer callbacks from this connection would be checked against,
        // derived exactly as the callback verification derives it.
        const { issuer: expectedIssuer } = await testClient.getEndpoints();
        const result = {
            ok:           false,
            token:        { ok: false },
            issuer:       { ok: false, skipped: true, expected: expectedIssuer },
            catalog:      { ok: false, skipped: true },
            serviceCount: null,
        };

        if (!hasClientCredentials(testClient)) {
            result.token = { ok: false, error: credentialsMissing("connection test token") };
            return result;
        }

        let token;
        try {
            token = await withDeadline(testClient.getAccessToken(), tokenStepDeadlineMs);
            result.token = { ok: true };
        } catch (error) {
            result.token = { ok: false, error: failure("connection test token", error) };
            return result;
        }

        // A mismatch does not stop the test: the catalog step is independent
        // of it, and the operator sees both answers at once.
        result.issuer = checkIssuer(token, expectedIssuer);

        try {
            const catalog = await withDeadline(
                fetchCatalog(testClient, locale, catalogStepDeadlineMs),
                catalogStepDeadlineMs
            );
            result.catalog = { ok: true };
            result.serviceCount = catalog.services.length;
        } catch (error) {
            result.catalog = { ok: false, error: failure("connection test catalog", error) };
        }

        result.ok = result.token.ok && result.issuer.ok && result.catalog.ok;
        return result;
    }

    return { readCatalog, testConnection };
}

const aiServicesCatalogService = createAiServicesCatalogService();

export default aiServicesCatalogService;
