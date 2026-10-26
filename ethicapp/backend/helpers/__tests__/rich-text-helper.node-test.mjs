import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import MarkdownIt from "markdown-it";

import { createRichText } from "../../../common/modules/rich-text.js";
import { parseRichText, plainTextOf, toPlainText } from "../rich-text-helper.js";

// The shared contract (#762, version 2 in #784). In the Docker test stage it is copied to
// /canonical-schemas.
const FIXTURES_URL = new URL("../../../../canonical-schemas/rich-text/fixtures.json",
    import.meta.url);
const { cases } = JSON.parse(readFileSync(FIXTURES_URL, "utf8"));

describe("rich text in the backend (#764)", () => {
    it("passes every shared fixture", () => {
        assert.ok(cases.length > 0);
        for (const fixture of cases) {
            assert.deepEqual(parseRichText(fixture.input, fixture.contentType), fixture.tree,
                `${fixture.name}: tree`);
            assert.equal(toPlainText(fixture.input, fixture.contentType), fixture.plainText,
                `${fixture.name}: plain text`);
        }
    });

    it("treats anything but a string as empty text", () => {
        for (const text of [undefined, null, 3, { text: "x" }]) {
            assert.deepEqual(parseRichText(text, "text/markdown"), []);
            assert.equal(toPlainText(text, "text/markdown"), "");
            assert.equal(toPlainText(text, "text/plain"), "");
        }
    });

    it("shows the text as text/plain when the parser yields a token outside the subset", () => {
        class UnexpectedTokens {
            inline = { ruler: { before() {} } };

            enable() {
                return this;
            }

            parse() {
                return [{ type: "heading_open" }];
            }
        }
        const richText = createRichText(UnexpectedTokens);

        assert.deepEqual(richText.parseRichText("# Uno\nDos", "text/markdown"), [{
            type:     "paragraph",
            children: [
                { type: "text", value: "# Uno" }, { type: "break" }, { type: "text", value: "Dos" },
            ],
        }]);
        assert.equal(richText.toPlainText("# Uno\nDos", "text/markdown"), "# Uno\nDos");
    });

    it("never yields HTML: injection attempts stay text", () => {
        const source = "<script>alert(1)</script> [x](javascript:alert(1))";
        assert.deepEqual(parseRichText(source, "text/markdown"), [{
            type:     "paragraph",
            children: [{ type: "text", value: source }],
        }]);
    });

    it("makes video blocks only with the YouTube URL functions (#784)", () => {
        const source = "[El caso](https://youtu.be/M7lc1UVf-VE)";
        assert.deepEqual(parseRichText(source, "text/markdown"), [{
            type: "video", provider: "youtube", videoId: "M7lc1UVf-VE", title: "El caso",
        }]);

        const withoutVideos = createRichText(MarkdownIt);
        assert.deepEqual(withoutVideos.parseRichText(source, "text/markdown"), [{
            type:     "paragraph",
            children: [{
                type:     "link",
                href:     "https://youtu.be/M7lc1UVf-VE",
                children: [{ type: "text", value: "El caso" }],
            }],
        }]);
        assert.equal(withoutVideos.toPlainText(source, "text/markdown"),
            "El caso (https://youtu.be/M7lc1UVf-VE)");
    });

    it("never makes a video from an id the injected parser did not validate", () => {
        const richText = createRichText(MarkdownIt, {
            youtubeVideoId:      () => "not-an-id",
            canonicalYoutubeUrl: id => `https://www.youtube.com/watch?v=${id}`,
        });
        assert.equal(richText.parseRichText("<https://example.org/v>", "text/markdown")[0].type,
            "paragraph");
    });

    it("links only to http and https URLs, and plainTextOf renders them (#784)", () => {
        const source = "[a](https://example.org) [b](javascript:alert(1)) <ftp://example.org>";
        assert.deepEqual(parseRichText(source, "text/markdown")[0].children, [
            { type: "link", href: "https://example.org", children: [{ type: "text", value: "a" }] },
            { type: "text", value: " [b](javascript:alert(1)) <ftp://example.org>" },
        ]);
        assert.equal(plainTextOf(source, "text/markdown"),
            "a (https://example.org) [b](javascript:alert(1)) <ftp://example.org>");
        assert.equal(plainTextOf(source, undefined), source);
    });
});
