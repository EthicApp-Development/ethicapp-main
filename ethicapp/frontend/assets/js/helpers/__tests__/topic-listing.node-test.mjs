import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { describe, it } from "node:test";

import {
    CASE_ANALYSIS_COMPONENTS,
    resolveCaseAnalysisComponent,
} from "../case-analyses.js";
import {
    canAddTopic,
    canEditTopicListing,
    canRemoveTopic,
    createEmptyTopic,
    createTopicKeys,
    createTopicListingDraft,
    isTopicListingReviewed,
    moveDraftTopic,
    removeDraftTopic,
    TOPIC_LISTING_LIMITS,
    topicCountKey,
    topicListingDraftDocument,
    topicListingSaveError,
    topicListingTopics,
} from "../topic-listing.js";

const ASSETS = new URL("../../../", import.meta.url);

const LOCALES = Object.fromEntries(await Promise.all(["es_CL", "en_US"].map(async locale => [
    locale,
    JSON.parse(await fs.readFile(new URL(`locales/${locale}.json`, ASSETS), "utf8")),
])));

const DOCUMENT = Object.freeze({
    schemaVersion: "topic-listing/v1",
    language:      "es_CL",
    topics:        [
        { id: "T1", topic: "Veracidad del registro clínico", description: "Si Camila puede registrar lo que no vio." },
        { id: "T2", topic: "Presión jerárquica", description: "Cómo influye la evaluación final." },
        { id: "T3", topic: "Costos de denunciar", description: "Qué arriesga Camila." },
    ],
    generation: {
        llmTier:      "basic",
        prompt:       "topicListing/v1",
        promptDigest: "0123456789ab",
        generatedAt:  "2026-10-27T15:04:05Z",
    },
});

function draftOf(document = DOCUMENT) {
    return createTopicListingDraft(document, createTopicKeys("t"));
}

describe("topic listing helpers", () => {
    it("reads the topics of a listing, skipping anything else", () => {
        assert.deepEqual(topicListingTopics({ topics: [DOCUMENT.topics[0], null, "T9", { id: "T4" }] }), [
            DOCUMENT.topics[0],
            { id: "T4", topic: "", description: "" },
        ]);
        assert.deepEqual(topicListingTopics(null), []);
        assert.deepEqual(topicListingTopics({ topics: "T1" }), []);
    });

    it("counts topics with singular and plural keys", () => {
        assert.equal(topicCountKey(1), "case_topic_listing_count_one");
        assert.equal(topicCountKey(0), "case_topic_listing_count_other");
        assert.equal(topicCountKey(12), "case_topic_listing_count_other");
    });

    it("is reviewed once saved, and editable only with a document and no generation in flight", () => {
        assert.equal(isTopicListingReviewed({ reviewedAt: "2026-10-27T16:00:00Z" }), true);
        assert.equal(isTopicListingReviewed({ reviewedAt: null }), false);

        assert.equal(canEditTopicListing({ status: "ready", document: DOCUMENT }), true);
        assert.equal(canEditTopicListing({ status: "ready", document: null }), false);
        assert.equal(canEditTopicListing({ status: "processing", stale: false, document: DOCUMENT }), false);
        // A stale generation no longer blocks edits.
        assert.equal(canEditTopicListing({ status: "processing", stale: true, document: DOCUMENT }), true);
    });

    it("drafts a copy that shares nothing with the document, with a key per topic", () => {
        const draft = draftOf();

        assert.equal(draft.language, "es_CL");
        assert.deepEqual(draft.topics.map(topic => topic.key), ["t-1", "t-2", "t-3"]);
        draft.topics[0].topic = "Changed";
        assert.equal(DOCUMENT.topics[0].topic, "Veracidad del registro clínico");
    });

    it("adds topics up to the limit and keeps at least one", () => {
        const nextKey = createTopicKeys("n");
        const full = { topics: Array.from({ length: TOPIC_LISTING_LIMITS.maxTopics }, () => createEmptyTopic(nextKey)) };

        assert.deepEqual(createEmptyTopic(createTopicKeys("x")), { key: "x-1", id: "", topic: "", description: "" });
        assert.equal(canAddTopic(draftOf()), true);
        assert.equal(canAddTopic(full), false);
        assert.equal(canRemoveTopic(draftOf()), true);

        const single = draftOf({ topics: [DOCUMENT.topics[0]] });
        assert.equal(canRemoveTopic(single), false);
        assert.equal(removeDraftTopic(single, 0), single);
    });

    it("moves and removes topics, keeping their ids", () => {
        const draft = draftOf();

        const moved = moveDraftTopic(draft, 2, -1);
        assert.deepEqual(moved.topics.map(topic => topic.id), ["T1", "T3", "T2"]);
        assert.equal(moveDraftTopic(draft, 0, -1), draft);
        assert.equal(moveDraftTopic(draft, 2, 1), draft);

        const removed = removeDraftTopic(moved, 0);
        assert.deepEqual(removed.topics.map(topic => topic.id), ["T3", "T2"]);
        assert.equal(draft.topics.length, 3);
    });

    it("saves the topics in order, new ones without an id and without local keys", () => {
        const draft = draftOf();
        draft.topics.push({ ...createEmptyTopic(createTopicKeys("new")), topic: "Lealtad", description: "Si le debe lealtad." });
        const reordered = moveDraftTopic(draft, 3, -3);

        assert.deepEqual(topicListingDraftDocument(reordered), {
            schemaVersion: "topic-listing/v1",
            language:      "es_CL",
            topics:        [
                { topic: "Lealtad", description: "Si le debe lealtad." },
                ...DOCUMENT.topics,
            ],
        });
        // The server keeps the stored generation.
        assert.equal(Object.hasOwn(topicListingDraftDocument(reordered), "generation"), false);
        assert.equal(Object.hasOwn(topicListingDraftDocument({ topics: [] }), "language"), false);
    });

    it("explains failed saves, with the server's problems for an invalid listing", () => {
        assert.deepEqual(topicListingSaveError({
            status: 400,
            data:   { details: ["Topic 2: the id T1 is already used by topic 1.", 3] },
        }), {
            messageKey: "case_topic_listing_error_invalid",
            details:    ["Topic 2: the id T1 is already used by topic 1."],
        });
        assert.equal(topicListingSaveError({ status: 405 }).messageKey, "case_topic_listing_error_not_editable");
        assert.equal(topicListingSaveError({ status: 409 }).messageKey, "case_topic_listing_error_processing");
        assert.deepEqual(topicListingSaveError(new Error("offline")), {
            messageKey: "case_topic_listing_error_generic",
            details:    [],
        });
    });
});

describe("topic listing registration and texts", () => {
    it("compiles the topic listing view for its manifest component", () => {
        assert.equal(CASE_ANALYSIS_COMPONENTS["case-topic-listing"], "case-topic-listing-view");
        assert.equal(resolveCaseAnalysisComponent("case-topic-listing"), "case-topic-listing-view");
    });

    it("every key the tab uses exists in both locales", async () => {
        const sources = await Promise.all([
            "static/views/teacher/fragments/case-topic-listing-view.template.html",
            "js/components/case-topic-listing-view.component.js",
            "js/helpers/topic-listing.js",
        ].map(path => fs.readFile(new URL(path, ASSETS), "utf8")));
        const keys = new Set(sources.join("\n").match(/case_topic_listing_[a-z_]+/g));
        keys.add("edit");
        keys.add("cancel");

        assert.ok(keys.size > 25);
        for (const [locale, catalog] of Object.entries(LOCALES)) {
            for (const key of keys) {
                assert.ok(catalog[key], `${locale} lacks ${key}`);
            }
        }
    });
});
