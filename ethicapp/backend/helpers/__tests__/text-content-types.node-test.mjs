import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    phaseInstructions,
    resolveTextContentType,
    storedTextContentType,
    TEXT_MARKDOWN,
    TEXT_PLAIN,
} from "../../../common/modules/text-content-types.js";

describe("text content types (#763)", () => {
    it("stores known content types and null for anything else", () => {
        assert.equal(storedTextContentType(TEXT_PLAIN), TEXT_PLAIN);
        assert.equal(storedTextContentType(TEXT_MARKDOWN), TEXT_MARKDOWN);
        for (const value of [undefined, null, "", "text/html", "TEXT/MARKDOWN", 1, {}]) {
            assert.equal(storedTextContentType(value), null, JSON.stringify(value));
        }
    });

    it("reads missing or unknown content types as text/plain", () => {
        assert.equal(resolveTextContentType(TEXT_MARKDOWN), TEXT_MARKDOWN);
        assert.equal(resolveTextContentType(TEXT_PLAIN), TEXT_PLAIN);
        for (const value of [undefined, null, "", "text/html"]) {
            assert.equal(resolveTextContentType(value), TEXT_PLAIN, JSON.stringify(value));
        }
    });

    it("takes the design's instructions with their content type", () => {
        const markdown = { instructions: "**Lee**", instructionsContentType: TEXT_MARKDOWN };
        assert.deepEqual(phaseInstructions(markdown, "q"), markdown);
        assert.deepEqual(phaseInstructions({ instructions: "Lee" }, "q"),
            { instructions: "Lee", instructionsContentType: TEXT_PLAIN });
        assert.deepEqual(
            phaseInstructions({ instructions: "", instructionsContentType: TEXT_MARKDOWN }, "q"),
            { instructions: "", instructionsContentType: TEXT_MARKDOWN },
            "empty design instructions still win, as before"
        );
    });

    it("falls back to the legacy question, always as text/plain", () => {
        assert.deepEqual(
            phaseInstructions({ instructionsContentType: TEXT_MARKDOWN }, "¿Quién?"),
            { instructions: "¿Quién?", instructionsContentType: TEXT_PLAIN }
        );
        assert.deepEqual(phaseInstructions(null, undefined),
            { instructions: "", instructionsContentType: TEXT_PLAIN });
        assert.deepEqual(phaseInstructions(undefined, 3),
            { instructions: "", instructionsContentType: TEXT_PLAIN });
    });
});
