// The mock review document (ethicapp-main #1134). Its validation against the
// student-result/v1 schema copy is tested in the EthicApp backend
// (external-services/adapters/__tests__/mock-ai-response-review.adapter.node-test.mjs),
// which has the validator.
import assert from "node:assert/strict";
import test from "node:test";

import {
    buildMockReview,
    DEFAULT_LOCALE,
    DOCUMENT_SCHEMA,
    documentLocale,
    UNKNOWN_SECTION_KIND,
} from "../student-result.js";

const TEXT = "Taking the exam for a friend deceives the university.";

function sectionKinds(document) {
    return document.sections.map(section => section.kind);
}

test("a review uses every section kind, one unknown kind, an overview and criterion descriptions", () => {
    const { document, analysis } = buildMockReview({ text: TEXT, locale: "en-US" });

    assert.equal(document.schemaVersion, DOCUMENT_SCHEMA);
    assert.equal(document.locale, "en-US");
    assert.match(document.overview, /\*\*mock\*\*/u);
    assert.deepEqual(sectionKinds(document), [
        "criteria", "bullets", UNKNOWN_SECTION_KIND, "text", "comparison",
    ]);
    assert.deepEqual(analysis, { wordCount: 9, characterCount: Array.from(TEXT).length });

    const [criteria, , , text, comparison] = document.sections;
    assert.deepEqual(criteria.items.map(item => item.key), ["words", "characters", "justification"]);
    for (const item of criteria.items) {
        assert.ok(item.description, `${item.key} has a description`);
    }
    assert.deepEqual(
        { score: criteria.items[0].score, minScore: criteria.items[0].minScore, maxScore: criteria.items[0].maxScore },
        { score: 9, minScore: 0, maxScore: 80 }
    );
    assert.equal(text.text, Array.from(TEXT).reverse().join(""));
    assert.deepEqual(comparison.items.map(item => item.trend), ["unchanged", "unchanged", undefined]);
});

test("the texts follow the locale, and other locales fall back to es-CL", () => {
    const spanish = buildMockReview({ text: TEXT, locale: "es-CL" }).document;
    assert.equal(spanish.locale, "es-CL");
    assert.equal(spanish.title, "Revisión de prueba de tu respuesta");
    assert.equal(spanish.sections[0].items[0].value, "9 palabras");

    assert.equal(DEFAULT_LOCALE, "es-CL");
    for (const locale of [undefined, "en_US", "fr-FR", 7]) {
        assert.equal(documentLocale(locale), "es-CL");
        assert.equal(buildMockReview({ text: TEXT, locale }).document.locale, "es-CL");
    }
});

test("an empty response has no text or comparison, and says why", () => {
    for (const text of ["", "   ", undefined]) {
        const { document, analysis } = buildMockReview({ text, locale: "en-US" });

        assert.deepEqual(sectionKinds(document), ["criteria", "bullets", UNKNOWN_SECTION_KIND]);
        assert.deepEqual(analysis, { wordCount: 0, characterCount: 0 });
        assert.equal(document.summary, "Your response has no text, so there is nothing to review.");
        assert.equal(document.sections[0].items[2].value, "Missing");
    }
});

test("long responses are cut to the schema's limits, by characters", () => {
    const text = "ñ".repeat(12000);
    const { document } = buildMockReview({ text, locale: "en-US" });
    const [, , , reversed, comparison] = document.sections;

    assert.equal(Array.from(reversed.text).length, 10000);
    assert.equal(document.sections[0].items[0].score, 1, "one word");
    for (const item of comparison.items) {
        assert.ok(Array.from(item.before).length <= 500);
        assert.ok(Array.from(item.after).length <= 500);
    }
});
