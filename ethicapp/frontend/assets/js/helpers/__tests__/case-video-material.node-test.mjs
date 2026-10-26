import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CASE_MATERIAL_DISPLAY, caseMaterialVideos } from "../case-video-material.js";

const ID_A = "dQw4w9WgXcQ";
const ID_B = "9bZkp7q19f0";
const ID_C = "kJQP7kiw5Fk";

function metadata(overrides = {}) {
    return {
        title:           "Dilema",
        description:     "Primera línea\nSegunda línea",
        channelTitle:    "Canal",
        durationSeconds: 205,
        availability:    "available",
        ...overrides,
    };
}

function caseVideo(youtubeVideoId, position, videoMetadata = metadata()) {
    const url = `https://www.youtube.com/watch?v=${youtubeVideoId}`;
    return { youtubeVideoId, position, url, metadata: videoMetadata };
}

describe("the case's videos as complementary material (#788)", () => {
    it("lists nothing for cases without videos", () => {
        for (const caseObj of [null, undefined, {}, { videos: null }, { videos: [] },
            { videos: "not a list" }]) {
            assert.deepEqual(caseMaterialVideos(caseObj), [], JSON.stringify(caseObj));
        }
    });

    it("lists the videos in the case's order", () => {
        const videos = [caseVideo(ID_C, 2), caseVideo(ID_A, 0), caseVideo(ID_B, 1)];
        assert.deepEqual(caseMaterialVideos({ videos }).map(video => video.youtubeVideoId),
            [ID_A, ID_B, ID_C]);
    });

    it("shows a video with metadata through the facade, with its plain text", () => {
        const [video] = caseMaterialVideos({ videos: [caseVideo(ID_A, 0, metadata({
            title:       "  <b>Dilema</b>  ",
            description: "  <script>x</script>\nfin  ",
        }))] });
        assert.deepEqual(video, {
            youtubeVideoId:     ID_A,
            watchUrl:           `https://www.youtube.com/watch?v=${ID_A}`,
            title:              "<b>Dilema</b>",
            description:        "<script>x</script>\nfin",
            hasLongDescription: false,
            metadata:           {
                title:           "  <b>Dilema</b>  ",
                description:     "  <script>x</script>\nfin  ",
                channelTitle:    "Canal",
                durationSeconds: 205,
                availability:    "available",
            },
            display: CASE_MATERIAL_DISPLAY.facade,
        });
    });

    it("keeps unavailable videos on the facade path, which shows their notice", () => {
        for (const availability of ["private", "not_embeddable", "removed"]) {
            const [video] = caseMaterialVideos({ videos: [caseVideo(ID_A, 0, metadata({
                title: null, description: null, durationSeconds: null, availability,
            }))] });
            assert.equal(video.display, CASE_MATERIAL_DISPLAY.facade, availability);
            assert.equal(video.metadata.availability, availability);
            assert.equal(video.title, "");
            assert.equal(video.description, "");
        }
    });

    it("shows the link of a video without metadata", () => {
        const [video] = caseMaterialVideos({ videos: [caseVideo(ID_B, 0, null)] });
        assert.deepEqual(video, {
            youtubeVideoId:     ID_B,
            watchUrl:           `https://www.youtube.com/watch?v=${ID_B}`,
            title:              "",
            description:        "",
            hasLongDescription: false,
            metadata:           null,
            display:            CASE_MATERIAL_DISPLAY.link,
        });
    });

    it("builds the watch link from the id, not from the API's url", () => {
        const video = { ...caseVideo(ID_A, 0), url: "javascript:alert(1)" };
        assert.equal(caseMaterialVideos({ videos: [video] })[0].watchUrl,
            `https://www.youtube.com/watch?v=${ID_A}`);
    });

    it("leaves out entries without a valid YouTube id", () => {
        const videos = [caseVideo("\"><script>", 0), { position: 1 }, null, caseVideo(ID_A, 2)];
        assert.deepEqual(caseMaterialVideos({ videos }).map(video => video.youtubeVideoId),
            [ID_A]);
    });

    it("collapses long descriptions only", () => {
        const long = caseMaterialVideos({ videos: [
            caseVideo(ID_A, 0, metadata({ description: "x".repeat(281) })),
            caseVideo(ID_B, 1, metadata({ description: "1\n2\n3\n4\n5" })),
            caseVideo(ID_C, 2, metadata({ description: "breve" })),
        ] }).map(video => video.hasLongDescription);
        assert.deepEqual(long, [true, true, false]);
    });
});
