import { JwksCache, verifyKeycloakJwt } from "../helpers/keycloak-jwt.helper.js";

const jwksCache = new JwksCache();

function readEnv(env = process.env) {
    const baseUrl = String(env.AI_ADDITIONS_KEYCLOAK_BASE_URL || "").replace(/\/+$/u, "");
    const realm = String(env.AI_ADDITIONS_KEYCLOAK_REALM || "ethicapp-ai-additions");
    const issuerDefault = baseUrl ? `${baseUrl}/realms/${realm}` : "";

    const issuer = String(env.EXTERNAL_SERVICES_CALLBACK_AUTH_ISSUER || issuerDefault).trim();
    const explicitJwksUrl = String(
        env.EXTERNAL_SERVICES_CALLBACK_AUTH_JWKS_URL || ""
    ).trim();
    const jwksUrl = explicitJwksUrl
        || (issuer ? `${issuer}/protocol/openid-connect/certs` : "");
    const audience = String(env.EXTERNAL_SERVICES_CALLBACK_AUTH_AUDIENCE || "").trim() || null;
    const clockTolerance = Number(env.EXTERNAL_SERVICES_CALLBACK_AUTH_CLOCK_TOLERANCE_SECONDS);
    const clockToleranceSeconds = Number.isFinite(clockTolerance) && clockTolerance >= 0
        ? clockTolerance
        : 30;
    const enabledRaw = String(env.EXTERNAL_SERVICES_CALLBACK_AUTH_ENABLED || "true").trim();
    const enabled = enabledRaw.toLowerCase() !== "false";

    return { issuer: issuer || null, jwksUrl: jwksUrl || null, audience, clockToleranceSeconds, enabled };
}

function extractBearerToken(req) {
    const auth = String(req.headers?.authorization || "").trim();
    if (!auth.toLowerCase().startsWith("bearer ")) {
        return null;
    }

    return auth.slice(7).trim() || null;
}

export function createCallbackAuthMiddleware({
    env = process.env,
    cache = jwksCache,
} = {}) {
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

        if (!config.jwksUrl) {
            console.error(
                "[external-services-callback-auth] JWKS URL could not be derived.",
                "Set EXTERNAL_SERVICES_CALLBACK_AUTH_JWKS_URL or configure AI_ADDITIONS_KEYCLOAK_BASE_URL."
            );
            return res.status(500).json({
                status: "err",
                error:  "Callback authentication is misconfigured.",
            });
        }

        try {
            req.externalServiceAuth = await verifyKeycloakJwt(token, {
                jwksUrl:               config.jwksUrl,
                issuer:                config.issuer,
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
