import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    VIDEO_METADATA_MISSING_KEY, VIDEO_NOT_IN_CASE_KEY, caseVideoChoices, caseVideoEmbedTitle,
    designVideoWarnings, embeddedVideoStatus, embeddedVideos, videosMissingFromCase,
} from "../case-video-embeds.js";

const MARKDOWN = "text/markdown";
const FIRST = "M7lc1UVf-VE";
const SECOND = "dQw4w9WgXcQ";
const THIRD = "a_b-c_d-e_f";

function caseVideo(youtubeVideoId, position, metadata) {
    return {
        youtubeVideoId,
        position,
        url: `https://www.youtube.com/watch?v=${youtubeVideoId}`,
        metadata,
    };
}

const LONG_DESCRIPTION = "Una línea.\n".repeat(6);
const CASE_VIDEOS = [
    caseVideo(SECOND, 2, null),
    caseVideo(FIRST, 1, {
        title:           "  Introducción al caso ",
        description:     LONG_DESCRIPTION,
        channelTitle:    "Canal",
        durationSeconds: 3725,
        availability:    "available",
    }),
    caseVideo(THIRD, 3, {
        title:           "Privado",
        description:     "Corto",
        channelTitle:    null,
        durationSeconds: 59,
        availability:    "private",
    }),
];

const link = (id, title) => `[${title}](https://youtu.be/${id})`;

describe("case video embeds (#787)", () => {
    it("titles a chosen video with YouTube's title, or its id without metadata", () => {
        assert.equal(caseVideoEmbedTitle(CASE_VIDEOS[1]), "Introducción al caso");
        assert.equal(caseVideoEmbedTitle(CASE_VIDEOS[0]), SECOND);
        assert.equal(caseVideoEmbedTitle(caseVideo(FIRST, 1, { title: "  " })), FIRST);
    });

    it("lists the dialog's choices in the case's order", () => {
        const choices = caseVideoChoices(CASE_VIDEOS);
        assert.deepEqual(choices.map(choice => choice.videoId), [FIRST, SECOND, THIRD]);

        assert.deepEqual(choices[0], {
            videoId:         FIRST,
            title:           "Introducción al caso",
            hasMetadata:     true,
            duration:        "1:02:05",
            channelTitle:    "Canal",
            description:     LONG_DESCRIPTION,
            longDescription: true,
            selectable:      true,
            noticeKey:       null,
        });
        assert.equal(choices[1].title, SECOND);
        assert.equal(choices[1].hasMetadata, false);
        assert.equal(choices[1].selectable, true);
        assert.equal(choices[1].noticeKey, VIDEO_METADATA_MISSING_KEY);
        assert.equal(choices[1].duration, "");
        assert.equal(choices[2].selectable, false);
        assert.equal(choices[2].noticeKey, "case_videos_availability_private");
        assert.equal(choices[2].duration, "0:59");
        assert.equal(choices[2].longDescription, false);

        assert.deepEqual(caseVideoChoices(null), []);
    });

    it("reads the videos a text embeds, only from text/markdown", () => {
        const text = `${link(FIRST, "*Uno*")}\n\nTexto con ${link(SECOND, "enlace")}.\n\n`
            + `- ${link(THIRD, "en lista")}`;
        assert.deepEqual(embeddedVideos(text, MARKDOWN), [{ videoId: FIRST, title: "Uno" }]);
        assert.deepEqual(embeddedVideos(text, "text/plain"), []);
        assert.deepEqual(embeddedVideos("", MARKDOWN), []);
        assert.deepEqual(embeddedVideos(undefined, MARKDOWN), []);
        assert.equal(embeddedVideos(text, MARKDOWN), embeddedVideos(text, MARKDOWN), "cached");
    });

    it("finds embedded videos the case does not hold, once the case is known", () => {
        const text = `${link(FIRST, "Uno")}\n\n${link("zzzzzzzzzzz", "Otro")}`;
        assert.deepEqual(videosMissingFromCase(text, MARKDOWN, CASE_VIDEOS),
            [{ videoId: "zzzzzzzzzzz", title: "Otro" }]);
        assert.deepEqual(videosMissingFromCase(text, MARKDOWN, []).length, 2);
        assert.deepEqual(videosMissingFromCase(text, MARKDOWN, null), []);
    });

    it("describes an embedded video for its card", () => {
        assert.deepEqual(embeddedVideoStatus(CASE_VIDEOS, FIRST),
            { duration: "1:02:05", warningKey: null });
        assert.deepEqual(embeddedVideoStatus(CASE_VIDEOS, SECOND),
            { duration: "", warningKey: null });
        assert.deepEqual(embeddedVideoStatus(CASE_VIDEOS, THIRD),
            { duration: "0:59", warningKey: "case_videos_availability_private" });
        assert.deepEqual(embeddedVideoStatus(CASE_VIDEOS, "zzzzzzzzzzz"),
            { duration: "", warningKey: VIDEO_NOT_IN_CASE_KEY });
        assert.deepEqual(embeddedVideoStatus(undefined, "zzzzzzzzzzz"),
            { duration: "", warningKey: null });
    });

    it("lists the design's warnings by phase and question", () => {
        const question = (text, contentType = MARKDOWN) => ({
            q_text: text, q_text_content_type: contentType,
        });
        const phases = [
            { questions: [question(link(FIRST, "Uno")), question(link("zzzzzzzzzzz", "Otro"))] },
            { roles: [] },
            { questions: [question(link("yyyyyyyyyyy", "Plano"), "text/plain"),
                question(`${link("yyyyyyyyyyy", "Tercero")}\n\n${link(SECOND, "Dos")}`)] },
        ];
        assert.deepEqual(designVideoWarnings(phases, CASE_VIDEOS), [
            { phaseNumber: 1, questionNumber: 2, videoId: "zzzzzzzzzzz", title: "Otro" },
            { phaseNumber: 3, questionNumber: 2, videoId: "yyyyyyyyyyy", title: "Tercero" },
        ]);
        assert.equal(designVideoWarnings(phases, []).length, 4);
        assert.deepEqual(designVideoWarnings(phases, null), []);
        assert.deepEqual(designVideoWarnings(undefined, CASE_VIDEOS), []);
    });
});
