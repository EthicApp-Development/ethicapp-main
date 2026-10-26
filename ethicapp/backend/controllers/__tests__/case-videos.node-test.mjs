import assert from "node:assert/strict";
import express from "express";
import { describe, it } from "node:test";

import { createSlidingWindowThrottle } from "../../helpers/sliding-window-throttle.js";
import {
    createCaseVideosRouter,
    previewVideo,
    videoIdFromInput,
} from "../case-videos.js";

const ID = "dQw4w9WgXcQ";

function metadata(overrides = {}) {
    return {
        title:           "A video",
        description:     "About it",
        channelTitle:    "Channel",
        durationSeconds: 212,
        embeddable:      true,
        privacyStatus:   "public",
        ...overrides,
    };
}

function found(overrides) {
    return { status: "found", metadata: metadata(overrides) };
}

// A fake metadata service answering every id with `entry`.
function makeMetadataService({
    configured = true,
    entry = { status: "found", metadata: metadata() },
} = {}) {
    const lookups = [];
    return {
        lookups,
        isConfigured: () => configured,
        async getVideoMetadata(ids) {
            lookups.push(ids);
            if (entry instanceof Error) {
                throw entry;
            }
            return new Map(ids.map((id) => [id, entry]));
        },
    };
}

async function request(router, { method = "GET", path, body, session = { uid: 7, role: "P" } }) {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        req.session = session;
        next();
    });
    app.use(router);

    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address();
    try {
        const response = await fetch(`http://127.0.0.1:${port}${path}`, {
            method,
            headers: { "Content-Type": "application/json" },
            body:    body === undefined ? undefined : JSON.stringify(body),
        });
        return { response, body: await response.json() };
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

function preview(router, url, options = {}) {
    return request(router, {
        method: "POST",
        path:   "/cases/videos/preview",
        body:   { url },
        ...options,
    });
}

describe("videoIdFromInput", () => {
    it("takes the id from pasted URLs and rejects anything else", () => {
        assert.equal(videoIdFromInput(`https://youtu.be/${ID}?t=3`), ID);
        assert.equal(videoIdFromInput(`https://www.youtube.com/watch?v=${ID}`), ID);
        assert.equal(videoIdFromInput(`https://www.youtube.com/shorts/${ID}`), ID);
        assert.equal(videoIdFromInput(`https://vimeo.com/${ID}`), null);
        assert.equal(videoIdFromInput(`javascript:alert(1)//youtu.be/${ID}`), null);
        assert.equal(videoIdFromInput(ID), null);
        assert.equal(videoIdFromInput(null), null);
        assert.equal(videoIdFromInput(`https://youtu.be/${ID}?pad=${"x".repeat(3000)}`), null);
    });
});

describe("previewVideo", () => {
    it("maps metadata entries to a preview or an error code", async () => {
        const cases = [
            [{ status: "not_found" }, "not_found"],
            [{ status: "unavailable" }, "unavailable"],
            [{ status: "not_configured" }, "not_configured"],
            [found({ privacyStatus: "private" }), "private"],
            [found({ embeddable: false }), "not_embeddable"],
        ];
        for (const [entry, code] of cases) {
            const outcome = await previewVideo(ID, makeMetadataService({ entry }));
            assert.deepEqual(outcome, { code });
        }

        const unlisted = metadata({ privacyStatus: "unlisted" });
        const outcome = await previewVideo(
            ID,
            makeMetadataService({ entry: { status: "found", metadata: unlisted } })
        );
        assert.deepEqual(outcome, {
            status: 200,
            body:   {
                youtubeVideoId: ID,
                url:            `https://www.youtube.com/watch?v=${ID}`,
                metadata:       unlisted,
                availability:   "available",
            },
        });
    });
});

describe("GET /cases/videos/support", () => {
    it("tells teachers whether video support is configured", async () => {
        for (const configured of [true, false]) {
            const router = createCaseVideosRouter({
                metadataService: makeMetadataService({ configured }),
            });
            const { response, body } = await request(router, { path: "/cases/videos/support" });
            assert.equal(response.status, 200);
            assert.deepEqual(body, { enabled: configured });
        }
    });

    it("is for teachers only", async () => {
        const router = createCaseVideosRouter({ metadataService: makeMetadataService() });
        const student = await request(router, {
            path:    "/cases/videos/support",
            session: { uid: 9, role: "A" },
        });
        assert.equal(student.response.status, 403);
        const anonymous = await request(router, { path: "/cases/videos/support", session: {} });
        assert.equal(anonymous.response.status, 401);
    });
});

describe("POST /cases/videos/preview", () => {
    it("returns the video's metadata for a pasted URL", async () => {
        const service = makeMetadataService();
        const router = createCaseVideosRouter({ metadataService: service });

        const { response, body } = await preview(router, `https://youtu.be/${ID}?si=share`);

        assert.equal(response.status, 200);
        assert.deepEqual(body, {
            youtubeVideoId: ID,
            url:            `https://www.youtube.com/watch?v=${ID}`,
            metadata:       metadata(),
            availability:   "available",
        });
        assert.deepEqual(service.lookups, [[ID]]);
    });

    it("answers each failure with its status and code", async () => {
        const cases = [
            [{ status: "not_found" }, 404, "not_found"],
            [found({ privacyStatus: "private" }), 422, "private"],
            [found({ embeddable: false }), 422, "not_embeddable"],
            [{ status: "unavailable" }, 503, "unavailable"],
            [new Error("boom"), 503, "unavailable"],
        ];
        for (const [entry, status, code] of cases) {
            const router = createCaseVideosRouter({
                metadataService: makeMetadataService({ entry }),
            });
            const { response, body } = await preview(router, `https://youtu.be/${ID}`);
            assert.equal(response.status, status, code);
            assert.equal(body.code, code);
            assert.equal(typeof body.message, "string");
        }
    });

    it("rejects URLs that are not YouTube video URLs without a lookup", async () => {
        const service = makeMetadataService();
        const router = createCaseVideosRouter({ metadataService: service });
        for (const url of ["https://example.com/watch?v=dQw4w9WgXcQ", "", 42, undefined]) {
            const { response, body } = await preview(router, url);
            assert.equal(response.status, 400);
            assert.equal(body.code, "invalid_url");
        }
        assert.equal(service.lookups.length, 0);
    });

    it("answers 503 not_configured without a key", async () => {
        const service = makeMetadataService({ configured: false });
        const router = createCaseVideosRouter({ metadataService: service });

        const { response, body } = await preview(router, `https://youtu.be/${ID}`);

        assert.equal(response.status, 503);
        assert.equal(body.code, "not_configured");
        assert.equal(service.lookups.length, 0);
    });

    it("throttles each teacher separately", async () => {
        let clock = 0;
        const service = makeMetadataService();
        const router = createCaseVideosRouter({
            metadataService: service,
            throttle:        createSlidingWindowThrottle({
                limit:    2,
                windowMs: 60000,
                now:      () => clock,
            }),
        });
        const url = `https://youtu.be/${ID}`;

        assert.equal((await preview(router, url)).response.status, 200);
        clock = 15000;
        assert.equal((await preview(router, url)).response.status, 200);
        const throttled = await preview(router, url);
        assert.equal(throttled.response.status, 429);
        assert.equal(throttled.body.code, "throttled");
        assert.equal(throttled.response.headers.get("retry-after"), "45");
        assert.equal(service.lookups.length, 2);

        const other = await preview(router, url, { session: { uid: 8, role: "P" } });
        assert.equal(other.response.status, 200);
    });

    it("is for teachers only", async () => {
        const service = makeMetadataService();
        const router = createCaseVideosRouter({ metadataService: service });
        const { response } = await preview(router, `https://youtu.be/${ID}`, {
            session: { uid: 9, role: "A" },
        });
        assert.equal(response.status, 403);
        assert.equal(service.lookups.length, 0);
    });
});
