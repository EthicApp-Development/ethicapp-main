const DEFAULT_AI_ADDITIONS_BASE_URL = "http://host.docker.internal:8010";
const DEFAULT_KEYCLOAK_REALM = "ethicapp-ai-additions";
const DEFAULT_HTTP_TIMEOUT_MS = 12000;
const DEFAULT_TOKEN_TTL_MS = 300000;
const TOKEN_EXPIRY_SAFETY_WINDOW_MS = 30000;

function normalizeText(value) {
    if (value === null || value === undefined) {
        return "";
    }

    const text = String(value).trim();
    return text.length > 0 ? text : "";
}

function trimTrailingSlash(value) {
    return normalizeText(value).replace(/\/+$/u, "");
}

function readPositiveInteger(value, fallback, minimum = 1) {
    const configured = Number(value);
    return Number.isInteger(configured) && configured >= minimum ? configured : fallback;
}

function safeJsonParse(value) {
    try {
        return JSON.parse(value);
    } catch (error) {
        return null;
    }
}

export class AiAdditionsClient {
    constructor({
        env = process.env,
        fetchImpl = globalThis.fetch,
        now = () => Date.now(),
        setTimeoutImpl = setTimeout,
        clearTimeoutImpl = clearTimeout,
    } = {}) {
        if (typeof fetchImpl !== "function") {
            throw new Error("AiAdditionsClient requires a fetch implementation.");
        }

        this.env = env;
        this.fetchImpl = fetchImpl;
        this.now = now;
        this.setTimeoutImpl = setTimeoutImpl;
        this.clearTimeoutImpl = clearTimeoutImpl;
        this.tokenCache = {
            token: null,
            expiresAtMs: 0,
        };
        this.tokenRequest = null;
    }

    getBaseUrl() {
        return trimTrailingSlash(this.env.AI_ADDITIONS_BASE_URL) || DEFAULT_AI_ADDITIONS_BASE_URL;
    }

    getHttpTimeoutMs() {
        return readPositiveInteger(
            this.env.AI_ADDITIONS_HTTP_TIMEOUT_MS,
            DEFAULT_HTTP_TIMEOUT_MS,
            1000
        );
    }

    getKeycloakBaseUrl() {
        return trimTrailingSlash(this.env.AI_ADDITIONS_KEYCLOAK_BASE_URL)
            || `${this.getBaseUrl()}/keycloak`;
    }

    getKeycloakRealm() {
        return normalizeText(this.env.AI_ADDITIONS_KEYCLOAK_REALM) || DEFAULT_KEYCLOAK_REALM;
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

    getTokenUrl() {
        const explicitTokenUrl = normalizeText(this.env.AI_ADDITIONS_KEYCLOAK_TOKEN_URL);
        if (explicitTokenUrl) {
            return explicitTokenUrl;
        }

        const realm = encodeURIComponent(this.getKeycloakRealm());
        return `${this.getKeycloakBaseUrl()}/realms/${realm}/protocol/openid-connect/token`;
    }

    buildServiceUrl(pathname, baseUrl = this.getBaseUrl()) {
        const normalizedPath = normalizeText(pathname);
        if (/^https?:\/\//iu.test(normalizedPath)) {
            return normalizedPath;
        }

        const base = trimTrailingSlash(baseUrl);
        const path = normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`;
        return `${base}${path}`;
    }

    clearAccessToken() {
        this.tokenCache.token = null;
        this.tokenCache.expiresAtMs = 0;
        this.tokenRequest = null;
    }

    async getAccessToken() {
        if (
            this.tokenCache.token
            && this.tokenCache.expiresAtMs > this.now() + TOKEN_EXPIRY_SAFETY_WINDOW_MS
        ) {
            return this.tokenCache.token;
        }

        if (!this.tokenRequest) {
            this.tokenRequest = this.requestAccessToken();
        }

        try {
            return await this.tokenRequest;
        } finally {
            this.tokenRequest = null;
        }
    }

    async requestAccessToken() {
        const clientId = this.getKeycloakClientId();
        const clientSecret = this.getKeycloakClientSecret();

        if (!clientId || !clientSecret) {
            throw new Error(
                "Missing AI_ADDITIONS_KEYCLOAK_CLIENT_ID or AI_ADDITIONS_KEYCLOAK_CLIENT_SECRET in EthicApp environment."
            );
        }

        const body = new URLSearchParams({
            grant_type: "client_credentials",
            client_id: clientId,
            client_secret: clientSecret,
        });

        const scope = this.getKeycloakScope();
        if (scope) {
            body.set("scope", scope);
        }

        const tokenResponse = await this.fetchJsonRaw(this.getTokenUrl(), {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: body.toString(),
        });

        const accessToken = normalizeText(tokenResponse?.access_token);
        const expiresIn = Number(tokenResponse?.expires_in);

        if (!accessToken) {
            throw new Error("AI Additions Keycloak token endpoint did not return access_token.");
        }

        this.tokenCache.token = accessToken;
        this.tokenCache.expiresAtMs = this.now()
            + (Number.isFinite(expiresIn) ? expiresIn * 1000 : DEFAULT_TOKEN_TTL_MS);

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

    async requestJson(pathname, {
        method = "GET",
        body = null,
        headers = {},
        baseUrl = this.getBaseUrl(),
        authenticated = true,
    } = {}) {
        const execute = async () => {
            const requestHeaders = {
                "Content-Type": "application/json",
                ...headers,
            };

            if (authenticated) {
                requestHeaders.Authorization = `Bearer ${await this.getAccessToken()}`;
            }

            return this.fetchJsonRaw(this.buildServiceUrl(pathname, baseUrl), {
                method,
                headers: requestHeaders,
                body: body == null ? null : JSON.stringify(body),
            });
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
