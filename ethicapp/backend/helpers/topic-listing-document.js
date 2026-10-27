// The topic listing document (`topic-listing/v1`, #845, epic #647): the
// topics participants must address when they discuss a case, as Case Analyst
// drafts them and the teacher edits them in the case view.
//
// The contract lives in ethicapp-ai-additions,
// case-analyst/app/modules/topic_listing/schemas/topic-listing.v1.schema.json:
//
//     { schemaVersion: "topic-listing/v1", language: "es_CL" | "en_US",
//       topics: [{ id: "T#", topic, description }] (1 to 20),
//       generation?: { llmTier, prompt, promptDigest, generatedAt } }
//
// No extra keys anywhere. Topic ids must also be unique, which JSON Schema
// cannot express, so checkTopicListingDocument() checks it with the rest.
//
// Teacher edits (normalizeTopicListingEdit) keep the ids of the topics they
// keep, in any order; topics added in the edit get the next free number. A
// listing is never renumbered T1..Tn on save, so an id names the same topic
// for as long as the topic exists.

export const TOPIC_LISTING_SCHEMA = "topic-listing/v1";

export const TOPIC_LISTING_LIMITS = Object.freeze({
    minTopics:            1,
    maxTopics:            20,
    maxIdLength:          6,
    maxTopicLength:       160,
    maxDescriptionLength: 600,
});

const LANGUAGES = Object.freeze(["es_CL", "en_US"]);
const TOP_LEVEL_KEYS = Object.freeze(["schemaVersion", "language", "topics", "generation"]);
const TOPIC_KEYS = Object.freeze(["id", "topic", "description"]);
const GENERATION_KEYS = Object.freeze(["llmTier", "prompt", "promptDigest", "generatedAt"]);

const TOPIC_ID_PATTERN = /^T[1-9][0-9]*$/u;
const LLM_TIERS = Object.freeze(["basic", "advanced"]);
const PROMPT_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*\/v[0-9]+$/u;
const PROMPT_DIGEST_PATTERN = /^[0-9a-f]{12}$/u;
const GENERATED_AT_PATTERN = new RegExp(
    "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}"
    + "(\\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$",
    "u"
);
const MAX_PROMPT_LENGTH = 100;

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isTopicId(value) {
    return typeof value === "string"
        && value.length <= TOPIC_LISTING_LIMITS.maxIdLength
        && TOPIC_ID_PATTERN.test(value);
}

function topicNumber(id) {
    return Number(id.slice(1));
}

function extraKeys(object, allowed) {
    return Object.keys(object).filter(key => !allowed.includes(key));
}

function checkText(value, maxLength, label, errors) {
    if (typeof value !== "string") {
        errors.push(`${label} must be a string.`);
    } else if (!value.trim()) {
        errors.push(`${label} must not be blank.`);
    } else if (value.length > maxLength) {
        errors.push(`${label} must be at most ${maxLength} characters long.`);
    }
}

// The problems of a `generation` object; empty when it follows the schema.
function generationErrors(generation) {
    if (!isPlainObject(generation)) {
        return ["generation must be an object."];
    }

    const errors = extraKeys(generation, GENERATION_KEYS)
        .map(key => `generation has an unknown key: ${key}.`);
    if (!LLM_TIERS.includes(generation.llmTier)) {
        errors.push(`generation.llmTier must be one of ${LLM_TIERS.join(", ")}.`);
    }
    if (typeof generation.prompt !== "string"
        || generation.prompt.length > MAX_PROMPT_LENGTH
        || !PROMPT_PATTERN.test(generation.prompt)) {
        errors.push("generation.prompt must be a versioned prompt reference.");
    }
    if (typeof generation.promptDigest !== "string"
        || !PROMPT_DIGEST_PATTERN.test(generation.promptDigest)) {
        errors.push("generation.promptDigest must be 12 hexadecimal characters.");
    }
    if (typeof generation.generatedAt !== "string"
        || !GENERATED_AT_PATTERN.test(generation.generatedAt)
        || Number.isNaN(Date.parse(generation.generatedAt))) {
        errors.push("generation.generatedAt must be an RFC 3339 date-time.");
    }
    return errors;
}

function checkTopicCount(topics, errors) {
    if (topics.length < TOPIC_LISTING_LIMITS.minTopics) {
        errors.push("The listing must have at least one topic.");
    } else if (topics.length > TOPIC_LISTING_LIMITS.maxTopics) {
        errors.push(`The listing can have at most ${TOPIC_LISTING_LIMITS.maxTopics} topics.`);
    }
}

function duplicateIdErrors(ids) {
    const positions = new Map();
    const errors = [];

    ids.forEach((id, index) => {
        if (!id) {
            return;
        }
        if (positions.has(id)) {
            const first = positions.get(id) + 1;
            errors.push(`Topic ${index + 1}: the id ${id} is already used by topic ${first}.`);
            return;
        }
        positions.set(id, index);
    });

    return errors;
}

/**
 * The problems of a `topic-listing/v1` document, as the schema and the
 * unique ids require; empty when the document is valid. Case Analyst checks
 * its results the same way before it sends them.
 */
export function checkTopicListingDocument(document) {
    if (!isPlainObject(document)) {
        return ["The topic listing must be an object."];
    }

    const errors = extraKeys(document, TOP_LEVEL_KEYS)
        .map(key => `The topic listing has an unknown key: ${key}.`);

    if (document.schemaVersion !== TOPIC_LISTING_SCHEMA) {
        errors.push(`schemaVersion must be ${TOPIC_LISTING_SCHEMA}.`);
    }
    if (!LANGUAGES.includes(document.language)) {
        errors.push(`language must be one of ${LANGUAGES.join(", ")}.`);
    }
    if (document.generation !== undefined) {
        errors.push(...generationErrors(document.generation));
    }

    if (!Array.isArray(document.topics)) {
        errors.push("topics must be a list.");
        return errors;
    }

    checkTopicCount(document.topics, errors);
    document.topics.forEach((topic, index) => {
        const label = `Topic ${index + 1}`;
        if (!isPlainObject(topic)) {
            errors.push(`${label} must be an object.`);
            return;
        }
        errors.push(...extraKeys(topic, TOPIC_KEYS)
            .map(key => `${label} has an unknown key: ${key}.`));
        if (!isTopicId(topic.id)) {
            errors.push(`${label}: the id must look like T1, T2...`);
        }
        checkText(topic.topic, TOPIC_LISTING_LIMITS.maxTopicLength, `${label}: the topic`, errors);
        checkText(topic.description, TOPIC_LISTING_LIMITS.maxDescriptionLength,
            `${label}: the description`, errors);
    });
    errors.push(...duplicateIdErrors(document.topics.map(topic => topic?.id)));

    return errors;
}

/**
 * The language of an edited listing: the one it carries, or the stored
 * listing's, or the case language by the canonical rule (`es_*` is `es_CL`,
 * anything else `en_US`; a case without one is `es_CL`, the column default).
 */
function editLanguage(document, currentDocument, languageCode) {
    if (document.language !== undefined) {
        return document.language;
    }
    if (LANGUAGES.includes(currentDocument?.language)) {
        return currentDocument.language;
    }
    const code = String(languageCode ?? "").trim();
    return !code || /^es(?:[-_]|$)/iu.test(code) ? "es_CL" : "en_US";
}

// A topic of an edit, trimmed and reduced to its three keys. A missing or
// blank id marks a topic added in the edit.
function editedTopic(topic) {
    const text = value => (typeof value === "string" ? value.trim() : value);
    const id = text(topic.id);

    return {
        id:          id === undefined || id === null || id === "" ? null : id,
        topic:       text(topic.topic),
        description: text(topic.description),
    };
}

function editedTopicErrors(topics) {
    const errors = [];

    topics.forEach((topic, index) => {
        const label = `Topic ${index + 1}`;
        if (topic.id !== null && !isTopicId(topic.id)) {
            errors.push(`${label}: the id must look like T1, T2...`);
        }
        checkText(topic.topic, TOPIC_LISTING_LIMITS.maxTopicLength, `${label}: the topic`, errors);
        checkText(topic.description, TOPIC_LISTING_LIMITS.maxDescriptionLength,
            `${label}: the description`, errors);
    });
    errors.push(...duplicateIdErrors(topics.map(topic => topic.id)));

    return errors;
}

// Ids for the topics added in an edit: the numbers after the highest id of
// the edit and of the stored listing, so a topic removed in the same edit
// does not lend its id to a new one. When those numbers would not fit in an
// id, the lowest free numbers are used instead.
function assignNewIds(topics, currentDocument) {
    const storedIds = Array.isArray(currentDocument?.topics)
        ? currentDocument.topics.map(topic => topic?.id).filter(isTopicId)
        : [];
    const used = new Set([...storedIds, ...topics.map(topic => topic.id).filter(Boolean)]);
    let next = Math.max(0, ...[...used].map(topicNumber)) + 1;
    let lowest = 1;

    return topics.map((topic) => {
        if (topic.id !== null) {
            return topic;
        }

        let id = `T${next}`;
        if (id.length <= TOPIC_LISTING_LIMITS.maxIdLength) {
            next += 1;
        } else {
            while (used.has(`T${lowest}`)) {
                lowest += 1;
            }
            id = `T${lowest}`;
        }
        used.add(id);
        return { ...topic, id };
    });
}

/**
 * A teacher's edit of a topic listing, ready to store, or the reasons it
 * cannot be stored.
 *
 * - Topics are trimmed and keep only `id`, `topic` and `description`; other
 *   keys of a topic (for example AngularJS's `$$hashKey`) are dropped.
 * - Ids are kept as sent, in the order sent. Topics without an id are new
 *   and get the next free number (see assignNewIds).
 * - `generation` describes the generated draft, so it comes from the stored
 *   listing (`currentDocument`), never from the edit; a stored listing
 *   without one gives a listing without one.
 *
 * Returns `{ document }` or `{ errors }`.
 */
export function normalizeTopicListingEdit(document, {
    currentDocument = null,
    languageCode = null,
} = {}) {
    if (!isPlainObject(document)) {
        return { errors: ["The topic listing must be an object."] };
    }

    const errors = [];
    if (document.schemaVersion !== undefined && document.schemaVersion !== TOPIC_LISTING_SCHEMA) {
        errors.push(`schemaVersion must be ${TOPIC_LISTING_SCHEMA}.`);
    }

    const language = editLanguage(document, currentDocument, languageCode);
    if (!LANGUAGES.includes(language)) {
        errors.push(`language must be one of ${LANGUAGES.join(", ")}.`);
    }

    if (!Array.isArray(document.topics)) {
        errors.push("topics must be a list.");
        return { errors };
    }

    checkTopicCount(document.topics, errors);
    const invalidTopic = document.topics.findIndex(topic => !isPlainObject(topic));
    if (invalidTopic >= 0) {
        errors.push(`Topic ${invalidTopic + 1} must be an object.`);
        return { errors };
    }

    const topics = document.topics.map(editedTopic);
    errors.push(...editedTopicErrors(topics));
    if (errors.length > 0) {
        return { errors };
    }

    const normalized = {
        schemaVersion: TOPIC_LISTING_SCHEMA,
        language,
        topics:        assignNewIds(topics, currentDocument),
    };
    const generation = currentDocument?.generation;
    if (generation !== undefined && generationErrors(generation).length === 0) {
        normalized.generation = structuredClone(generation);
    }

    // The stored listing must be one Case Analyst would accept as well.
    const problems = checkTopicListingDocument(normalized);
    return problems.length > 0 ? { errors: problems } : { document: normalized };
}
