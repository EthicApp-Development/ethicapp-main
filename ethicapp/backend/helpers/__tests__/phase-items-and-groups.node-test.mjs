// The pure parts of starting a phase (#906): the items copied from the
// design's phase, and how students are split into groups and lettered.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { rankingItems, semanticDifferentialItems } from "../phase-items-helper.js";
import { memberMask, shuffle, splitIntoGroups } from "../groups-helper.js";

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

describe("semantic differential items", () => {
    it("copy each question, in order, with its content type (#763)", () => {
        const items = semanticDifferentialItems({
            questions: [
                question({ q_text: "**Uno**", q_text_content_type: "text/markdown" }),
                question({ q_text: "Dos", q_text_content_type: "text/plain" }),
            ],
        });

        assert.deepEqual(items, [
            {
                title:            "**Uno**",
                titleContentType: "text/markdown",
                tleft:            "Izquierda",
                tright:           "Derecha",
                orden:            1,
                num:              4,
                justify:          true,
                wordCount:        10,
            },
            {
                title:            "Dos",
                titleContentType: "text/plain",
                tleft:            "Izquierda",
                tright:           "Derecha",
                orden:            2,
                num:              4,
                justify:          true,
                wordCount:        10,
            },
        ]);
    });

    it("store null for a content type the question does not declare, or does not know", () => {
        const items = semanticDifferentialItems({
            questions: [question(), question({ q_text_content_type: "text/html" })],
        });

        assert.deepEqual(items.map(item => item.titleContentType), [null, null]);
    });

    it("are none for a phase without questions", () => {
        assert.deepEqual(semanticDifferentialItems({}), []);
    });
});

describe("ranking items", () => {
    it("copy each role: ordered or not, justified when it has a type", () => {
        assert.deepEqual(rankingItems({
            roles: [
                { name: "Ordered", type: "order", wc: 20 },
                { name: "Justified", type: "justify", wc: 5 },
                { name: "Free", type: null, wc: 0 },
            ],
        }), [
            { name: "Ordered", jorder: true, justified: true, wordCount: 20 },
            { name: "Justified", jorder: false, justified: true, wordCount: 5 },
            { name: "Free", jorder: false, justified: false, wordCount: 0 },
        ]);
    });
});

describe("splitIntoGroups", () => {
    it("forms full groups and spreads the rest over the first ones", () => {
        assert.deepEqual(splitIntoGroups([1, 2, 3, 4, 5, 6, 7, 8], 3),
            [[1, 2, 3, 8], [4, 5, 6, 7]]);
        assert.deepEqual(splitIntoGroups([1, 2, 3, 4, 5, 6], 3), [[1, 2, 3], [4, 5, 6]]);
        assert.deepEqual(splitIntoGroups([1, 2, 3, 4, 5], 2), [[1, 2, 5], [3, 4]]);
    });

    it("puts everyone in one group when there are fewer students than its size", () => {
        assert.deepEqual(splitIntoGroups([1, 2], 3), [[1, 2]]);
    });

    it("forms no group without students", () => {
        assert.deepEqual(splitIntoGroups([], 3), []);
    });
});

describe("shuffle", () => {
    it("returns a permutation drawn from the given random source, leaving the input alone", () => {
        const ids = [1, 2, 3, 4];
        const draws = [0.9, 0.1, 0.5];
        const shuffled = shuffle(ids, () => draws.shift());

        assert.deepEqual(ids, [1, 2, 3, 4]);
        assert.deepEqual([...shuffled].sort(), [1, 2, 3, 4]);
        assert.deepEqual(shuffled, [3, 2, 1, 4]);
    });
});

describe("memberMask", () => {
    it("letters the members of a group from A to Z", () => {
        assert.deepEqual([0, 1, 2, 25].map(memberMask), ["A", "B", "C", "Z"]);
        assert.throws(() => memberMask(26), /Exceeded allowed characters for anon_mask/u);
    });
});
