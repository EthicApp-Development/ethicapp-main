import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import {
    checkTopicListingDocument,
    normalizeTopicListingEdit,
    TOPIC_LISTING_LIMITS,
} from "../topic-listing-document.js";

// Case Analyst's published example (topic_listing/examples/result.completed.json).
const EXAMPLE = JSON.parse(await fs.readFile(
    new URL("../../external-services/adapters/__tests__/fixtures/topic-listing-result-completed.json",
        import.meta.url),
    "utf8"
)).topicListing;

function topic(id, name = `Topic ${id}`) {
    return { id, topic: name, description: `About ${name}.` };
}

function listing(topics, extra = {}) {
    return { schemaVersion: "topic-listing/v1", language: "en_US", topics, ...extra };
}

// ─── checkTopicListingDocument ───────────────────────────────────────────────

test("checkTopicListingDocument: accepts the published example and a listing without generation", () => {
    assert.deepEqual(checkTopicListingDocument(EXAMPLE), []);
    assert.deepEqual(checkTopicListingDocument(listing([topic("T7"), topic("T2")])), []);
});

test("checkTopicListingDocument: follows the schema, plus unique ids", () => {
    assert.deepEqual(checkTopicListingDocument([]), ["The topic listing must be an object."]);
    assert.deepEqual(
        checkTopicListingDocument({ ...listing([topic("T1")]), schemaVersion: "topic-listing/v2", notes: "x" }),
        ["The topic listing has an unknown key: notes.", "schemaVersion must be topic-listing/v1."]
    );
    assert.deepEqual(checkTopicListingDocument(listing("T1")), ["topics must be a list."]);
    assert.deepEqual(
        checkTopicListingDocument(listing([
            { ...topic("T1"), extra: true },
            topic("T01"),
            topic("T1234567"),
            { id: "T4", topic: "", description: "d" },
            { id: "T5", topic: "t", description: "d".repeat(601) },
            topic("T1"),
        ])),
        [
            "Topic 1 has an unknown key: extra.",
            "Topic 2: the id must look like T1, T2...",
            "Topic 3: the id must look like T1, T2...",
            "Topic 4: the topic must not be blank.",
            "Topic 5: the description must be at most 600 characters long.",
            "Topic 6: the id T1 is already used by topic 1.",
        ]
    );
});

test("checkTopicListingDocument: a malformed generation is reported", () => {
    const generation = { ...EXAMPLE.generation, llmTier: "huge", promptDigest: "XYZ", seed: 1 };

    assert.deepEqual(checkTopicListingDocument({ ...EXAMPLE, generation }), [
        "generation has an unknown key: seed.",
        "generation.llmTier must be one of basic, advanced.",
        "generation.promptDigest must be 12 hexadecimal characters.",
    ]);
});

test("checkTopicListingDocument: 1 to 20 topics", () => {
    const topics = count => Array.from({ length: count }, (_item, index) => topic(`T${index + 1}`));

    assert.equal(TOPIC_LISTING_LIMITS.maxTopics, 20);
    assert.deepEqual(checkTopicListingDocument(listing(topics(20))), []);
    assert.deepEqual(checkTopicListingDocument(listing(topics(21))), ["The listing can have at most 20 topics."]);
    assert.deepEqual(checkTopicListingDocument(listing([])), ["The listing must have at least one topic."]);
});

// ─── normalizeTopicListingEdit ───────────────────────────────────────────────

test("normalizeTopicListingEdit: a reordered listing keeps its ids, in the new order", () => {
    const reordered = [...EXAMPLE.topics].reverse();

    const { document } = normalizeTopicListingEdit({ topics: reordered }, { currentDocument: EXAMPLE });

    assert.deepEqual(document.topics.map(item => item.id), ["T4", "T3", "T2", "T1"]);
    assert.equal(document.language, "es_CL");
    assert.deepEqual(document.generation, EXAMPLE.generation);
    assert.notEqual(document.generation, EXAMPLE.generation);
});

test("normalizeTopicListingEdit: new topics are numbered after the highest id ever in the listing", () => {
    const { document } = normalizeTopicListingEdit({
        topics: [
            { topic: "New first", description: "Added at the top." },
            topic("T2"),
            { id: null, topic: "New last", description: "Added at the end." },
        ],
    }, { currentDocument: EXAMPLE });

    // T4 was removed in the same edit, so the new topics are T5 and T6.
    assert.deepEqual(document.topics.map(item => item.id), ["T5", "T2", "T6"]);
});

test("normalizeTopicListingEdit: ids that would not fit take the lowest free numbers", () => {
    const { document } = normalizeTopicListingEdit({
        topics: [topic("T99999"), topic("T1"), { topic: "New", description: "Added." }],
    }, { currentDocument: null });

    assert.deepEqual(document.topics.map(item => item.id), ["T99999", "T1", "T2"]);
});

test("normalizeTopicListingEdit: texts are trimmed and other keys dropped", () => {
    const { document } = normalizeTopicListingEdit({
        schemaVersion: "topic-listing/v1",
        language:      "en_US",
        topics:        [{ id: " T1 ", topic: "  Name\n", description: "\tWhy.  ", $$hashKey: "object:3", key: 9 }],
        notes:         "ignored",
    });

    assert.deepEqual(document, {
        schemaVersion: "topic-listing/v1",
        language:      "en_US",
        topics:        [{ id: "T1", topic: "Name", description: "Why." }],
    });
});

test("normalizeTopicListingEdit: the language comes from the edit, the stored listing or the case", () => {
    const topics = [topic("T1")];

    assert.equal(normalizeTopicListingEdit({ language: "en_US", topics }, { currentDocument: EXAMPLE })
        .document.language, "en_US");
    assert.equal(normalizeTopicListingEdit({ topics }, { currentDocument: EXAMPLE }).document.language, "es_CL");
    assert.equal(normalizeTopicListingEdit({ topics }, { languageCode: "en" }).document.language, "en_US");
    assert.equal(normalizeTopicListingEdit({ topics }, { languageCode: "es-AR" }).document.language, "es_CL");
    assert.equal(normalizeTopicListingEdit({ topics }, {}).document.language, "es_CL");
});

test("normalizeTopicListingEdit: the generation comes only from a valid stored listing", () => {
    const forged = { llmTier: "basic", prompt: "topicListing/v1", promptDigest: "aaaaaaaaaaaa", generatedAt: "2026-01-01T00:00:00Z" };
    const topics = [topic("T1")];

    assert.equal(
        Object.hasOwn(normalizeTopicListingEdit({ topics, generation: forged }, {}).document, "generation"),
        false
    );
    assert.equal(
        Object.hasOwn(normalizeTopicListingEdit({ topics }, {
            currentDocument: { ...EXAMPLE, generation: { llmTier: "basic" } },
        }).document, "generation"),
        false
    );
});

test("normalizeTopicListingEdit: invalid edits return every problem and no document", () => {
    const result = normalizeTopicListingEdit({
        schemaVersion: "topic-listing/v9",
        topics:        [
            { id: "T1", topic: "", description: "d" },
            { id: "T1", topic: "t", description: 42 },
            { id: "Q", topic: "t", description: "d" },
        ],
    });

    assert.deepEqual(result, {
        errors: [
            "schemaVersion must be topic-listing/v1.",
            "Topic 1: the topic must not be blank.",
            "Topic 2: the description must be a string.",
            "Topic 3: the id must look like T1, T2...",
            "Topic 2: the id T1 is already used by topic 1.",
        ],
    });
    assert.deepEqual(normalizeTopicListingEdit({ topics: [null] }), { errors: ["Topic 1 must be an object."] });
    assert.deepEqual(normalizeTopicListingEdit({}), { errors: ["topics must be a list."] });
    assert.deepEqual(normalizeTopicListingEdit("T1"), { errors: ["The topic listing must be an object."] });
});
