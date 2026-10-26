import {
    AiAdditionsNotConfiguredError,
    connectionFingerprint,
    deriveAiAdditionsEndpoints,
    isAiAdditionsNotConfigured,
    joinUrl,
    readKeycloakRealm,
} from "../helpers/ai-additions-connection.js";
import { getConnection as getStoredConnection } from "../helpers/ai-service-policy.js";

export { AiAdditionsNotConfiguredError, isAiAdditionsNotConfigured };

const DEFAULT_HTTP_TIMEOUT_MS = 12000;
const DEFAULT_TOKEN_TTL_MS = 300000;
const TOKEN_EXPIRY_SAFETY_WINDOW_MS = 30000;
// How long a connection read from the database is reused. The management
// console can change it at any time; a few seconds bounds how long EthicApp
// keeps calling a host the operator just replaced or removed.
const DEFAULT_CONNECTION_TTL_MS = 5000;
// How many times one request restarts when the connection changes under it.
const MAX_CONNECTION_RESTARTS = 2;

function normalizeText(value) {
    if (value === null || value === undefined) {
        return "";
    }

    const text = String(value).trim();
    return text.length > 0 ? text : "";
}

function readPositiveInteger(value, fallback, minimum = 1) {
    const configured = Number(value);
    return Number.isInteger(configured) && configured >= minimum ? configured : fallback;
}

// Tokens are bound to the connection (and token URL) they were obtained from.
function tokenKey(endpoints) {
    return `${endpoints.fingerprint}\n${endpoints.tokenUrl}`;
}

function safeJsonParse(value) {
    try {
        return JSON.parse(value);
    } catch (error) {
        return null;
    }
}

/**
 * HTTP client for AI Additions (#814). Every URL derives from the stored
 * connection (`getConnection`), reread at most every `connectionTtlMs`:
 *
 * - tokens: `base_url/keycloak/realms/<realm>/protocol/openid-connect/token`,
 *   with the client credentials from `AI_ADDITIONS_KEYCLOAK_*`;
 * - API calls: `base_url + basePath + pathname`.
 *
 * Without a connection every call rejects with `AiAdditionsNotConfiguredError`
 * (`code: "not_configured"`) before any request leaves the host, whether the
 * call is authenticated or not. When the connection changes, the cached token
 * is dropped.
 */
export class AiAdditionsClient {
    /**
     * @param {object} [options]
     * @param {object} [options.env]  Source of the kept AI_ADDITIONS_* variables.
     * @param {Function} [options.fetchImpl]
     * @param {() => Promise<{ baseUrl: string, keycloakPublicUrl?: string|null } | null>}
     *   [options.getConnection]  Reads the stored connection; defaults to the database.
     * @param {number} [options.connectionTtlMs]  How long a read connection is reused.
     */
    constructor({
        env = process.env,
        fetchImpl = globalThis.fetch,
        getConnection = getStoredConnection,
        connectionTtlMs = DEFAULT_CONNECTION_TTL_MS,
        now = () => Date.now(),
        setTimeoutImpl = setTimeout,
        clearTimeoutImpl = clearTimeout,
    } = {}) {
        if (typeof fetchImpl !== "function") {
            throw new Error("AiAdditionsClient requires a fetch implementation.");
        }
        if (typeof getConnection !== "function") {
            throw new Error("AiAdditionsClient requires a getConnection function.");
        }

        this.env = env;
        this.fetchImpl = fetchImpl;
        this.getConnection = getConnection;
        this.connectionTtlMs = connectionTtlMs;
        this.now = now;
        this.setTimeoutImpl = setTimeoutImpl;
        this.clearTimeoutImpl = clearTimeoutImpl;
        this.connectionCache = { connection: null, fingerprint: null, expiresAtMs: 0 };
        this.connectionRequest = null;
        this.tokenCache = { token: null, key: null, expiresAtMs: 0, sequence: 0 };
        this.tokenRequest = null;
        this.tokenSequence = 0;
    }

    /**
     * A client bound to a given connection instead of the stored one, with
     * its own token cache. Used to test a connection before saving it.
     * @param {{ baseUrl: string, keycloakPublicUrl?: string|null } | null} connection
     */
    withConnection(connection) {
        const fixed = connection ? { ...connection } : null;
        return new AiAdditionsClient({
            env:              this.env,
            fetchImpl:        this.fetchImpl,
            getConnection:    async () => fixed,
            connectionTtlMs:  0,
            now:              this.now,
            setTimeoutImpl:   this.setTimeoutImpl,
            clearTimeoutImpl: this.clearTimeoutImpl,
        });
    }

    getHttpTimeoutMs() {
        return readPositiveInteger(
            this.env.AI_ADDITIONS_HTTP_TIMEOUT_MS,
            DEFAULT_HTTP_TIMEOUT_MS,
            1000
        );
    }

    getKeycloakRealm() {
        return readKeycloakRealm(this.env);
    }

    getKeycloakClientId() {
        return normalizeText(this.env.AI_ADDITIONS_KEYCLOAK_CLIENT_ID);
    }

    getKeycloakClientSecret() {
        return normalizeText(this.env.AI_ADDITIONS_KEYCLOAK_CLIENT_SECRET);
    }

    getKeycloakScope() {
        return normalizeText(this.env.AI_ADDITIONS_KEYCLOAK_SCOPE);
    }

    /**
     * The stored connection, reread when the cached copy expired. Errors other
     * than "no connection" (a database failure) propagate and are not cached.
     * @returns {Promise<object|null>}
     */
    async readConnection() {
        if (this.connectionCache.expiresAtMs > this.now()) {
            return this.connectionCache.connection;
        }

        if (!this.connectionRequest) {
            this.connectionRequest = (async () => {
                const connection = (await this.getConnection()) ?? null;
                const fingerprint = connectionFingerprint(connection);

                if (fingerprint !== this.connectionCache.fingerprint) {
                    this.clearAccessToken();
                }

                this.connectionCache = {
                    connection,
                    fingerprint,
                    expiresAtMs: this.now() + this.connectionTtlMs,
                };
                return connection;
            })();
        }

        try {
            return await this.connectionRequest;
        } finally {
            this.connectionRequest = null;
        }
    }

    /**
     * Every URL derived from the current connection.
     * @returns {Promise<import("../helpers/ai-additions-connection.js").AiAdditionsEndpoints>}
     * @throws {AiAdditionsNotConfiguredError} without a connection.
     */
    async getEndpoints() {
        const connection = await this.readConnection();
        return deriveAiAdditionsEndpoints(connection, { realm: this.getKeycloakRealm() });
    }

    /**
     * The fingerprint of the current connection, or null when none is stored.
     * Caches of data fetched from AI Additions key on it.
     * @returns {Promise<string|null>}
     */
    async getConnectionFingerprint() {
        try {
            return (await this.getEndpoints()).fingerprint;
        } catch (error) {
            if (isAiAdditionsNotConfigured(error)) {
                return null;
            }
            throw error;
        }
    }

    /**
     * `base_url` followed by the given relative path segments.
     * @throws {AiAdditionsNotConfiguredError} without a connection.
     */
    async resolveServiceUrl(...segments) {
        const { baseUrl } = await this.getEndpoints();
        return joinUrl(baseUrl, ...segments);
    }

    clearAccessToken() {
        // Token requests started before this point can no longer fill the cache.
        this.tokenCache = { token: null, key: null, expiresAtMs: 0, sequence: this.tokenSequence };
        this.tokenRequest = null;
    }

    /**
     * A bearer token for the current connection, cached until shortly before
     * it expires.
     * @throws {AiAdditionsNotConfiguredError} without a connection.
     */
    async getAccessToken() {
        return this.getAccessTokenFor(await this.getEndpoints());
    }

    /**
     * A bearer token issued by the Keycloak of one endpoint snapshot. The
     * cache and the pending request are keyed by that snapshot, so a token is
     * only ever reused for the connection it was obtained from.
     * @param {import("../helpers/ai-additions-connection.js").AiAdditionsEndpoints} endpoints
     */
    async getAccessTokenFor(endpoints) {
        const key = tokenKey(endpoints);

        if (
            this.tokenCache.token
            && this.tokenCache.key === key
            && this.tokenCache.expiresAtMs > this.now() + TOKEN_EXPIRY_SAFETY_WINDOW_MS
        ) {
            return this.tokenCache.token;
        }

        if (!this.tokenRequest || this.tokenRequest.key !== key) {
            this.tokenSequence += 1;
            const request = this.requestAccessToken(endpoints.tokenUrl, key, this.tokenSequence);
            this.tokenRequest = { key, request };
        }

        const pending = this.tokenRequest;
        try {
            return await pending.request;
        } finally {
            if (this.tokenRequest === pending) {
                this.tokenRequest = null;
            }
        }
    }

    async requestAccessToken(tokenUrl, key, sequence) {
        const clientId = this.getKeycloakClientId();
        const clientSecret = this.getKeycloakClientSecret();

        if (!clientId || !clientSecret) {
            throw new Error(
                "Missing AI_ADDITIONS_KEYCLOAK_CLIENT_ID or AI_ADDITIONS_KEYCLOAK_CLIENT_SECRET in EthicApp environment."
            );
        }

        const body = new URLSearchParams({
            grant_type:    "client_credentials",
            client_id:     clientId,
            client_secret: clientSecret,
        });

        const scope = this.getKeycloakScope();
        if (scope) {
            body.set("scope", scope);
        }

        const tokenResponse = await this.fetchJsonRaw(tokenUrl, {
            method:  "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body:    body.toString(),
        });

        const accessToken = normalizeText(tokenResponse?.access_token);
        const expiresIn = Number(tokenResponse?.expires_in);

        if (!accessToken) {
            throw new Error("AI Additions Keycloak token endpoint did not return access_token.");
        }

        // A request that resolves late (for a previous connection, or started
        // before the cache was cleared) must not replace a newer token.
        if (sequence <= this.tokenCache.sequence) {
            return accessToken;
        }

        this.tokenCache = {
            token:       accessToken,
            key,
            sequence,
            expiresAtMs: this.now()
                + (Number.isFinite(expiresIn) ? expiresIn * 1000 : DEFAULT_TOKEN_TTL_MS),
        };

        return accessToken;
    }

    async fetchJsonRaw(url, {
        method = "GET",
        body = null,
        headers = {},
        timeoutMs = this.getHttpTimeoutMs(),
    } = {}) {
        const controller = new AbortController();
        const timeoutId = this.setTimeoutImpl(() => controller.abort(), timeoutMs);

        try {
            const response = await this.fetchImpl(url, {
                method,
                headers,
                body,
                signal: controller.signal,
            });

            const rawText = await response.text();
            const parsedBody = rawText ? safeJsonParse(rawText) : null;

            if (!response.ok) {
                const error = new Error(`HTTP ${response.status} request failed on ${url}.`);
                error.statusCode = response.status;
                error.responseBody = parsedBody ?? rawText;
                throw error;
            }

            return parsedBody;
        } finally {
            this.clearTimeoutImpl(timeoutId);
        }
    }

    /**
     * Sends a JSON request to `base_url + basePath + pathname`.
     * @param {string} pathname  Path relative to `basePath`.
     * @param {object} [options]
     * @param {string} [options.basePath]  The service's API path under `base_url`,
     *   for example `/polyadic-agent/api`.
     * @param {boolean} [options.authenticated]  Sends a bearer token (default true).
     * @throws {AiAdditionsNotConfiguredError} without a connection, before any request.
     */
    async requestJson(pathname, {
        method = "GET",
        body = null,
        headers = {},
        basePath = "",
        authenticated = true,
        timeoutMs = this.getHttpTimeoutMs(),
    } = {}) {
        // One attempt uses one endpoint snapshot for the URL and the token, so
        // a token is never sent to a host other than the one it was issued
        // for. If the connection changed while the token was obtained, the
        // attempt restarts from a fresh snapshot instead of mixing them.
        const execute = async () => {
            for (let restarts = 0; ; restarts += 1) {
                const endpoints = await this.getEndpoints();
                const url = joinUrl(endpoints.baseUrl, basePath, pathname);
                const requestHeaders = {
                    "Content-Type": "application/json",
                    ...headers,
                };

                if (authenticated) {
                    const token = await this.getAccessTokenFor(endpoints);
                    const current = await this.getEndpoints();
                    if (current.fingerprint !== endpoints.fingerprint) {
                        if (restarts >= MAX_CONNECTION_RESTARTS) {
                            throw new Error("The AI Additions connection kept changing during the request.");
                        }
                        continue;
                    }
                    requestHeaders.Authorization = `Bearer ${token}`;
                }

                return this.fetchJsonRaw(url, {
                    method,
                    headers: requestHeaders,
                    body:    body == null ? null : JSON.stringify(body),
                    timeoutMs,
                });
            }
        };

        try {
            return await execute();
        } catch (error) {
            if (!authenticated || Number(error?.statusCode) !== 401) {
                throw error;
            }

            this.clearAccessToken();
            return execute();
        }
    }
}

const aiAdditionsClient = new AiAdditionsClient();

export default aiAdditionsClient;
