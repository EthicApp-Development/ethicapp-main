import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createSlidingWindowThrottle } from "../sliding-window-throttle.js";

describe("createSlidingWindowThrottle", () => {
    it("allows `limit` hits per key within the window", () => {
        let clock = 0;
        const throttle = createSlidingWindowThrottle({
            limit:    3,
            windowMs: 1000,
            now:      () => clock,
        });

        assert.equal(throttle.tryAcquire("7").allowed, true);
        clock = 100;
        assert.equal(throttle.tryAcquire("7").allowed, true);
        clock = 200;
        assert.equal(throttle.tryAcquire("7").allowed, true);
        clock = 300;
        assert.deepEqual(throttle.tryAcquire("7"), { allowed: false, retryAfterMs: 700 });
        assert.equal(throttle.tryAcquire("8").allowed, true, "keys are independent");

        clock = 1000;
        assert.equal(throttle.tryAcquire("7").allowed, true, "the oldest hit left the window");
        assert.equal(throttle.tryAcquire("7").allowed, false);
        clock = 1100;
        assert.equal(throttle.tryAcquire("7").allowed, true);
    });

    it("defaults to 30 lookups per minute", () => {
        let clock = 0;
        const throttle = createSlidingWindowThrottle({ now: () => clock });
        for (let index = 0; index < 30; index += 1) {
            assert.equal(throttle.tryAcquire("7").allowed, true);
        }
        assert.equal(throttle.tryAcquire("7").allowed, false);
        clock = 60000;
        assert.equal(throttle.tryAcquire("7").allowed, true);
    });
});
