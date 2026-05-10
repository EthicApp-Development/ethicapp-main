import { createClient } from "redis";
import RedisStore from "connect-redis";

function createSessionRedisClient() {
    const host = process.env.REDIS_HOST || "127.0.0.1";
    const port = process.env.REDIS_PORT || "6379";
    const url = process.env.REDIS_URL || `redis://${host}:${port}`;

    const client = createClient({ url });

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
        ttl: Number(process.env.ETHICAPP_SESSION_TTL_SECONDS || 60 * 60 * 24),
    });
}
