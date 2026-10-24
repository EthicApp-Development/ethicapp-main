// An in-process sliding-window limiter, shared by the throttled preview
// endpoints of the case form: case videos (#780) and case documents (#791).

export const DEFAULT_LIMIT_PER_WINDOW = 30;
export const DEFAULT_WINDOW_MS = 60000;

/**
 * At most `limit` hits per key within `windowMs`. `tryAcquire(key)` records a
 * hit and returns `{ allowed, retryAfterMs }`.
 */
export function createSlidingWindowThrottle({
    limit = DEFAULT_LIMIT_PER_WINDOW,
    windowMs = DEFAULT_WINDOW_MS,
    now = () => Date.now(),
} = {}) {
    const hitsByKey = new Map();
    let lastSweepAt = now();

    function recentHits(key, currentTime) {
        const hits = (hitsByKey.get(key) ?? []).filter((at) => currentTime - at < windowMs);
        if (hits.length > 0) {
            hitsByKey.set(key, hits);
        } else {
            hitsByKey.delete(key);
        }
        return hits;
    }

    // Forgets keys with no recent hits, so idle teachers do not accumulate.
    function sweep(currentTime) {
        if (currentTime - lastSweepAt < windowMs) {
            return;
        }
        lastSweepAt = currentTime;
        for (const key of [...hitsByKey.keys()]) {
            recentHits(key, currentTime);
        }
    }

    function tryAcquire(key) {
        const currentTime = now();
        sweep(currentTime);
        const hits = recentHits(key, currentTime);
        if (hits.length >= limit) {
            return { allowed: false, retryAfterMs: windowMs - (currentTime - hits[0]) };
        }
        hitsByKey.set(key, [...hits, currentTime]);
        return { allowed: true, retryAfterMs: 0 };
    }

    return { tryAcquire };
}
