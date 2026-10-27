// Pure helpers for the topic listing tab (#845): the review panel of the
// `case-analyst-topic-listing` analysis, whose document follows
// topic-listing/v1 (`topics: [{ id: "T#", topic, description }]`, 1 to 20).
//
// The server keeps the ids of the topics an edit keeps and numbers the new
// ones (backend helpers/topic-listing-document.js), so a draft sends new
// topics without an id.

import { isCaseAnalysisInFlight } from "./case-analyses.js";
import { moveListItem, removeListItem } from "./ordered-list.js";

export const TOPIC_LISTING_SCHEMA = "topic-listing/v1";

// The limits of topic-listing/v1, mirrored by the edit form.
export const TOPIC_LISTING_LIMITS = Object.freeze({
    maxTopics:            20,
    maxTopicLength:       160,
    maxDescriptionLength: 600,
});

const SAVE_ERROR_KEYS = Object.freeze({
    400: "case_topic_listing_error_invalid",
    405: "case_topic_listing_error_not_editable",
    409: "case_topic_listing_error_processing",
});

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function textOf(value) {
    return typeof value === "string" ? value : "";
}

// The topics of a listing to read, skipping anything that is not a topic.
export function topicListingTopics(document) {
    const topics = Array.isArray(document?.topics) ? document.topics : [];
    return topics.filter(isPlainObject).map(topic => ({
        id:          textOf(topic.id),
        topic:       textOf(topic.topic),
        description: textOf(topic.description),
    }));
}

// The translation key of the topic count.
export function topicCountKey(count) {
    return count === 1 ? "case_topic_listing_count_one" : "case_topic_listing_count_other";
}

// Saving an edit records `reviewedAt`; a new generation clears it.
export function isTopicListingReviewed(analysis) {
    return Boolean(analysis?.reviewedAt);
}

// Edits are refused while a fresh generation is in flight (409).
export function canEditTopicListing(analysis) {
    return Boolean(analysis?.document) && !isCaseAnalysisInFlight(analysis);
}

/**
 * Creates the keys that tell the draft's topics apart while they are edited:
 * new topics have no id until the server gives them one.
 */
export function createTopicKeys(prefix = "topic") {
    let next = 0;
    return () => {
        next += 1;
        return `${prefix}-${next}`;
    };
}

export function createEmptyTopic(nextKey) {
    return { key: nextKey(), id: "", topic: "", description: "" };
}

/**
 * An editable copy of a listing that shares nothing with it: its language
 * and its topics, each with a local `key`.
 */
export function createTopicListingDraft(document, nextKey) {
    return {
        language: typeof document?.language === "string" ? document.language : null,
        topics:   topicListingTopics(document).map(topic => ({ key: nextKey(), ...topic })),
    };
}

export function canAddTopic(draft) {
    return (draft?.topics?.length ?? 0) < TOPIC_LISTING_LIMITS.maxTopics;
}

// A listing keeps at least one topic.
export function canRemoveTopic(draft) {
    return (draft?.topics?.length ?? 0) > 1;
}

// The draft with the topic at `index` moved by `offset` places, when possible.
export function moveDraftTopic(draft, index, offset) {
    const topics = moveListItem(draft.topics, index, offset);
    return topics === draft.topics ? draft : { ...draft, topics };
}

export function removeDraftTopic(draft, index) {
    if (!canRemoveTopic(draft)) {
        return draft;
    }
    const topics = removeListItem(draft.topics, index);
    return topics === draft.topics ? draft : { ...draft, topics };
}

/**
 * The document a draft saves: topics in their order, without local keys,
 * new ones without an id. The server trims the texts and keeps the stored
 * listing's `generation`.
 */
export function topicListingDraftDocument(draft) {
    const document = {
        schemaVersion: TOPIC_LISTING_SCHEMA,
        topics:        (draft?.topics ?? []).map((topic) => {
            const saved = { topic: textOf(topic.topic), description: textOf(topic.description) };
            return topic.id ? { id: topic.id, ...saved } : saved;
        }),
    };
    if (draft?.language) {
        document.language = draft.language;
    }
    return document;
}

/**
 * What to tell the teacher when a save fails: a translation key and, for an
 * invalid listing (400), the server's list of problems.
 */
export function topicListingSaveError(error) {
    const status = Number(error?.status);
    const details = status === 400 && Array.isArray(error?.data?.details)
        ? error.data.details.filter(detail => typeof detail === "string")
        : [];

    return {
        messageKey: SAVE_ERROR_KEYS[status] || "case_topic_listing_error_generic",
        details,
    };
}
