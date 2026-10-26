import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { itemBuilders } from "../phase-creation-helpers.js";

function question(overrides = {}) {
    return {
        q_text:     "Pregunta",
        ans_format: {
            l_pole:          "Izquierda",
            r_pole:          "Derecha",
            values:          4,
            just_required:   true,
            min_just_length: 10,
        },
        ...overrides,
    };
}

describe("semantic differential phase items (#763)", () => {
    it("send each question's content type with its text", () => {
        const phase = {
            questions: [
                question({ q_text: "**Uno**", q_text_content_type: "text/markdown" }),
                question({ q_text: "Dos", q_text_content_type: "text/plain" }),
            ],
        };

        const items = itemBuilders.semantic_differential(phase, 14, 21);

        assert.deepEqual(items.map(item => [item.name, item.titleContentType]),
            [["**Uno**", "text/markdown"], ["Dos", "text/plain"]]);
        assert.deepEqual(items[0], {
            name:             "**Uno**",
            titleContentType: "text/markdown",
            tleft:            "Izquierda",
            tright:           "Derecha",
            num:              4,
            orden:            1,
            justify:          true,
            stageId:          14,
            sessionId:        21,
            wordCount:        10,
        });
    });

    it("leave the content type out for questions that declare none", () => {
        const [item] = itemBuilders.semantic_differential({ questions: [question()] }, 14, 21);

        assert.equal(item.titleContentType, undefined);
        assert.equal("titleContentType" in JSON.parse(JSON.stringify(item)), false,
            "it is not sent, and the backend stores null");
    });
});
