import assert from "node:assert/strict";
import test from "node:test";
import {
    CASE_VIDEO_ERROR_CODES,
    MAX_CASE_VIDEOS,
    caseVideoSummariesFromIds,
    caseVideosJsonSql,
    checkNewCaseVideos,
    copyCaseVideos,
    listCaseVideoIds,
    normalizeCaseVideoSummaries,
    parseCaseVideoIds,
    planCaseVideoChanges,
    prepareCaseVideoSave,
    replaceCaseVideos,
    resolveCaseVideos,
} from "../case-videos.js";

const KEPT = "dQw4w9WgXcQ";
const OTHER = "9bZkp7q19f0";
const NEW = "M7lc1UVf-VE";
const UNLISTED = "aqz-KE-bpKQ";
const PRIVATE = "ScMzIvxBSi4";
const NOT_EMBEDDABLE = "kJQP7kiw5Fk";
const REMOVED = "AAAAAAAAAAA";
const UNREACHABLE = "BBBBBBBBBBB";

function found(overrides = {}) {
    return {
        status:   "found",
        metadata: {
            title:           "A video",
            description:     "About the case.",
            channelTitle:    "A channel",
            durationSeconds: 933,
            embeddable:      true,
            privacyStatus:   "public",
            ...overrides,
        },
    };
}

const ENTRIES = new Map([
    [KEPT, found()],
    [OTHER, found({ title: "Another video" })],
    [NEW, found({ title: "A new video" })],
    [UNLISTED, found({ privacyStatus: "unlisted" })],
    [PRIVATE, found({ privacyStatus: "private" })],
    [NOT_EMBEDDABLE, found({ embeddable: false })],
    [REMOVED, { status: "not_found" }],
    [UNREACHABLE, { status: "unavailable" }],
]);

// The mapping #780's metadata service exports, as the epic defines it.
function videoAvailability(entry) {
    if (entry?.status === "not_found") {
        return "removed";
    }
    if (entry?.metadata?.privacyStatus === "private") {
        return "private";
    }
    return entry?.metadata?.embeddable === false ? "not_embeddable" : "available";
}

function fakeMetadataService({ configured = true, entries = ENTRIES, error = null } = {}) {
    const calls = [];
    return {
        calls,
        isConfigured: () => configured,
        async getVideoMetadata(ids) {
            calls.push([...ids]);
            if (error) {
                throw error;
            }
            if (!configured) {
                return new Map(ids.map(id => [id, { status: "not_configured" }]));
            }
            return new Map(ids.filter(id => entries.has(id)).map(id => [id, entries.get(id)]));
        },
    };
}

function services(options) {
    const metadataService = fakeMetadataService(options);
    return { metadataService, videoAvailability };
}

function quietly(fn) {
    return async () => {
        const original = console.error;
        console.error = () => {};
        try {
            await fn();
        } finally {
            console.error = original;
        }
    };
}

function fakeDb(rows = []) {
    const queries = [];
    return {
        queries,
        async query(sql, params) {
            queries.push({ sql, params });
            return { rows };
        },
    };
}

// parseCaseVideoIds

test("parseCaseVideoIds: an absent field leaves the videos unchanged", () => {
    assert.deepEqual(parseCaseVideoIds(undefined), { ok: true, provided: false });
    assert.deepEqual(parseCaseVideoIds(null), { ok: true, provided: false });
});

test("parseCaseVideoIds: a JSON array keeps its order, and an empty one removes all", () => {
    assert.deepEqual(parseCaseVideoIds(JSON.stringify([OTHER, KEPT])), {
        ok: true, provided: true, ids: [OTHER, KEPT],
    });
    assert.deepEqual(parseCaseVideoIds("[]"), { ok: true, provided: true, ids: [] });
    assert.deepEqual(parseCaseVideoIds([KEPT]), { ok: true, provided: true, ids: [KEPT] });
});

test("parseCaseVideoIds: a repeated id keeps its first place", () => {
    assert.deepEqual(parseCaseVideoIds([KEPT, OTHER, KEPT]).ids, [KEPT, OTHER]);
});

test("parseCaseVideoIds: rejects malformed ids with per-id field errors", () => {
    const result = parseCaseVideoIds(JSON.stringify([KEPT, "too-short", "https://youtu.be/x", 7]));

    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.equal(result.body.code, CASE_VIDEO_ERROR_CODES.invalid);
    assert.deepEqual(result.body.fields, {
        "too-short":          "invalid_id",
        "https://youtu.be/x": "invalid_id",
        7:                    "invalid_id",
    });
});

test("parseCaseVideoIds: rejects a field that is not a JSON array", () => {
    for (const value of ["not json", "{\"id\":1}", "\"dQw4w9WgXcQ\"", ""]) {
        const result = parseCaseVideoIds(value);
        assert.equal(result.ok, false, value);
        assert.deepEqual(result.body.fields, { videos: "invalid" });
    }
});

test("parseCaseVideoIds: rejects more videos than one metadata request checks", () => {
    const ids = Array.from({ length: MAX_CASE_VIDEOS + 1 }, (_, index) => {
        return `video${String(index).padStart(6, "0")}`;
    });

    assert.equal(parseCaseVideoIds(ids.slice(0, MAX_CASE_VIDEOS)).ok, true);
    assert.deepEqual(parseCaseVideoIds(ids).body.fields, { videos: "too_many" });
});

// planCaseVideoChanges

test("planCaseVideoChanges: adding, keeping, reordering and removing", () => {
    assert.deepEqual(planCaseVideoChanges([KEPT], [KEPT, NEW]), {
        newIds: [NEW], removedIds: [], changed: true,
    });
    assert.deepEqual(planCaseVideoChanges([KEPT, OTHER], [KEPT, OTHER]), {
        newIds: [], removedIds: [], changed: false,
    });
    assert.deepEqual(planCaseVideoChanges([KEPT, OTHER], [OTHER, KEPT]), {
        newIds: [], removedIds: [], changed: true,
    });
    assert.deepEqual(planCaseVideoChanges([KEPT, OTHER], [OTHER]), {
        newIds: [], removedIds: [KEPT], changed: true,
    });
    assert.deepEqual(planCaseVideoChanges([KEPT], []), {
        newIds: [], removedIds: [KEPT], changed: true,
    });
});

// prepareCaseVideoSave and checkNewCaseVideos

test("prepareCaseVideoSave: an absent field writes nothing and asks YouTube nothing", async () => {
    const deps = services();
    const result = await prepareCaseVideoSave({ ok: true, provided: false }, [KEPT], deps);

    assert.deepEqual(result, { ok: true, videoIds: null });
    assert.deepEqual(deps.metadataService.calls, []);
});

test("prepareCaseVideoSave: checks only the ids the case does not hold yet", async () => {
    const deps = services();
    const parsed = parseCaseVideoIds([NEW, KEPT, UNLISTED]);
    const result = await prepareCaseVideoSave(parsed, [KEPT, OTHER], deps);

    assert.deepEqual(result, { ok: true, videoIds: [NEW, KEPT, UNLISTED] });
    assert.deepEqual(deps.metadataService.calls, [[NEW, UNLISTED]]);
});

test("prepareCaseVideoSave: reordering or removing asks YouTube nothing", async () => {
    const deps = services({ configured: false });

    assert.deepEqual(
        await prepareCaseVideoSave(parseCaseVideoIds([OTHER, KEPT]), [KEPT, OTHER], deps),
        { ok: true, videoIds: [OTHER, KEPT] }
    );
    assert.deepEqual(
        await prepareCaseVideoSave(parseCaseVideoIds([]), [KEPT, OTHER], deps),
        { ok: true, videoIds: [] }
    );
    assert.deepEqual(deps.metadataService.calls, []);
});

test("prepareCaseVideoSave: an unchanged list is not written again", async () => {
    const result = await prepareCaseVideoSave(parseCaseVideoIds([KEPT]), [KEPT], services());
    assert.deepEqual(result, { ok: true, videoIds: null });
});

test("prepareCaseVideoSave: a case keeps a video that went private after being added", async () => {
    const parsed = parseCaseVideoIds([PRIVATE, NEW]);
    const result = await prepareCaseVideoSave(parsed, [PRIVATE], services());
    assert.deepEqual(result, { ok: true, videoIds: [PRIVATE, NEW] });
});

test("checkNewCaseVideos: rejects not found, private and not embeddable ids with 400", async () => {
    const result = await checkNewCaseVideos([NEW, REMOVED, PRIVATE, NOT_EMBEDDABLE], services());

    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.equal(result.body.code, CASE_VIDEO_ERROR_CODES.rejected);
    assert.deepEqual(result.body.fields, {
        [REMOVED]:        "not_found",
        [PRIVATE]:        "private",
        [NOT_EMBEDDABLE]: "not_embeddable",
    });
});

test("checkNewCaseVideos: answers 503 when YouTube cannot be reached for a new id", async () => {
    const result = await checkNewCaseVideos([NEW, UNREACHABLE], services());

    assert.equal(result.ok, false);
    assert.equal(result.status, 503);
    assert.equal(result.body.code, CASE_VIDEO_ERROR_CODES.unavailable);
    assert.deepEqual(result.body.fields, { [UNREACHABLE]: "unavailable" });
});

test("checkNewCaseVideos: a rejected id wins over one that could not be checked", async () => {
    const result = await checkNewCaseVideos([UNREACHABLE, REMOVED], services());

    assert.equal(result.status, 400);
    assert.deepEqual(result.body.fields, { [REMOVED]: "not_found" });
});

test("checkNewCaseVideos: a missing entry or a throwing service counts as unavailable",
    quietly(async () => {
        const missing = await checkNewCaseVideos(["CCCCCCCCCCC"], services());
        assert.equal(missing.status, 503);

        const throwing = await checkNewCaseVideos([NEW], services({ error: new Error("boom") }));
        assert.equal(throwing.status, 503);
        assert.deepEqual(throwing.body.fields, { [NEW]: "unavailable" });
    })
);

test("checkNewCaseVideos: without a Google key new ids fail with 400 not configured", async () => {
    const deps = services({ configured: false });
    const result = await checkNewCaseVideos([NEW], deps);

    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.equal(result.body.code, CASE_VIDEO_ERROR_CODES.notConfigured);
    assert.deepEqual(result.body.fields, { [NEW]: "not_configured" });
    assert.deepEqual(deps.metadataService.calls, []);
});

test("checkNewCaseVideos: a not_configured entry also fails with 400 not configured", async () => {
    const deps = services();
    deps.metadataService.getVideoMetadata = async ids => {
        return new Map(ids.map(id => [id, { status: "not_configured" }]));
    };

    const result = await checkNewCaseVideos([NEW], deps);
    assert.equal(result.status, 400);
    assert.equal(result.body.code, CASE_VIDEO_ERROR_CODES.notConfigured);
});

test("checkNewCaseVideos: nothing new asks YouTube nothing", async () => {
    const deps = services();
    assert.deepEqual(await checkNewCaseVideos([], deps), { ok: true });
    assert.deepEqual(deps.metadataService.calls, []);
});

// Reading

test("normalizeCaseVideoSummaries: listings carry only ids and positions, in order", () => {
    const summaries = normalizeCaseVideoSummaries([
        { youtubeVideoId: OTHER, position: 2 },
        { youtubeVideoId: KEPT, position: 1 },
        { youtubeVideoId: "bad", position: 3 },
    ]);

    assert.deepEqual(summaries, [
        { youtubeVideoId: KEPT, position: 1 },
        { youtubeVideoId: OTHER, position: 2 },
    ]);
    assert.deepEqual(normalizeCaseVideoSummaries(null), []);
    assert.deepEqual(caseVideoSummariesFromIds([NEW, KEPT]), [
        { youtubeVideoId: NEW, position: 1 },
        { youtubeVideoId: KEPT, position: 2 },
    ]);
});

test("caseVideosJsonSql: reads the videos of the given case alias, ordered", () => {
    const sql = caseVideosJsonSql("c");

    assert.match(sql, /FROM ethical_case_videos ecv/u);
    assert.match(sql, /WHERE ecv\.case_id = c\.id/u);
    assert.match(sql, /ORDER BY ecv\.position/u);
    assert.match(sql, /'\[\]'::json/u);
});

test("resolveCaseVideos: found and removed videos get metadata, unreachable get null", async () => {
    const deps = services();
    const summaries = caseVideoSummariesFromIds([KEPT, REMOVED, UNREACHABLE, PRIVATE]);
    const videos = await resolveCaseVideos(summaries, deps);

    assert.deepEqual(deps.metadataService.calls, [[KEPT, REMOVED, UNREACHABLE, PRIVATE]]);
    assert.deepEqual(videos, [
        {
            youtubeVideoId: KEPT,
            position:       1,
            url:            `https://www.youtube.com/watch?v=${KEPT}`,
            metadata:       {
                title:           "A video",
                description:     "About the case.",
                channelTitle:    "A channel",
                durationSeconds: 933,
                availability:    "available",
            },
        },
        {
            youtubeVideoId: REMOVED,
            position:       2,
            url:            `https://www.youtube.com/watch?v=${REMOVED}`,
            metadata:       {
                title:           null,
                description:     null,
                channelTitle:    null,
                durationSeconds: null,
                availability:    "removed",
            },
        },
        {
            youtubeVideoId: UNREACHABLE,
            position:       3,
            url:            `https://www.youtube.com/watch?v=${UNREACHABLE}`,
            metadata:       null,
        },
        {
            youtubeVideoId: PRIVATE,
            position:       4,
            url:            `https://www.youtube.com/watch?v=${PRIVATE}`,
            metadata:       { ...videos[3].metadata, availability: "private" },
        },
    ]);
});

test("resolveCaseVideos: without a Google key no video gets metadata", async () => {
    const deps = services({ configured: false });
    const videos = await resolveCaseVideos(caseVideoSummariesFromIds([KEPT, OTHER]), deps);

    assert.deepEqual(videos.map(video => video.metadata), [null, null]);
    assert.deepEqual(videos.map(video => video.youtubeVideoId), [KEPT, OTHER]);
    assert.deepEqual(deps.metadataService.calls, []);
});

test("resolveCaseVideos: a throwing service leaves the metadata null", quietly(async () => {
    const videos = await resolveCaseVideos(
        caseVideoSummariesFromIds([KEPT]),
        services({ error: new Error("boom") })
    );
    assert.equal(videos[0].metadata, null);
    assert.equal(videos[0].url, `https://www.youtube.com/watch?v=${KEPT}`);
}));

test("resolveCaseVideos: a case without videos asks YouTube nothing", async () => {
    const deps = services();
    assert.deepEqual(await resolveCaseVideos([], deps), []);
    assert.deepEqual(deps.metadataService.calls, []);
});

// Storage and copies

test("listCaseVideoIds: reads a case's ids in position order", async () => {
    const db = fakeDb([{ youtube_video_id: KEPT }, { youtube_video_id: OTHER }]);

    assert.deepEqual(await listCaseVideoIds(db, 12), [KEPT, OTHER]);
    assert.match(db.queries[0].sql, /ORDER BY position/u);
    assert.deepEqual(db.queries[0].params, [12]);
});

test("replaceCaseVideos: deletes the old list and inserts the new one in order", async () => {
    const db = fakeDb();
    await replaceCaseVideos(db, 12, [OTHER, KEPT]);

    assert.equal(db.queries.length, 2);
    assert.match(db.queries[0].sql, /DELETE FROM ethical_case_videos WHERE case_id = \$1/u);
    assert.deepEqual(db.queries[0].params, [12]);
    assert.match(db.queries[1].sql, /WITH ORDINALITY/u);
    assert.deepEqual(db.queries[1].params, [12, [OTHER, KEPT]]);
});

test("replaceCaseVideos: an empty list only deletes", async () => {
    const db = fakeDb();
    await replaceCaseVideos(db, 12, []);

    assert.equal(db.queries.length, 1);
    assert.match(db.queries[0].sql, /^DELETE/u);
});

test("copyCaseVideos: copies the source case's videos with their positions", async () => {
    const db = fakeDb();
    await copyCaseVideos(db, 12, 34);

    assert.equal(db.queries.length, 1);
    assert.match(db.queries[0].sql, /SELECT \$2, ecv\.position, ecv\.youtube_video_id/u);
    assert.match(db.queries[0].sql, /WHERE ecv\.case_id = \$1/u);
    assert.deepEqual(db.queries[0].params, [12, 34]);
});
