import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { createRichText } from "../../../common/modules/rich-text.js";
import { parseRichText, toPlainText } from "../rich-text-helper.js";

// The shared contract (#762). In the Docker test stage it is copied to /canonical-schemas.
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
});
