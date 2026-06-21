const DEFAULT_CLOCK_TOLERANCE_SECONDS = 30;
const JWKS_CACHE_TTL_MS = 300_000;

const CRYPTO_PARAMS = {
    RS256: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    RS384: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-384" },
    RS512: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-512" },
    ES256: { name: "ECDSA", hash: "SHA-256" },
    ES384: { name: "ECDSA", hash: "SHA-384" },
    ES512: { name: "ECDSA", hash: "SHA-512" },
};

function base64urlDecode(str) {
    const base64 = str.replace(/-/gu, "+").replace(/_/gu, "/");
    const padded = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, "=");
    return Uint8Array.from(Buffer.from(padded, "base64"));
}

function parseJwtParts(token) {
    const parts = String(token).split(".");
    if (parts.length !== 3) {
        const error = new Error("Invalid JWT format.");
        error.statusCode = 401;
        throw error;
    }
    try {
        const header = JSON.parse(Buffer.from(base64urlDecode(parts[0])).toString("utf8"));
        const payload = JSON.parse(Buffer.from(base64urlDecode(parts[1])).toString("utf8"));
        return { header, payload, rawParts: parts };
    } catch {
        const error = new Error("JWT header or payload could not be decoded.");
        error.statusCode = 401;
        throw error;
    }
}

async function importJwk(jwk, alg) {
    const params = CRYPTO_PARAMS[alg];
    if (!params) {
        const error = new Error(`Unsupported JWT algorithm: ${alg}`);
        error.statusCode = 401;
        throw error;
    }

    const importParams = alg.startsWith("ES")
        ? { name: params.name, namedCurve: jwk.crv }
        : { name: params.name, hash: params.hash };

    return crypto.subtle.importKey("jwk", jwk, importParams, false, ["verify"]);
}

async function verifySignature(rawParts, cryptoKey, alg) {
    const params = CRYPTO_PARAMS[alg];
    const verifyParams = alg.startsWith("ES")
        ? { name: params.name, hash: params.hash }
        : { name: params.name };

    const data = new TextEncoder().encode(`${rawParts[0]}.${rawParts[1]}`);
    const signature = base64urlDecode(rawParts[2]);

    return crypto.subtle.verify(verifyParams, cryptoKey, signature, data);
}

function validateClaims(payload, { issuer, audience, clockToleranceSeconds }) {
    const now = Math.floor(Date.now() / 1000);
    const tolerance = Number.isFinite(clockToleranceSeconds)
        ? clockToleranceSeconds
        : DEFAULT_CLOCK_TOLERANCE_SECONDS;

    if (issuer && payload.iss !== issuer) {
        const error = new Error(`JWT issuer mismatch. Expected: ${issuer}`);
        error.statusCode = 401;
        throw error;
    }

    if (typeof payload.exp === "number" && now > payload.exp + tolerance) {
        const error = new Error("JWT has expired.");
        error.statusCode = 401;
        throw error;
    }

    if (typeof payload.nbf === "number" && now < payload.nbf - tolerance) {
        const error = new Error("JWT is not yet valid.");
        error.statusCode = 401;
        throw error;
    }

    if (audience) {
        const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
        if (!aud.includes(audience)) {
            const error = new Error("JWT audience mismatch.");
            error.statusCode = 401;
            throw error;
        }
    }
}

function extractRealmRoles(payload) {
    const roles = payload?.realm_access?.roles;
    return Array.isArray(roles) ? roles : [];
}

export class JwksCache {
    constructor({ fetchImpl = globalThis.fetch, cacheTtlMs = JWKS_CACHE_TTL_MS } = {}) {
        this.fetchImpl = fetchImpl;
        this.cacheTtlMs = cacheTtlMs;
        this.keys = null;
        this.expiresAt = 0;
    }

    async fetch(jwksUrl) {
        const now = Date.now();
        if (this.keys && now < this.expiresAt) {
            return this.keys;
        }

        const response = await this.fetchImpl(jwksUrl);
        if (!response.ok) {
            const error = new Error(`JWKS fetch failed: HTTP ${response.status} from ${jwksUrl}`);
            error.statusCode = 500;
            throw error;
        }

        const data = await response.json();
        this.keys = Array.isArray(data.keys) ? data.keys : [];
        this.expiresAt = now + this.cacheTtlMs;
        return this.keys;
    }

    invalidate() {
        this.keys = null;
        this.expiresAt = 0;
    }

    findKey(keys, kid) {
        return kid ? keys.find(k => k.kid === kid) : keys[0];
    }

    async resolveKey(jwksUrl, kid) {
        let keys = await this.fetch(jwksUrl);
        let key = this.findKey(keys, kid);

        if (!key && kid) {
            this.invalidate();
            keys = await this.fetch(jwksUrl);
            key = this.findKey(keys, kid);
        }

        if (!key) {
            const error = new Error(kid ? `No JWKS key found for kid: ${kid}` : "JWKS is empty.");
            error.statusCode = 401;
            throw error;
        }

        return key;
    }
}

export async function verifyKeycloakJwt(token, {
    jwksUrl,
    issuer,
    audience,
    clockToleranceSeconds,
    jwksCache,
}) {
    const { header, payload, rawParts } = parseJwtParts(token);

    const alg = header.alg;
    if (!CRYPTO_PARAMS[alg]) {
        const error = new Error(`Unsupported JWT algorithm: ${alg}`);
        error.statusCode = 401;
        throw error;
    }

    const jwk = await jwksCache.resolveKey(jwksUrl, header.kid);
    const cryptoKey = await importJwk(jwk, alg);
    const valid = await verifySignature(rawParts, cryptoKey, alg);

    if (!valid) {
        const error = new Error("JWT signature verification failed.");
        error.statusCode = 401;
        throw error;
    }

    validateClaims(payload, { issuer, audience, clockToleranceSeconds });

    return {
        sub:      payload.sub,
        iss:      payload.iss,
        aud:      payload.aud,
        clientId: payload.azp || payload.client_id || null,
        roles:    extractRealmRoles(payload),
        scope:    payload.scope || "",
        payload,
    };
}
