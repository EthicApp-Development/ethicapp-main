// YouTube video metadata for case videos (#780, epic #779), fetched lazily
// through the YouTube Data API client and cached in the cache Redis
// (REDIS_CACHE_*). Nothing is stored in the database, and cached entries never
// outlive YouTube's 30-day storage limit for non-authorized API data.
//
// Lookups never throw for YouTube or Redis failures: each id resolves to an
// entry whose `status` is found, not_found, unavailable or not_configured.

import { isYoutubeVideoId } from "../../common/modules/youtube-urls.js";
import youtubeDataClient, {
    MAX_IDS_PER_REQUEST,
    YOUTUBE_ERROR_CODES,
} from "./youtube-data-client.service.js";

export const DEFAULT_TTL_SECONDS = 86400;
export const MAX_TTL_SECONDS = 2592000;
export const DEFAULT_NOT_FOUND_TTL_SECONDS = 300;
const DEFAULT_CACHE_TIMEOUT_MS = 1000;
const CACHE_KEY_PREFIX = "youtube:video:";

export const ENTRY_STATUS = Object.freeze({
    FOUND:          "found",
    NOT_FOUND:      "not_found",
    UNAVAILABLE:    "unavailable",
    NOT_CONFIGURED: "not_configured",
});

export const AVAILABILITY = Object.freeze({
    AVAILABLE:      "available",
    PRIVATE:        "private",
    NOT_EMBEDDABLE: "not_embeddable",
    REMOVED:        "removed",
});

const NOT_FOUND_ENTRY = Object.freeze({ status: ENTRY_STATUS.NOT_FOUND });
const UNAVAILABLE_ENTRY = Object.freeze({ status: ENTRY_STATUS.UNAVAILABLE });
const NOT_CONFIGURED_ENTRY = Object.freeze({ status: ENTRY_STATUS.NOT_CONFIGURED });

/**
 * Whether a video can be embedded, from a metadata entry: `available`,
 * `private`, `not_embeddable` or `removed`. Null when YouTube could not tell
 * (unavailable or not configured).
 */
export function videoAvailability(entry) {
    if (entry?.status === ENTRY_STATUS.NOT_FOUND) {
        return AVAILABILITY.REMOVED;
    }
    if (entry?.status !== ENTRY_STATUS.FOUND) {
        return null;
    }
    if (entry.metadata?.privacyStatus === "private") {
        return AVAILABILITY.PRIVATE;
    }
    if (entry.metadata?.embeddable === false) {
        return AVAILABILITY.NOT_EMBEDDABLE;
    }
    return AVAILABILITY.AVAILABLE;
}

/**
 * The TTL for found videos: YOUTUBE_METADATA_CACHE_TTL_SECONDS when it is a
 * positive integer, capped at 30 days; the 24-hour default otherwise.
 */
export function resolveCacheTtlSeconds(value) {
    const configured = Number(value);
    if (!Number.isInteger(configured) || configured < 1) {
        return DEFAULT_TTL_SECONDS;
    }
    return Math.min(configured, MAX_TTL_SECONDS);
}

export function cacheKey(videoId) {
    return `${CACHE_KEY_PREFIX}${videoId}`;
}

function toMetadata(video) {
    return {
        title:           video.title,
        description:     video.description,
        channelTitle:    video.channelTitle,
        durationSeconds: video.durationSeconds,
        embeddable:      video.embeddable,
        privacyStatus:   video.privacyStatus,
    };
}

function chunk(values, size) {
    const chunks = [];
    for (let index = 0; index < values.length; index += size) {
        chunks.push(values.slice(index, index + size));
    }
    return chunks;
}

// Resolves to the operation's result, or rejects after `timeoutMs`: a Redis
// client that queues commands while reconnecting must not stall a lookup.
function withTimeout(operation, timeoutMs) {
    let timeoutId;
    const timeout = new Promise((resolve, reject) => {
        timeoutId = setTimeout(() => reject(new Error("Cache operation timed out.")), timeoutMs);
        timeoutId.unref?.();
    });
    return Promise.race([Promise.resolve().then(operation), timeout])
        .finally(() => clearTimeout(timeoutId));
}

/**
 * Builds a metadata service.
 * - `client`: { isConfigured(), getVideos(ids) }, the YouTube Data API client.
 * - `cache`: an ioredis-like client with `mget(...keys)` and
 *   `set(key, value, "EX", seconds)`.
 * - `ttlSeconds`: TTL of found videos (capped at 30 days).
 * - `notFoundTtlSeconds`: TTL of not_found results.
 * - `now`: clock in milliseconds, used to drop entries past their TTL even if
 *   the cache kept them.
 */
export function createYoutubeVideoMetadataService({
    client,
    cache,
    ttlSeconds = DEFAULT_TTL_SECONDS,
    notFoundTtlSeconds = DEFAULT_NOT_FOUND_TTL_SECONDS,
    now = () => Date.now(),
    cacheTimeoutMs = DEFAULT_CACHE_TIMEOUT_MS,
    logger = console,
} = {}) {
    const inFlight = new Map();
    const resolveTtl = typeof ttlSeconds === "function" ? ttlSeconds : () => ttlSeconds;

    function foundTtlSeconds() {
        return resolveCacheTtlSeconds(resolveTtl());
    }

    function decodeCached(raw) {
        if (typeof raw !== "string") {
            return null;
        }
        let stored;
        try {
            stored = JSON.parse(raw);
        } catch {
            return null;
        }
        if (!stored || !(Number(stored.expiresAt) > now())) {
            return null;
        }
        if (stored.status === ENTRY_STATUS.NOT_FOUND) {
            return NOT_FOUND_ENTRY;
        }
        if (stored.status === ENTRY_STATUS.FOUND && stored.metadata
            && typeof stored.metadata === "object") {
            return { status: ENTRY_STATUS.FOUND, metadata: stored.metadata };
        }
        return null;
    }

    async function readCache(ids) {
        const entries = new Map();
        if (!cache || ids.length === 0) {
            return entries;
        }
        try {
            const values = await withTimeout(
                () => cache.mget(...ids.map(cacheKey)),
                cacheTimeoutMs
            );
            ids.forEach((id, index) => {
                const entry = decodeCached(values?.[index]);
                if (entry) {
                    entries.set(id, entry);
                }
            });
        } catch (error) {
            logger.warn(`[youtube-metadata] Cache read failed: ${error?.message}`);
        }
        return entries;
    }

    async function writeCache(id, entry) {
        if (!cache) {
            return;
        }
        const ttl = entry.status === ENTRY_STATUS.FOUND ? foundTtlSeconds() : notFoundTtlSeconds;
        const stored = JSON.stringify({ ...entry, expiresAt: now() + ttl * 1000 });
        try {
            await withTimeout(() => cache.set(cacheKey(id), stored, "EX", ttl), cacheTimeoutMs);
        } catch (error) {
            logger.warn(`[youtube-metadata] Cache write failed: ${error?.message}`);
        }
    }

    async function fetchBatch(ids) {
        let result;
        try {
            result = await client.getVideos(ids);
        } catch (error) {
            const notConfigured = error?.code === YOUTUBE_ERROR_CODES.NOT_CONFIGURED;
            if (!notConfigured) {
                logger.warn(
                    `[youtube-metadata] YouTube lookup failed: ${error?.code ?? "error"}`
                    + ` ${error?.message ?? ""}`.trimEnd()
                );
            }
            const fallback = notConfigured ? NOT_CONFIGURED_ENTRY : UNAVAILABLE_ENTRY;
            return new Map(ids.map((id) => [id, fallback]));
        }

        const entries = new Map();
        for (const id of ids) {
            const video = result.videos.get(id);
            entries.set(id, video
                ? { status: ENTRY_STATUS.FOUND, metadata: toMetadata(video) }
                : NOT_FOUND_ENTRY);
        }
        await Promise.all([...entries].map(([id, entry]) => writeCache(id, entry)));
        return entries;
    }

    // Starts one request per batch of 50 and registers each id's pending entry,
    // so concurrent lookups of the same ids share the request.
    function startFetches(ids) {
        for (const batch of chunk(ids, MAX_IDS_PER_REQUEST)) {
            const request = fetchBatch(batch).catch((error) => {
                logger.warn(`[youtube-metadata] Lookup failed: ${error?.message}`);
                return new Map(batch.map((id) => [id, UNAVAILABLE_ENTRY]));
            });
            for (const id of batch) {
                const pending = request.then((entries) => entries.get(id) ?? UNAVAILABLE_ENTRY);
                inFlight.set(id, pending);
                pending.finally(() => {
                    if (inFlight.get(id) === pending) {
                        inFlight.delete(id);
                    }
                });
            }
        }
    }

    function isConfigured() {
        return Boolean(client?.isConfigured());
    }

    /** Resolves to Map<id, entry> in the order of the unique ids given. */
    async function getVideoMetadata(ids) {
        const uniqueIds = [...new Set(Array.isArray(ids) ? ids : [])];
        const entries = new Map();
        const validIds = [];
        for (const id of uniqueIds) {
            if (isYoutubeVideoId(id)) {
                validIds.push(id);
            } else {
                entries.set(id, NOT_FOUND_ENTRY);
            }
        }

        if (validIds.length > 0 && !isConfigured()) {
            validIds.forEach((id) => entries.set(id, NOT_CONFIGURED_ENTRY));
        } else if (validIds.length > 0) {
            const toRead = validIds.filter((id) => !inFlight.has(id));
            const cached = await readCache(toRead);
            const misses = toRead.filter((id) => !cached.has(id) && !inFlight.has(id));
            startFetches(misses);

            const resolved = await Promise.all(validIds.map((id) => (
                cached.get(id) ?? inFlight.get(id) ?? UNAVAILABLE_ENTRY
            )));
            validIds.forEach((id, index) => entries.set(id, resolved[index] ?? UNAVAILABLE_ENTRY));
        }

        return new Map(uniqueIds.map((id) => [id, entries.get(id)]));
    }

    return { isConfigured, getVideoMetadata };
}

// The cache Redis client opens its connection when imported, so the default
// instance imports it on first use: modules and tests that only need the
// factory or videoAvailability() never connect to Redis.
function lazyCacheRedis() {
    let clientPromise = null;
    const redis = () => {
        clientPromise ??= import("../db/redis.js").then((module) => module.default);
        return clientPromise;
    };
    return {
        mget: async (...keys) => (await redis()).mget(...keys),
        set:  async (...args) => (await redis()).set(...args),
    };
}

export const youtubeVideoMetadata = createYoutubeVideoMetadataService({
    client:     youtubeDataClient,
    cache:      lazyCacheRedis(),
    ttlSeconds: () => process.env.YOUTUBE_METADATA_CACHE_TTL_SECONDS,
});

export default youtubeVideoMetadata;
