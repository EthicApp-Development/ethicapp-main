import { createClient } from "redis";
import RedisStore from "connect-redis";
import { resolveApplicationRedisUrl } from "./application-redis.js";

// Express sessions live on the application Redis (REDIS_APP_*).
function createSessionRedisClient() {
    const client = createClient({ url: resolveApplicationRedisUrl() });

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
