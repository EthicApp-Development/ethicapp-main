import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    YOUTUBE_ERROR_CODES,
    YoutubeDataApiError,
} from "../youtube-data-client.service.js";
import {
    createYoutubeVideoMetadataService,
    resolveCacheTtlSeconds,
    videoAvailability,
} from "../youtube-video-metadata.service.js";

const NOW = 1_800_000_000_000;

function videoId(index) {
    return `vid${String(index).padStart(8, "0")}`;
}

function video(id, overrides = {}) {
    return {
        id,
        title:           `Title ${id}`,
        description:     "About it",
        channelTitle:    "Channel",
        durationSeconds: 120,
        embeddable:      true,
        privacyStatus:   "public",
        ...overrides,
    };
}

function metadataOf(id, overrides = {}) {
    const metadata = video(id, overrides);
    delete metadata.id;
    return metadata;
}

// A fake ioredis cache: string values, TTLs recorded, optional failures.
function makeCache({ failReads = false, failWrites = false, hang = false } = {}) {
    const store = new Map();
    const ttls = new Map();
    const calls = { mget: [], set: [] };
    return {
        store,
        ttls,
        calls,
        async mget(...keys) {
            calls.mget.push(keys);
            if (hang) {
                return new Promise(() => {});
            }
            if (failReads) {
                throw new Error("Connection is closed.");
            }
            return keys.map((key) => store.get(key) ?? null);
        },
        async set(key, value, mode, ttl) {
            calls.set.push({ key, value, mode, ttl });
            if (failWrites) {
                throw new Error("Connection is closed.");
            }
            store.set(key, value);
            ttls.set(key, ttl);
            return "OK";
        },
    };
}

// A fake YouTube client: answers from `catalog`, records each batch.
function makeClient({ catalog = new Map(), configured = true, error = null, gate = null } = {}) {
    const batches = [];
    return {
        batches,
        isConfigured: () => configured,
        async getVideos(ids) {
            batches.push([...ids]);
            if (gate) {
                await gate;
            }
            if (error) {
                throw error;
            }
            const videos = new Map(ids.filter((id) => catalog.has(id))
                .map((id) => [id, catalog.get(id)]));
            return { videos, notFoundIds: ids.filter((id) => !catalog.has(id)) };
        },
    };
}

const silentLogger = { warn: () => {} };

function makeService(options = {}) {
    return createYoutubeVideoMetadataService({
        now:    () => NOW,
        logger: silentLogger,
        ...options,
    });
}

describe("videoAvailability", () => {
    it("maps entries to availability", () => {
        const found = (overrides) => ({
            status:   "found",
            metadata: metadataOf(videoId(1), overrides),
        });
        assert.equal(videoAvailability(found()), "available");
        assert.equal(videoAvailability(found({ privacyStatus: "unlisted" })), "available");
        assert.equal(videoAvailability(found({ privacyStatus: "private" })), "private");
        assert.equal(videoAvailability(found({ embeddable: false })), "not_embeddable");
        assert.equal(videoAvailability({ status: "not_found" }), "removed");
        assert.equal(videoAvailability({ status: "unavailable" }), null);
        assert.equal(videoAvailability({ status: "not_configured" }), null);
        assert.equal(videoAvailability(undefined), null);
    });
});

describe("resolveCacheTtlSeconds", () => {
    it("defaults to 24 hours and caps at 30 days", () => {
        assert.equal(resolveCacheTtlSeconds(undefined), 86400);
        assert.equal(resolveCacheTtlSeconds(""), 86400);
        assert.equal(resolveCacheTtlSeconds("0"), 86400);
        assert.equal(resolveCacheTtlSeconds("-5"), 86400);
        assert.equal(resolveCacheTtlSeconds("abc"), 86400);
        assert.equal(resolveCacheTtlSeconds("3600"), 3600);
        assert.equal(resolveCacheTtlSeconds("2592000"), 2592000);
        assert.equal(resolveCacheTtlSeconds("99999999"), 2592000);
    });
});

describe("createYoutubeVideoMetadataService", () => {
    it("is configured when its client is", () => {
        assert.equal(makeService({ client: makeClient() }).isConfigured(), true);
        assert.equal(
            makeService({ client: makeClient({ configured: false }) }).isConfigured(),
            false
        );
    });

    it("fetches misses, caches them and serves later lookups from the cache", async () => {
        const id = videoId(1);
        const client = makeClient({ catalog: new Map([[id, video(id)]]) });
        const cache = makeCache();
        const service = makeService({ client, cache, ttlSeconds: 3600 });

        const first = await service.getVideoMetadata([id]);
        assert.deepEqual(first.get(id), { status: "found", metadata: metadataOf(id) });
        assert.equal(client.batches.length, 1);
        assert.deepEqual(cache.calls.set.map(({ key, mode, ttl }) => [key, mode, ttl]),
            [[`youtube:video:${id}`, "EX", 3600]]);
        assert.equal(JSON.parse(cache.store.get(`youtube:video:${id}`)).expiresAt,
            NOW + 3600 * 1000);

        const second = await service.getVideoMetadata([id]);
        assert.deepEqual(second.get(id), first.get(id));
        assert.equal(client.batches.length, 1, "served from the cache");
    });

    it("caps the found TTL at 30 days and gives not_found entries a short TTL", async () => {
        const found = videoId(1);
        const missing = videoId(2);
        const cache = makeCache();
        const service = makeService({
            client:     makeClient({ catalog: new Map([[found, video(found)]]) }),
            cache,
            ttlSeconds: () => "31536000",
        });

        const entries = await service.getVideoMetadata([found, missing]);

        assert.equal(entries.get(missing).status, "not_found");
        assert.equal(cache.ttls.get(`youtube:video:${found}`), 2592000);
        assert.equal(cache.ttls.get(`youtube:video:${missing}`), 300);
    });

    it("drops cached entries past their expiry even if the cache kept them", async () => {
        const id = videoId(1);
        const cache = makeCache();
        cache.store.set(`youtube:video:${id}`, JSON.stringify({
            status:    "found",
            metadata:  metadataOf(id, { title: "Stale" }),
            expiresAt: NOW - 1,
        }));
        cache.store.set(`youtube:video:${videoId(2)}`, "{not json");
        const client = makeClient({ catalog: new Map([[id, video(id)]]) });
        const service = makeService({ client, cache });

        const entries = await service.getVideoMetadata([id, videoId(2)]);

        assert.equal(entries.get(id).metadata.title, `Title ${id}`);
        assert.deepEqual(client.batches, [[id, videoId(2)]]);
    });

    it("mixes hits and misses and fetches misses in batches of 50", async () => {
        const ids = Array.from({ length: 120 }, (_, index) => videoId(index));
        const catalog = new Map(ids.map((id) => [id, video(id)]));
        const cache = makeCache();
        const cachedIds = ids.slice(0, 10);
        for (const id of cachedIds) {
            cache.store.set(`youtube:video:${id}`, JSON.stringify({
                status:    "found",
                metadata:  metadataOf(id, { title: "Cached" }),
                expiresAt: NOW + 1000,
            }));
        }
        const client = makeClient({ catalog });
        const service = makeService({ client, cache });

        const entries = await service.getVideoMetadata(ids);

        assert.deepEqual([...entries.keys()], ids, "keeps the order given");
        assert.equal(entries.get(ids[0]).metadata.title, "Cached");
        assert.equal(entries.get(ids[50]).metadata.title, `Title ${ids[50]}`);
        assert.deepEqual(client.batches.map((batch) => batch.length), [50, 50, 10]);
        assert.ok(client.batches.flat().every((id) => !cachedIds.includes(id)));
        assert.equal(cache.calls.mget.length, 1, "one cache round trip for the reads");
    });

    it("shares one request among concurrent lookups of the same ids", async () => {
        const id = videoId(1);
        let release;
        const gate = new Promise((resolve) => {
            release = resolve;
        });
        const client = makeClient({ catalog: new Map([[id, video(id)]]), gate });
        const service = makeService({ client, cache: makeCache() });

        const lookups = [
            service.getVideoMetadata([id]),
            service.getVideoMetadata([id]),
            service.getVideoMetadata([id, id]),
        ];
        await new Promise((resolve) => setImmediate(resolve));
        release();
        const results = await Promise.all(lookups);

        assert.equal(client.batches.length, 1);
        for (const result of results) {
            assert.equal(result.get(id).status, "found");
        }

        await service.getVideoMetadata([videoId(2)]);
        assert.equal(client.batches.length, 2, "settled requests are not reused");
    });

    it("reports invalid ids as not found without calling YouTube", async () => {
        const client = makeClient();
        const cache = makeCache();
        const service = makeService({ client, cache });

        const entries = await service.getVideoMetadata(["short", "has spaces!", 42]);

        assert.deepEqual([...entries.values()].map((entry) => entry.status),
            ["not_found", "not_found", "not_found"]);
        assert.equal(client.batches.length, 0);
        assert.equal(cache.calls.mget.length, 0);
    });

    it("reports not_configured without a key, without touching the cache", async () => {
        const id = videoId(1);
        const client = makeClient({ configured: false });
        const cache = makeCache();
        const service = makeService({ client, cache });

        const entries = await service.getVideoMetadata([id]);

        assert.deepEqual(entries.get(id), { status: "not_configured" });
        assert.equal(client.batches.length, 0);
        assert.equal(cache.calls.mget.length, 0);
    });

    it("reports unavailable and caches nothing when YouTube fails", async () => {
        for (const code of [YOUTUBE_ERROR_CODES.UNAVAILABLE, YOUTUBE_ERROR_CODES.QUOTA_EXCEEDED]) {
            const id = videoId(1);
            const client = makeClient({ error: new YoutubeDataApiError(code, "failed") });
            const cache = makeCache();
            const service = makeService({ client, cache });

            const entries = await service.getVideoMetadata([id]);

            assert.deepEqual(entries.get(id), { status: "unavailable" });
            assert.equal(cache.calls.set.length, 0);
        }
    });

    it("never throws when the client fails unexpectedly", async () => {
        const id = videoId(1);
        const client = makeClient();
        client.getVideos = async () => ({ videos: null });
        const service = makeService({ client, cache: makeCache() });

        const entries = await service.getVideoMetadata([id]);

        assert.deepEqual(entries.get(id), { status: "unavailable" });
    });

    it("falls back to YouTube when the cache fails or hangs", async () => {
        const id = videoId(1);
        for (const cache of [
            makeCache({ failReads: true, failWrites: true }),
            makeCache({ hang: true }),
        ]) {
            const client = makeClient({ catalog: new Map([[id, video(id)]]) });
            const service = makeService({ client, cache, cacheTimeoutMs: 20 });

            const entries = await service.getVideoMetadata([id]);

            assert.equal(entries.get(id).status, "found");
            assert.equal(client.batches.length, 1);
        }
    });

    it("works without a cache", async () => {
        const id = videoId(1);
        const client = makeClient({ catalog: new Map([[id, video(id)]]) });
        const service = makeService({ client, cache: null });

        assert.equal((await service.getVideoMetadata([id])).get(id).status, "found");
    });
});
