import { createClient } from "redis";
import RedisStore from "connect-redis";

/**
 * Resolves the URL of the Redis instance shared by Express sessions and
 * cross-service domain events.
 * @param {Record<string, string | undefined>} env Environment variables.
 * @returns {string} Redis connection URL.
 */
export function resolveSessionRedisUrl(env = process.env) {
    const host = env.REDIS_SESSION_HOST || "redis-session";
    const port = env.REDIS_SESSION_PORT || "6379";
    return env.REDIS_SESSION_URL || `redis://${host}:${port}`;
}

function createSessionRedisClient() {
    const client = createClient({ url: resolveSessionRedisUrl() });

    client.on("connect", () => {
        console.log("[legacy-session] Connected to Redis.");
    });

    client.on("error", (error) => {
        console.error("[legacy-session] Redis connection error:", error);
    });

    client.connect().catch((error) => {
        console.error("[legacy-session] Redis connection could not be established:", error);
    });

    return client;
}

export function createLegacySessionStore() {
    return new RedisStore({
        client: createSessionRedisClient(),
        prefix: process.env.ETHICAPP_SESSION_REDIS_PREFIX || "ethicapp:sess:",
        ttl:    Number(process.env.ETHICAPP_SESSION_TTL_SECONDS || 60 * 60 * 24),
    });
}
