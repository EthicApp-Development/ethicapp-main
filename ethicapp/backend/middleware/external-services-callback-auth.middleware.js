import { JwksCache, verifyKeycloakJwt } from "../helpers/keycloak-jwt.helper.js";
import { isAiAdditionsNotConfigured } from "../helpers/ai-additions-connection.js";
import aiAdditionsClient from "../services/ai-additions-client.service.js";

const jwksCache = new JwksCache();

function readEnv(env = process.env) {
    const audience = String(env.EXTERNAL_SERVICES_CALLBACK_AUTH_AUDIENCE || "").trim() || null;
    const clockTolerance = Number(env.EXTERNAL_SERVICES_CALLBACK_AUTH_CLOCK_TOLERANCE_SECONDS);
    const clockToleranceSeconds = Number.isFinite(clockTolerance) && clockTolerance >= 0
        ? clockTolerance
        : 30;
    const enabledRaw = String(env.EXTERNAL_SERVICES_CALLBACK_AUTH_ENABLED || "true").trim();
    const enabled = enabledRaw.toLowerCase() !== "false";

    return { audience, clockToleranceSeconds, enabled };
}

function extractBearerToken(req) {
    const auth = String(req.headers?.authorization || "").trim();
    if (!auth.toLowerCase().startsWith("bearer ")) {
        return null;
    }

    return auth.slice(7).trim() || null;
}

/**
 * Verifies the Keycloak bearer token AI Additions sends with each callback.
 *
 * The issuer and JWKS URL derive from the stored AI Additions connection
 * (#814): the JWKS is fetched through `base_url`, and the expected issuer is
 * `<keycloak_public_url or base_url/keycloak>/realms/<realm>`. Without a
 * connection a callback cannot be verified and is rejected with 503 and
 * `code: "not_configured"`: removing the connection stops all AI traffic,
 * inbound included. With EXTERNAL_SERVICES_CALLBACK_AUTH_ENABLED=false
 * (development only) nothing is verified and the connection is not read.
 *
 * @param {object} [options]
 * @param {() => Promise<{ issuer: string, jwksUrl: string }>} [options.getEndpoints]
 *   URLs derived from the connection; rejects with a `not_configured` error
 *   without one (`AiAdditionsClient#getEndpoints`).
 */
export function createCallbackAuthMiddleware({
    env = process.env,
    cache = jwksCache,
    getEndpoints = () => aiAdditionsClient.getEndpoints(),
} = {}) {
    // JwksCache partitions keys and pending fetches by URL, so keys of a
    // previous host never verify tokens for the current one. When the
    // connection moves, drop the previous host's entries (and discard its
    // fetches still in flight) so they do not linger.
    let cachedJwksUrl = null;

    return async function callbackAuthMiddleware(req, res, next) {
        const config = readEnv(env);

        if (!config.enabled) {
            req.externalServiceAuth = { disabled: true };
            return next();
        }

        const token = extractBearerToken(req);
        if (!token) {
            return res.status(401).json({
                status: "err",
                error:  "Missing or malformed Authorization Bearer token.",
            });
        }

        let endpoints;
        try {
            endpoints = await getEndpoints();
        } catch (error) {
            if (isAiAdditionsNotConfigured(error)) {
                return res.status(503).json({
                    status: "err",
                    code:   "not_configured",
                    error:  "The AI Additions connection is not configured.",
                });
            }

            console.error("[external-services-callback-auth] AI Additions connection unreadable.", error);
            return res.status(500).json({
                status: "err",
                error:  "Callback authentication service unavailable.",
            });
        }

        if (endpoints.jwksUrl !== cachedJwksUrl) {
            cache.invalidate();
            cachedJwksUrl = endpoints.jwksUrl;
        }

        try {
            req.externalServiceAuth = await verifyKeycloakJwt(token, {
                jwksUrl:               endpoints.jwksUrl,
                issuer:                endpoints.issuer,
                audience:              config.audience,
                clockToleranceSeconds: config.clockToleranceSeconds,
                jwksCache:             cache,
            });

            return next();
        } catch (error) {
            const status = Number(error.statusCode) === 500 ? 500 : 401;
            if (status === 500) {
                console.error("[external-services-callback-auth] JWKS fetch error.", error);
            }

            const errorMessage = status === 500
                ? "Callback authentication service unavailable."
                : "Invalid or expired Bearer token.";
            return res.status(status).json({
                status: "err",
                error:  errorMessage,
            });
        }
    };
}

export const callbackAuthMiddleware = createCallbackAuthMiddleware();
