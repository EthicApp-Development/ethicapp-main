import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { translatePlainText } from "../plain-text-translation.js";

describe("translatePlainText", () => {
    it("translates with the per-call sanitize strategy switched off", () => {
        const calls = [];
        const $translate = {
            instant: (...args) => {
                calls.push(args);
                return "Se quitó el análisis \"Análisis de prueba\"";
            },
        };

        const message = translatePlainText($translate, "case_analysis_remove_notice",
            { title: "Análisis de prueba" });

        assert.equal(message, "Se quitó el análisis \"Análisis de prueba\"");
        assert.deepEqual(calls, [[
            "case_analysis_remove_notice",
            { title: "Análisis de prueba" },
            undefined,
            undefined,
            null,
        ]]);
    });
});
