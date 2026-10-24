import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    canonicalYoutubeUrl,
    isYoutubeVideoId,
    youtubeEmbedUrl,
    youtubeVideoId,
} from "../../../common/modules/youtube-urls.js";

const ID = "dQw4w9WgXcQ";

describe("YouTube URLs (#780)", () => {
    it("recognizes the forms teachers paste", () => {
        const accepted = [
            `https://www.youtube.com/watch?v=${ID}`,
            `https://youtube.com/watch?v=${ID}&t=42s&list=PL123`,
            `https://youtube.com/watch?feature=share&v=${ID}`,
            `http://m.youtube.com/watch?v=${ID}`,
            `https://music.youtube.com/watch?v=${ID}`,
            `https://youtu.be/${ID}`,
            `https://youtu.be/${ID}?si=abc&t=10`,
            `https://www.youtube.com/shorts/${ID}`,
            `https://www.youtube.com/embed/${ID}?start=5`,
            `https://www.youtube.com/live/${ID}`,
            `https://www.youtube.com/v/${ID}`,
            `https://www.youtube-nocookie.com/embed/${ID}`,
            `  https://YOUTU.BE/${ID}  `,
        ];
        for (const url of accepted) {
            assert.equal(youtubeVideoId(url), ID, url);
        }
    });

    it("rejects other hosts, schemes, malformed ids and non-strings", () => {
        const rejected = [
            `https://www.youtube.com.evil.example/watch?v=${ID}`,
            `https://evil.example/watch?v=${ID}`,
            `https://evil.example/?u=https://youtu.be/${ID}`,
            `javascript:alert("https://youtu.be/${ID}")`,
            `ftp://youtu.be/${ID}`,
            `https://www.youtube.com/watch?v=${ID}x`,
            "https://www.youtube.com/watch?v=short",
            "https://www.youtube.com/playlist?list=PL123",
            "https://www.youtube.com/channel/UC123",
            "https://www.youtube.com/",
            `www.youtube.com/watch?v=${ID}`,
            "",
            null,
            undefined,
            42,
        ];
        for (const value of rejected) {
            assert.equal(youtubeVideoId(value), null, String(value));
        }
    });

    it("validates ids", () => {
        assert.equal(isYoutubeVideoId(ID), true);
        assert.equal(isYoutubeVideoId("abc_DEF-123"), true);
        const malformed = ["", "dQw4w9WgXc", "dQw4w9WgXcQQ", "dQw4w9WgX<Q", "dQw4w9WgX Q", null, 1];
        for (const value of malformed) {
            assert.equal(isYoutubeVideoId(value), false, String(value));
        }
    });

    it("builds the canonical and embed URLs from an id only", () => {
        assert.equal(canonicalYoutubeUrl(ID), `https://www.youtube.com/watch?v=${ID}`);
        assert.equal(youtubeEmbedUrl(ID),
            `https://www.youtube-nocookie.com/embed/${ID}?playsinline=1&rel=0`);
        for (const builder of [canonicalYoutubeUrl, youtubeEmbedUrl]) {
            assert.throws(() => builder("not-an-id"), TypeError);
            assert.throws(() => builder(`${ID}"><script>`), TypeError);
        }
    });
});
