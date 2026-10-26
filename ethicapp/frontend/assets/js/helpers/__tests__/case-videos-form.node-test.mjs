import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    MAX_CASE_VIDEOS,
    addCaseVideo,
    caseVideoFieldErrorKeys,
    caseVideoFromPreview,
    caseVideoIds,
    caseVideoSaveErrorKey,
    caseVideoWarningKey,
    caseVideosFromCase,
    caseVideosPayload,
    checkCaseVideoUrl,
    formatVideoDuration,
    isLongVideoDescription,
    moveCaseVideo,
    previewErrorMessageKey,
    removeCaseVideo,
} from "../case-videos-form.js";

const ID_A = "dQw4w9WgXcQ";
const ID_B = "9bZkp7q19f0";
const ID_C = "kJQP7kiw5Fk";

function video(youtubeVideoId, metadata = { title: youtubeVideoId, availability: "available" }) {
    return { youtubeVideoId, url: `https://www.youtube.com/watch?v=${youtubeVideoId}`, metadata };
}

function manyVideos(count) {
    return Array.from({ length: count }, (_unused, index) => {
        return video(`video${String(index).padStart(6, "0")}`);
    });
}

describe("formatVideoDuration (#783)", () => {
    it("formats durations under an hour as m:ss", () => {
        assert.equal(formatVideoDuration(0), "0:00");
        assert.equal(formatVideoDuration(9), "0:09");
        assert.equal(formatVideoDuration(213), "3:33");
        assert.equal(formatVideoDuration(3599), "59:59");
    });

    it("formats durations from one hour on as h:mm:ss", () => {
        assert.equal(formatVideoDuration(3600), "1:00:00");
        assert.equal(formatVideoDuration(3725), "1:02:05");
        assert.equal(formatVideoDuration(36000 + 61), "10:01:01");
    });

    it("returns an empty string for unknown durations", () => {
        for (const value of [null, undefined, "", -1, Number.NaN, "abc"]) {
            assert.equal(formatVideoDuration(value), "");
        }
    });
});

describe("isLongVideoDescription (#783)", () => {
    it("collapses descriptions with many lines or characters", () => {
        assert.equal(isLongVideoDescription("short"), false);
        assert.equal(isLongVideoDescription(null), false);
        assert.equal(isLongVideoDescription("1\n2\n3\n4"), false);
        assert.equal(isLongVideoDescription("1\n2\n3\n4\n5"), true);
        assert.equal(isLongVideoDescription("x".repeat(281)), true);
    });
});

describe("caseVideoFromPreview (#783)", () => {
    it("keeps the display metadata and the availability of a preview", () => {
        const item = caseVideoFromPreview({
            youtubeVideoId: ID_A,
            url:            `https://www.youtube.com/watch?v=${ID_A}`,
            metadata:       {
                title:           "A talk",
                description:     "Line 1\nLine 2",
                channelTitle:    "A channel",
                durationSeconds: 125,
                embeddable:      true,
                privacyStatus:   "public",
            },
            availability: "available",
        });

        assert.deepEqual(item, {
            youtubeVideoId: ID_A,
            url:            `https://www.youtube.com/watch?v=${ID_A}`,
            metadata:       {
                title:           "A talk",
                description:     "Line 1\nLine 2",
                channelTitle:    "A channel",
                durationSeconds: 125,
                availability:    "available",
            },
        });
    });
});

describe("caseVideosFromCase (#783)", () => {
    it("orders the videos of GET /cases/:id by position and keeps null metadata", () => {
        const items = caseVideosFromCase({
            videos: [
                { youtubeVideoId: ID_B, position: 2, url: "b", metadata: null },
                {
                    youtubeVideoId: ID_A,
                    position:       1,
                    url:            "a",
                    metadata:       { title: "A", availability: "available" },
                },
            ],
        });

        assert.deepEqual(caseVideoIds(items), [ID_A, ID_B]);
        assert.equal(items[0].metadata.title, "A");
        assert.equal(items[1].metadata, null);
    });

    it("returns an empty list for cases without videos", () => {
        assert.deepEqual(caseVideosFromCase({}), []);
        assert.deepEqual(caseVideosFromCase(null), []);
    });
});

describe("checkCaseVideoUrl (#783)", () => {
    it("accepts a new YouTube video URL", () => {
        assert.deepEqual(
            checkCaseVideoUrl([video(ID_B)], ` https://youtu.be/${ID_A} `),
            { ok: true, videoId: ID_A }
        );
    });

    it("refuses URLs that are not YouTube video URLs", () => {
        for (const url of ["", "not a url", "https://example.com/watch?v=dQw4w9WgXcQ"]) {
            assert.deepEqual(checkCaseVideoUrl([], url), {
                ok:       false,
                errorKey: "case_videos_error_invalid_url",
            });
        }
    });

    it("refuses a video already in the list, whatever the URL form", () => {
        const result = checkCaseVideoUrl([video(ID_A)], `https://www.youtube.com/watch?v=${ID_A}`);

        assert.deepEqual(result, { ok: false, errorKey: "case_videos_error_duplicate" });
    });

    it("refuses new videos once the list is full", () => {
        const result = checkCaseVideoUrl(manyVideos(MAX_CASE_VIDEOS), `https://youtu.be/${ID_A}`);

        assert.deepEqual(result, { ok: false, errorKey: "case_videos_error_too_many" });
    });
});

describe("list operations (#783)", () => {
    it("appends new videos and ignores duplicates", () => {
        const list = addCaseVideo([video(ID_A)], video(ID_B));

        assert.deepEqual(caseVideoIds(list), [ID_A, ID_B]);
        assert.equal(addCaseVideo(list, video(ID_A)), list);
        assert.deepEqual(caseVideoIds(addCaseVideo(undefined, video(ID_C))), [ID_C]);
    });

    it("moves videos up and down without leaving the list", () => {
        const list = [video(ID_A), video(ID_B), video(ID_C)];

        assert.deepEqual(caseVideoIds(moveCaseVideo(list, 2, -1)), [ID_A, ID_C, ID_B]);
        assert.deepEqual(caseVideoIds(moveCaseVideo(list, 0, 1)), [ID_B, ID_A, ID_C]);
        assert.equal(moveCaseVideo(list, 0, -1), list);
        assert.equal(moveCaseVideo(list, 2, 1), list);
        assert.deepEqual(caseVideoIds(list), [ID_A, ID_B, ID_C]);
    });

    it("removes the video at an index", () => {
        const list = [video(ID_A), video(ID_B), video(ID_C)];

        assert.deepEqual(caseVideoIds(removeCaseVideo(list, 1)), [ID_A, ID_C]);
        assert.equal(removeCaseVideo(list, 3), list);
    });
});

describe("caseVideosPayload (#783)", () => {
    it("leaves the field out when the list is unchanged", () => {
        assert.equal(caseVideosPayload([], []), null);
        assert.equal(caseVideosPayload([video(ID_A), video(ID_B)], [ID_A, ID_B]), null);
        assert.equal(caseVideosPayload(undefined), null);
    });

    it("sends the ordered ids when videos are added, moved or removed", () => {
        assert.deepEqual(caseVideosPayload([video(ID_A)]), [ID_A]);
        assert.deepEqual(
            caseVideosPayload([video(ID_B), video(ID_A)], [ID_A, ID_B]),
            [ID_B, ID_A]
        );
        assert.deepEqual(caseVideosPayload([], [ID_A]), []);
    });
});

describe("previewErrorMessageKey (#783)", () => {
    it("maps every preview error code to its message", () => {
        const expected = {
            invalid_url:    "case_videos_error_invalid_url",
            not_found:      "case_videos_error_not_found",
            private:        "case_videos_error_private",
            not_embeddable: "case_videos_error_not_embeddable",
            not_configured: "case_videos_error_not_configured",
            unavailable:    "case_videos_error_unavailable",
            throttled:      "case_videos_error_throttled",
        };

        for (const [code, key] of Object.entries(expected)) {
            assert.equal(previewErrorMessageKey({ status: 400, data: { code } }), key);
        }
    });

    it("treats a 429 without a code as throttled, and anything else as a failure", () => {
        const throttled = { status: 429, data: "" };

        assert.equal(previewErrorMessageKey(throttled), "case_videos_error_throttled");
        assert.equal(previewErrorMessageKey({ status: 500 }), "case_videos_error_preview_failed");
        assert.equal(previewErrorMessageKey(undefined), "case_videos_error_preview_failed");
    });
});

describe("case save errors (#783)", () => {
    it("maps CASE_VIDEOS_* codes to messages and leaves other codes alone", () => {
        const expected = {
            CASE_VIDEOS_INVALID:        "case_videos_save_invalid",
            CASE_VIDEOS_REJECTED:       "case_videos_save_rejected",
            CASE_VIDEOS_NOT_CONFIGURED: "case_videos_save_not_configured",
            CASE_VIDEOS_UNAVAILABLE:    "case_videos_save_unavailable",
        };

        for (const [code, key] of Object.entries(expected)) {
            assert.equal(caseVideoSaveErrorKey({ data: { code } }), key);
        }
        assert.equal(caseVideoSaveErrorKey({ data: { code: "CASE_PDF_REQUIRED" } }), null);
        assert.equal(caseVideoSaveErrorKey(undefined), null);
    });

    it("maps the per-video reasons of the fields", () => {
        const error = {
            status: 400,
            data:   {
                code:   "CASE_VIDEOS_REJECTED",
                fields: { [ID_A]: "private", [ID_B]: "not_found", [ID_C]: "not_embeddable" },
            },
        };

        assert.deepEqual(caseVideoFieldErrorKeys(error), {
            [ID_A]: "case_videos_error_private",
            [ID_B]: "case_videos_error_not_found",
            [ID_C]: "case_videos_error_not_embeddable",
        });
    });

    it("ignores list-wide fields, unknown reasons and other errors", () => {
        assert.deepEqual(caseVideoFieldErrorKeys({
            data: { code: "CASE_VIDEOS_INVALID", fields: { videos: "too_many", [ID_A]: "odd" } },
        }), {});
        assert.deepEqual(caseVideoFieldErrorKeys({
            data: { code: "CASE_VALIDATION_FAILED", fields: { [ID_A]: "private" } },
        }), {});
        assert.deepEqual(caseVideoFieldErrorKeys(undefined), {});
    });
});

describe("caseVideoWarningKey (#783)", () => {
    it("warns about missing metadata and videos that are not available", () => {
        assert.equal(caseVideoWarningKey(video(ID_A)), null);
        assert.equal(caseVideoWarningKey(video(ID_A, null)), "case_videos_metadata_missing");
        assert.equal(
            caseVideoWarningKey(video(ID_A, { availability: "removed" })),
            "case_videos_availability_removed"
        );
        assert.equal(
            caseVideoWarningKey(video(ID_A, { availability: "private" })),
            "case_videos_availability_private"
        );
        assert.equal(
            caseVideoWarningKey(video(ID_A, { availability: "not_embeddable" })),
            "case_videos_availability_not_embeddable"
        );
        assert.equal(
            caseVideoWarningKey(video(ID_A, { availability: "something_new" })),
            "case_videos_availability_unknown"
        );
    });
});
