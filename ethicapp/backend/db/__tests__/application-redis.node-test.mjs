import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveApplicationRedis, resolveApplicationRedisUrl } from "../application-redis.js";

function createLogger() {
    const warnings = [];
    return { warnings, warn: (message) => warnings.push(message) };
}

describe("resolveApplicationRedis", () => {
    it("uses REDIS_APP_* when set", () => {
        const env = { REDIS_APP_HOST: "redis-app.internal", REDIS_APP_PORT: "6380" };
        assert.deepEqual(resolveApplicationRedis(env), {
            url:                 "redis://redis-app.internal:6380",
            deprecatedVariables: []
        });
        assert.equal(
            resolveApplicationRedis({ REDIS_APP_URL: "rediss://user:pass@app:6379" }).url,
            "rediss://user:pass@app:6379"
        );
    });

    it("falls back to REDIS_SESSION_* and reports the deprecated names", () => {
        const env = { REDIS_SESSION_HOST: "redis-session", REDIS_SESSION_PORT: "6379" };
        assert.deepEqual(
            resolveApplicationRedis(env),
            {
                url:                 "redis://redis-session:6379",
                deprecatedVariables: ["REDIS_SESSION_HOST", "REDIS_SESSION_PORT"]
            }
        );
    });

    it("prefers REDIS_APP_* when both groups are set, without mixing them", () => {
        const resolved = resolveApplicationRedis({
            REDIS_APP_HOST:     "redis-app",
            REDIS_SESSION_HOST: "redis-session",
            REDIS_SESSION_URL:  "redis://legacy:6379"
        });

        assert.deepEqual(resolved, { url: "redis://redis-app:6379", deprecatedVariables: [] });
    });

    it("defaults to the redis-app service", () => {
        assert.deepEqual(resolveApplicationRedis({}), {
            url:                 "redis://redis-app:6379",
            deprecatedVariables: []
        });
    });
});

describe("resolveApplicationRedisUrl", () => {
    it("warns once per process when only REDIS_SESSION_* is configured", () => {
        const logger = createLogger();
        const processKey = {};
        const env = { REDIS_SESSION_HOST: "redis-session" };

        const url = resolveApplicationRedisUrl(env, logger, processKey);
        assert.equal(url, "redis://redis-session:6379");
        resolveApplicationRedisUrl(env, logger, processKey);

        assert.equal(logger.warnings.length, 1);
        assert.match(logger.warnings[0], /REDIS_SESSION_HOST/);
        assert.match(logger.warnings[0], /REDIS_APP_\*/);
    });

    it("does not warn with REDIS_APP_*", () => {
        const logger = createLogger();

        resolveApplicationRedisUrl({ REDIS_APP_HOST: "redis-app" }, logger, {});

        assert.deepEqual(logger.warnings, []);
    });
});
