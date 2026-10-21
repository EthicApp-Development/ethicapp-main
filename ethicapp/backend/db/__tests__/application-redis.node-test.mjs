import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveApplicationRedisUrl } from "../application-redis.js";

describe("resolveApplicationRedisUrl", () => {
    it("builds the URL from REDIS_APP_HOST and REDIS_APP_PORT", () => {
        const env = { REDIS_APP_HOST: "redis-app.internal", REDIS_APP_PORT: "6380" };
        assert.equal(resolveApplicationRedisUrl(env), "redis://redis-app.internal:6380");
    });

    it("prefers REDIS_APP_URL", () => {
        const env = { REDIS_APP_URL: "rediss://user:pass@app:6379", REDIS_APP_HOST: "ignored" };
        assert.equal(resolveApplicationRedisUrl(env), "rediss://user:pass@app:6379");
    });

    it("defaults to the redis-app service", () => {
        assert.equal(resolveApplicationRedisUrl({}), "redis://redis-app:6379");
    });

    it("does not read the former REDIS_SESSION_* names", () => {
        const env = {
            REDIS_SESSION_HOST: "redis-session",
            REDIS_SESSION_URL:  "redis://legacy:6379"
        };
        assert.equal(resolveApplicationRedisUrl(env), "redis://redis-app:6379");
    });
});
