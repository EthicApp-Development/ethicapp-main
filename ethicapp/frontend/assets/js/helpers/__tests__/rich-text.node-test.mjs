import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { parseRichText, toPlainText } from "../rich-text.js";

// The shared contract (#762), read from the repository root.
const FIXTURES_URL = new URL("../../../../../../canonical-schemas/rich-text/fixtures.json",
    import.meta.url);
const { cases } = JSON.parse(readFileSync(FIXTURES_URL, "utf8"));

describe("rich text in the teacher views (#764)", () => {
    it("passes every shared fixture", () => {
        assert.ok(cases.length > 0);
        for (const fixture of cases) {
            assert.deepEqual(parseRichText(fixture.input, fixture.contentType), fixture.tree,
                `${fixture.name}: tree`);
            assert.equal(toPlainText(fixture.input, fixture.contentType), fixture.plainText,
                `${fixture.name}: plain text`);
        }
    });
});
