import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    MAX_IDS_PER_REQUEST,
    YOUTUBE_ERROR_CODES,
    YoutubeDataApiError,
    YoutubeDataClient,
    parseIsoDurationSeconds,
} from "../youtube-data-client.service.js";

const KEY = "test-google-key-123";
const PUBLIC_ID = "dQw4w9WgXcQ";
const PRIVATE_ID = "aaaaaaaaaaa";
const LOCKED_ID = "bbbbbbbbbbb";
const MISSING_ID = "ccccccccccc";

function videoItem(id, { duration = "PT3M33S", privacyStatus = "public", embeddable = true } = {}) {
    return {
        id,
        snippet: {
            title:        `Title ${id}`,
            description:  `Description ${id}`,
            channelTitle: "Channel",
        },
        contentDetails: { duration },
        status:         { privacyStatus, embeddable },
    };
}

function jsonResponse(status, body) {
    return {
        ok:   status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(body),
    };
}

function makeClient({ env = { GOOGLE_API_KEY: KEY }, fetchImpl, ...rest } = {}) {
    const calls = [];
    const client = new YoutubeDataClient({
        env,
        fetchImpl: async (url, options) => {
            calls.push({ url, options });
            return fetchImpl(url, options);
        },
        ...rest,
    });
    return { client, calls };
}

async function rejectsWithCode(promise, code) {
    let caught = null;
    try {
        await promise;
    } catch (error) {
        caught = error;
    }
    assert.ok(caught instanceof YoutubeDataApiError, "expected a YoutubeDataApiError");
    assert.equal(caught.code, code);
    assert.doesNotMatch(caught.message, new RegExp(KEY));
    assert.doesNotMatch(caught.message, /googleapis/);
    return caught;
}

describe("parseIsoDurationSeconds", () => {
    it("parses the durations YouTube returns", () => {
        assert.equal(parseIsoDurationSeconds("PT15M33S"), 933);
        assert.equal(parseIsoDurationSeconds("PT45S"), 45);
        assert.equal(parseIsoDurationSeconds("PT2M"), 120);
        assert.equal(parseIsoDurationSeconds("PT1H"), 3600);
        assert.equal(parseIsoDurationSeconds("PT1H2M3S"), 3723);
        assert.equal(parseIsoDurationSeconds("PT10H0M1S"), 36001);
        assert.equal(parseIsoDurationSeconds("P1DT2H3M4S"), 93784);
        assert.equal(parseIsoDurationSeconds("P2D"), 172800);
        assert.equal(parseIsoDurationSeconds("P1W"), 604800);
        assert.equal(parseIsoDurationSeconds("P0D"), 0);
        assert.equal(parseIsoDurationSeconds("PT1.6S"), 2);
    });

    it("rejects values that are not durations", () => {
        for (const value of [null, undefined, 42, "", "P", "PT", "P1DT", "15:33", "PT5X", "1H"]) {
            assert.equal(parseIsoDurationSeconds(value), null, String(value));
        }
    });
});

describe("YoutubeDataClient", () => {
    it("reports whether GOOGLE_API_KEY is set", () => {
        assert.equal(new YoutubeDataClient({ env: { GOOGLE_API_KEY: KEY } }).isConfigured(), true);
        const blank = new YoutubeDataClient({ env: { GOOGLE_API_KEY: "  " } });
        assert.equal(blank.isConfigured(), false);
        assert.equal(new YoutubeDataClient({ env: {} }).isConfigured(), false);
    });

    it("asks videos.list for every id in one call and maps the items", async () => {
        const { client, calls } = makeClient({
            fetchImpl: async () => jsonResponse(200, {
                items: [videoItem(PUBLIC_ID, { duration: "PT1H2M3S" })],
            }),
        });

        const { videos, notFoundIds } = await client.getVideos([PUBLIC_ID, PUBLIC_ID]);

        assert.equal(calls.length, 1);
        const url = new URL(calls[0].url);
        assert.equal(url.origin + url.pathname, "https://www.googleapis.com/youtube/v3/videos");
        assert.equal(url.searchParams.get("part"), "snippet,contentDetails,status");
        assert.equal(url.searchParams.get("id"), PUBLIC_ID);
        assert.equal(url.searchParams.get("key"), KEY);
        assert.ok(calls[0].options.signal instanceof AbortSignal);

        assert.deepEqual(notFoundIds, []);
        assert.deepEqual(videos.get(PUBLIC_ID), {
            id:              PUBLIC_ID,
            title:           `Title ${PUBLIC_ID}`,
            description:     `Description ${PUBLIC_ID}`,
            channelTitle:    "Channel",
            durationSeconds: 3723,
            embeddable:      true,
            privacyStatus:   "public",
        });
    });

    it("reports missing ids as not found and keeps private and locked videos", async () => {
        const { client, calls } = makeClient({
            fetchImpl: async () => jsonResponse(200, {
                items: [
                    videoItem(PRIVATE_ID, { privacyStatus: "private" }),
                    videoItem(LOCKED_ID, { embeddable: false, privacyStatus: "unlisted" }),
                ],
            }),
        });

        const { videos, notFoundIds } = await client.getVideos([PRIVATE_ID, LOCKED_ID, MISSING_ID]);

        assert.equal(new URL(calls[0].url).searchParams.get("id"),
            `${PRIVATE_ID},${LOCKED_ID},${MISSING_ID}`);
        assert.deepEqual(notFoundIds, [MISSING_ID]);
        assert.equal(videos.get(PRIVATE_ID).privacyStatus, "private");
        assert.equal(videos.get(LOCKED_ID).embeddable, false);
        assert.equal(videos.get(LOCKED_ID).privacyStatus, "unlisted");
    });

    it("answers an empty list without calling YouTube", async () => {
        const { client, calls } = makeClient({ fetchImpl: async () => assert.fail("no call") });
        const { videos, notFoundIds } = await client.getVideos([]);
        assert.equal(videos.size, 0);
        assert.deepEqual(notFoundIds, []);
        assert.equal(calls.length, 0);
    });

    it("refuses more than 50 ids per call", async () => {
        const { client } = makeClient({ fetchImpl: async () => assert.fail("no call") });
        const ids = Array.from({ length: MAX_IDS_PER_REQUEST + 1 },
            (_, index) => `video${String(index).padStart(6, "0")}`);
        await assert.rejects(client.getVideos(ids), RangeError);
    });

    it("fails as not configured without a key, before any request", async () => {
        const { client, calls } = makeClient({
            env:       {},
            fetchImpl: async () => assert.fail("no call"),
        });
        await rejectsWithCode(client.getVideos([PUBLIC_ID]), YOUTUBE_ERROR_CODES.NOT_CONFIGURED);
        assert.equal(calls.length, 0);
    });

    it("maps a 403 quota error to quota exceeded", async () => {
        for (const reason of ["quotaExceeded", "dailyLimitExceeded"]) {
            const { client } = makeClient({
                fetchImpl: async () => jsonResponse(403, {
                    error: { code: 403, errors: [{ domain: "youtube.quota", reason }] },
                }),
            });
            const error = await rejectsWithCode(
                client.getVideos([PUBLIC_ID]),
                YOUTUBE_ERROR_CODES.QUOTA_EXCEEDED
            );
            assert.equal(error.statusCode, 403);
            assert.equal(error.reason, reason);
        }
    });

    it("maps other HTTP errors to unavailable", async () => {
        for (const [status, body] of [
            [500, { error: { code: 500 } }],
            [503, "Service Unavailable"],
            [403, { error: { errors: [{ reason: "forbidden" }] } }],
            [400, { error: { errors: [{ reason: "keyInvalid" }] } }],
        ]) {
            const { client } = makeClient({
                fetchImpl: async () => ({
                    ok:   false,
                    status,
                    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
                }),
            });
            const error = await rejectsWithCode(
                client.getVideos([PUBLIC_ID]),
                YOUTUBE_ERROR_CODES.UNAVAILABLE
            );
            assert.equal(error.statusCode, status);
        }
    });

    it("maps network failures and unexpected bodies to unavailable", async () => {
        const failing = makeClient({
            fetchImpl: async () => {
                throw new TypeError(`fetch failed for https://www.googleapis.com/?key=${KEY}`);
            },
        });
        const error = await rejectsWithCode(
            failing.client.getVideos([PUBLIC_ID]),
            YOUTUBE_ERROR_CODES.UNAVAILABLE
        );
        assert.equal(error.reason, "network");

        for (const text of ["not json", JSON.stringify({ kind: "youtube#videoListResponse" })]) {
            const { client } = makeClient({
                fetchImpl: async () => ({ ok: true, status: 200, text: async () => text }),
            });
            await rejectsWithCode(client.getVideos([PUBLIC_ID]), YOUTUBE_ERROR_CODES.UNAVAILABLE);
        }
    });

    it("aborts the request after YOUTUBE_DATA_API_TIMEOUT_MS", async () => {
        const timers = [];
        const { client } = makeClient({
            env:            { GOOGLE_API_KEY: KEY, YOUTUBE_DATA_API_TIMEOUT_MS: "2500" },
            setTimeoutImpl: (callback, delay) => {
                timers.push(delay);
                queueMicrotask(callback);
                return timers.length;
            },
            clearTimeoutImpl: () => {},
            fetchImpl:        (url, { signal }) => new Promise((resolve, reject) => {
                signal.addEventListener("abort", () => {
                    reject(new DOMException("This operation was aborted", "AbortError"));
                });
            }),
        });

        const error = await rejectsWithCode(
            client.getVideos([PUBLIC_ID]),
            YOUTUBE_ERROR_CODES.UNAVAILABLE
        );
        assert.equal(error.reason, "timeout");
        assert.deepEqual(timers, [2500]);
    });

    it("defaults the timeout to 8000 ms", () => {
        assert.equal(new YoutubeDataClient({ env: {} }).getTimeoutMs(), 8000);
        assert.equal(
            new YoutubeDataClient({ env: { YOUTUBE_DATA_API_TIMEOUT_MS: "nope" } }).getTimeoutMs(),
            8000
        );
    });
});
