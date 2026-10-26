/**
 * Everything EthicApp derives from the stored AI Additions connection (#814).
 *
 * The connection (`ai_additions_connection`, read through
 * `helpers/ai-service-policy.js#getConnection`) holds `baseUrl` and an optional
 * `keycloakPublicUrl`. EthicApp reaches AI Additions through `baseUrl` only,
 * Keycloak included, because the public Keycloak URL may not be reachable
 * from inside the container (hairpin NAT, split DNS). `keycloakPublicUrl` only
 * sets the issuer EthicApp expects in callback tokens: with a fixed
 * `KC_HOSTNAME`, Keycloak issues the same `iss` whatever host a request comes
 * through.
 *
 * Without a connection there is nothing to derive: callers get an
 * `AiAdditionsNotConfiguredError` and must not send any request.
 */

export const AI_ADDITIONS_NOT_CONFIGURED = "not_configured";
export const DEFAULT_KEYCLOAK_REALM = "ethicapp-ai-additions";

/**
 * Thrown by every AI Additions call when no connection is stored. Callers
 * recognize it by `code === "not_configured"` (`isAiAdditionsNotConfigured`),
 * never by message.
 */
export class AiAdditionsNotConfiguredError extends Error {
    constructor(message = "The AI Additions connection is not configured.") {
        super(message);
        this.name = "AiAdditionsNotConfiguredError";
        this.code = AI_ADDITIONS_NOT_CONFIGURED;
    }
}

export function isAiAdditionsNotConfigured(error) {
    return error?.code === AI_ADDITIONS_NOT_CONFIGURED;
}

function normalizeText(value) {
    return value === null || value === undefined ? "" : String(value).trim();
}

function trimTrailingSlash(value) {
    return normalizeText(value).replace(/\/+$/u, "");
}

// An explicit http(s) authority right after the scheme, as the management
// console requires (#829): `^https?://[^/?#\s]+`.
const AI_ADDITIONS_URL_PATTERN = /^https?:\/\/([^/?#\s]+)/iu;

/**
 * Whether a stored connection URL (`base_url` or `keycloak_public_url`) is one
 * EthicApp may derive endpoints from (#815). The raw value must be an http(s)
 * URL with an explicit authority (`^https?://[^/?#\s]+`), without userinfo,
 * query string, fragment or whitespace; a path prefix is allowed. The
 * management console refuses other values, but rows inserted by hand bypass
 * it, and the database CHECK only requires `^https?://`. A query string would
 * otherwise move the Keycloak path of the derived URLs into the query.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidAiAdditionsUrl(value) {
    if (typeof value !== "string" || /[\s?#]/u.test(value)) {
        return false;
    }

    const authority = AI_ADDITIONS_URL_PATTERN.exec(value)?.[1];
    if (!authority || authority.includes("@")) {
        return false;
    }

    try {
        const url = new URL(value);
        return (url.protocol === "http:" || url.protocol === "https:")
            && url.hostname.length > 0
            && !url.username
            && !url.password;
    } catch {
        return false;
    }
}

function isAbsent(value) {
    return value === null || value === undefined || value === "";
}

/**
 * Whether a stored connection can be used: a valid `baseUrl` and, when set, a
 * valid `keycloakPublicUrl` (`isValidAiAdditionsUrl`). An invalid connection
 * counts as no connection.
 * @param {{ baseUrl?: unknown, keycloakPublicUrl?: unknown } | null | undefined} connection
 * @returns {boolean}
 */
export function isUsableAiAdditionsConnection(connection) {
    return isValidAiAdditionsUrl(connection?.baseUrl)
        && (isAbsent(connection.keycloakPublicUrl)
            || isValidAiAdditionsUrl(connection.keycloakPublicUrl));
}

/** The Keycloak realm of the EthicApp client (`AI_ADDITIONS_KEYCLOAK_REALM`). */
export function readKeycloakRealm(env = process.env) {
    return normalizeText(env.AI_ADDITIONS_KEYCLOAK_REALM) || DEFAULT_KEYCLOAK_REALM;
}

/**
 * A string that changes whenever a connection change can change a derived URL,
 * or null when there is no connection. Caches keyed by it are dropped when the
 * operator edits or removes the connection.
 * @param {{ baseUrl?: string, keycloakPublicUrl?: string|null } | null} connection
 * @returns {string|null}
 */
export function connectionFingerprint(connection) {
    const baseUrl = trimTrailingSlash(connection?.baseUrl);
    if (!baseUrl) {
        return null;
    }

    return `${baseUrl}\n${trimTrailingSlash(connection.keycloakPublicUrl)}`;
}

/**
 * @typedef {Object} AiAdditionsEndpoints
 * @property {string} baseUrl   The gateway, without trailing slash.
 * @property {string} realm     The Keycloak realm.
 * @property {string} tokenUrl  `baseUrl/keycloak/realms/<realm>/protocol/openid-connect/token`.
 * @property {string} jwksUrl   `baseUrl/keycloak/realms/<realm>/protocol/openid-connect/certs`.
 * @property {string} issuer    `<keycloakPublicUrl || baseUrl/keycloak>/realms/<realm>`.
 * @property {string} fingerprint `connectionFingerprint(connection)`.
 */

/**
 * Derives every URL EthicApp uses from a connection.
 * @param {{ baseUrl: string, keycloakPublicUrl?: string|null } | null} connection
 * @param {{ realm?: string }} [options]
 * @returns {Readonly<AiAdditionsEndpoints>}
 * @throws {AiAdditionsNotConfiguredError} without a connection, or when one
 *         of its URLs is invalid (`isUsableAiAdditionsConnection`).
 */
export function deriveAiAdditionsEndpoints(connection, { realm = DEFAULT_KEYCLOAK_REALM } = {}) {
    const baseUrl = trimTrailingSlash(connection?.baseUrl);
    if (!baseUrl) {
        throw new AiAdditionsNotConfiguredError();
    }
    if (!isUsableAiAdditionsConnection(connection)) {
        throw new AiAdditionsNotConfiguredError(
            "The stored AI Additions connection has an invalid base_url or keycloak_public_url."
        );
    }

    const realmSegment = encodeURIComponent(realm);
    const internalRealmUrl = `${baseUrl}/keycloak/realms/${realmSegment}`;
    const publicKeycloakUrl = trimTrailingSlash(connection.keycloakPublicUrl)
        || `${baseUrl}/keycloak`;

    return Object.freeze({
        baseUrl,
        realm,
        tokenUrl:    `${internalRealmUrl}/protocol/openid-connect/token`,
        jwksUrl:     `${internalRealmUrl}/protocol/openid-connect/certs`,
        issuer:      `${publicKeycloakUrl}/realms/${realmSegment}`,
        fingerprint: connectionFingerprint(connection),
    });
}

/**
 * Joins a base URL and relative path segments with single slashes. Absolute
 * URLs are not accepted as segments: every request goes to the connection.
 * @param {string} baseUrl
 * @param {...string} segments
 */
export function joinUrl(baseUrl, ...segments) {
    return segments.reduce((url, segment) => {
        const text = normalizeText(segment);
        if (!text) {
            return url;
        }
        if (/^[a-z][a-z\d+.-]*:/iu.test(text) || text.startsWith("//")) {
            throw new Error(`AI Additions paths must be relative to the connection: ${text}`);
        }
        return `${url.replace(/\/+$/u, "")}${text.startsWith("/") ? text : `/${text}`}`;
    }, trimTrailingSlash(baseUrl));
}
