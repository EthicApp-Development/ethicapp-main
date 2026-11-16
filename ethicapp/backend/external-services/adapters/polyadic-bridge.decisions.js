// The mediation decisions of Polyadic rooms (#1222, epic
// ethicapp-ai-additions#293): the `mediation-decision/v1` records a
// `contentCoverage` room's callback carries in `decisions`, one per
// Validator evaluation, `no_intervention` included.
//
// - The callback handler validates each record against EthicApp's copy of
//   the schema and stores the valid ones, each once by `decisionId`, tied to
//   the room's session, phase, question and group, the room job and the
//   callback's result. An invalid record is logged by its index, its
//   `decisionId` and its problem codes and paths, never its text, and
//   skipped; the rest of the callback is processed as before.
// - The chat transcript exports them: one row per decision at its
//   `decidedAt`, and one row per room with the topic list the room was
//   created with. A session without stored decisions keeps its transcript
//   exactly as before.

import { getCaseAnalysis as defaultGetCaseAnalysis } from "../../helpers/case-analyses-helper.js";
import { resolveJsonPointer } from "../../helpers/case-session-inputs.js";
import { normalizeExternalAgentAuthorName } from "../../helpers/external-agent-author.js";
import { describeError } from "../../helpers/log-safety.js";
import {
    loggableDecisionId,
    validateMediationDecision as defaultValidateDecision,
} from "../../services/mediation-decision-records.js";
import {
    MAX_CONTRIBUTION_STRING_LENGTH,
} from "../../services/external-service-report-contributions.js";
import { DISCUSSION_TOPICS_INPUT } from "./polyadic-bridge.case-inputs.js";

// What happened to the records of one callback, when they could not all be
// stored.
export const DECISION_STORAGE = Object.freeze({
    // The registry gave the adapter no store (an older registry, a test).
    UNAVAILABLE: "unavailable",
    // The store rejected; the error is logged without values.
    FAILED:      "failed",
});

// The transcript columns of the decisions, under the bridge's `polyadic_`
// prefix. Documented in EXTERNAL.md, "Polyadic mediation decisions".
export const DECISION_REPORT_COLUMNS = Object.freeze({
    ROW_KIND:                         "polyadic_row_kind",
    DECISION_ID:                      "polyadic_decision_id",
    PIPELINE_TYPE:                    "polyadic_decision_pipeline_type",
    DECISION:                         "polyadic_decision",
    CATEGORY:                         "polyadic_decision_category",
    TOPIC_ID:                         "polyadic_decision_topic_id",
    TOPIC_NAME:                       "polyadic_decision_topic_name",
    REASON:                           "polyadic_decision_reason",
    TRIGGER_KIND:                     "polyadic_decision_trigger_kind",
    TRIGGER_REASON:                   "polyadic_decision_trigger_reason",
    WINDOW_MESSAGE_IDS:               "polyadic_decision_window_message_ids",
    WINDOW_POLYADIC_MESSAGE_IDS:      "polyadic_decision_window_polyadic_message_ids",
    INTERVENTION_STATUS:              "polyadic_decision_intervention_status",
    INTERVENTION_AGENT:               "polyadic_decision_intervention_agent",
    INTERVENTION_MESSAGE_ID:          "polyadic_decision_intervention_message_id",
    INTERVENTION_POLYADIC_MESSAGE_ID: "polyadic_decision_intervention_polyadic_message_id",
    INTERVENTION_SUPPRESSED_BY:       "polyadic_decision_intervention_suppressed_by",
    DECIDED_AT:                       "polyadic_decision_decided_at",
    ROOM_TOPICS:                      "polyadic_room_topics",
    ROOM_TOPICS_STATUS:               "polyadic_room_topics_status",
});

const C = DECISION_REPORT_COLUMNS;

export const DECISION_REPORT_COLUMN_DECLARATIONS = Object.freeze([
    { id: C.ROW_KIND,                         label: "Polyadic row kind" },
    { id: C.DECISION_ID,                      label: "Decision id" },
    { id: C.PIPELINE_TYPE,                    label: "Discussion mode" },
    { id: C.DECISION,                         label: "Decision" },
    { id: C.CATEGORY,                         label: "Decision category" },
    { id: C.TOPIC_ID,                         label: "Topic id" },
    { id: C.TOPIC_NAME,                       label: "Topic" },
    { id: C.REASON,                           label: "Decision reason" },
    { id: C.TRIGGER_KIND,                     label: "Evaluation trigger" },
    { id: C.TRIGGER_REASON,                   label: "Evaluation trigger reason" },
    { id: C.WINDOW_MESSAGE_IDS,               label: "Evaluated messages" },
    { id: C.WINDOW_POLYADIC_MESSAGE_IDS,      label: "Evaluated messages (Polyadic ids)" },
    { id: C.INTERVENTION_STATUS,              label: "Intervention" },
    { id: C.INTERVENTION_AGENT,               label: "Intervening agent" },
    { id: C.INTERVENTION_MESSAGE_ID,          label: "Intervention message" },
    { id: C.INTERVENTION_POLYADIC_MESSAGE_ID, label: "Intervention message (Polyadic id)" },
    { id: C.INTERVENTION_SUPPRESSED_BY,       label: "Intervention suppressed by" },
    { id: C.DECIDED_AT,                       label: "Decided at" },
    { id: C.ROOM_TOPICS,                      label: "Room topics" },
    { id: C.ROOM_TOPICS_STATUS,               label: "Room topics status" },
]);

export const REPORT_ROW_KIND = Object.freeze({
    DECISION:    "decision",
    ROOM_TOPICS: "room_topics",
});

// Whether the topic names of a room row are the ones the room received.
export const ROOM_TOPICS_STATUS = Object.freeze({
    // The case's listing is still the version the room was created with.
    AS_SENT:             "as_sent",
    // The listing was regenerated or edited since: only the ids are given.
    LISTING_CHANGED:     "listing_changed",
    // The listing is gone or could not be read: only the ids are given.
    LISTING_UNAVAILABLE: "listing_unavailable",
});

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function positiveIdOf(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function textOrNull(value) {
    return typeof value === "string" && value.trim() !== ""
        ? value.slice(0, MAX_CONTRIBUTION_STRING_LENGTH)
        : null;
}

/**
 * A decision id another record refers to, such as a callback evaluation's
 * `trigger.decision_id` (#1226): the value when it is the UUID a record's
 * `decisionId` must be, else null.
 */
export function decisionIdOf(value) {
    return loggableDecisionId({ decisionId: value });
}

function isoTimeOf(value) {
    if (value === null || value === undefined) {
        return null;
    }
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

// ─── Storing ─────────────────────────────────────────────────────────────────

/**
 * EthicApp's id of the chat message the speaking agent posted for an
 * intervention: the message the same callback published for that agent, when
 * it published exactly one. Null otherwise.
 *
 * @param {Object} record - A valid record.
 * @param {Array<{ message: Object, agentName: string }>} savedMessages - The
 *     messages the callback handler published.
 */
export function interventionChatMessageIdOf(record, savedMessages) {
    const intervention = record?.intervention;
    if (intervention?.status !== "intervened" || typeof intervention.agent !== "string") {
        return null;
    }
    const matches = savedMessages.filter(saved => saved.agentName === intervention.agent);
    return matches.length === 1 ? positiveIdOf(matches[0].message?.id) : null;
}

/**
 * Validates and stores the `decisions` of one callback.
 *
 * @param {Object} args
 * @param {unknown[]} args.decisions - The callback's `decisions`.
 * @param {string} args.room - The room name, for the logs.
 * @param {{ sessionId, phaseId, questionId, groupId }} args.placement
 * @param {string|null} args.jobId - The job the callback correlated with.
 * @param {string|null} args.resultId - The callback's result.
 * @param {Array<Object>} args.savedMessages - What the handler published.
 * @param {{ record: Function }|null} args.store - The registry's
 *     `mediationDecisions` access.
 * @returns {Promise<{ received: number, stored: string[], duplicates: string[],
 *     invalid: Object[], storage?: string }>} The outcome, for the callback's
 *     adapter result: ids, indexes and problem codes only.
 */
export async function storeCallbackDecisions({
    decisions,
    room,
    placement,
    jobId = null,
    resultId = null,
    savedMessages = [],
    store,
    validate = defaultValidateDecision,
    logger = console,
}) {
    const outcome = { received: decisions.length, stored: [], duplicates: [], invalid: [] };
    const valid = [];
    decisions.forEach((record, index) => {
        const { valid: isValid, problems } = validate(record);
        if (isValid) {
            const interventionChatMessageId = interventionChatMessageIdOf(record, savedMessages);
            valid.push({ record, interventionChatMessageId });
            return;
        }
        const entry = {
            index,
            decisionId: loggableDecisionId(record),
            problems:   problems.map(({ code, path, keyword }) => ({
                code, path, ...(keyword ? { keyword } : {}),
            })),
        };
        outcome.invalid.push(entry);
        logger.warn("[polyadic-bridge] Skipped an invalid mediation decision.",
            JSON.stringify({ room, ...entry }));
    });

    if (valid.length === 0) {
        return outcome;
    }
    if (!store || typeof store.record !== "function") {
        return { ...outcome, storage: DECISION_STORAGE.UNAVAILABLE };
    }

    try {
        const { stored, duplicates } = await store.record({
            ...placement,
            jobId,
            resultId,
            decisions: valid,
        });
        return { ...outcome, stored: [...stored], duplicates: [...duplicates] };
    } catch (error) {
        logger.error("[polyadic-bridge] Could not store the mediation decisions of a callback.",
            JSON.stringify({
                room,
                decisionIds: valid.map(({ record }) => record.decisionId),
                ...describeError(error),
            }));
        return { ...outcome, storage: DECISION_STORAGE.FAILED };
    }
}

// ─── Topic lists of the rooms ───────────────────────────────────────────────

// The `discussion_topics` record of a room job (#1221): its
// `instantiation_report.caseInputs` entry, with the analysis it came from and
// the ids sent.
function discussionTopicsRecordOf(job) {
    const caseInputs = job?.instantiationReport?.caseInputs;
    if (!Array.isArray(caseInputs)) {
        return null;
    }
    const record = caseInputs.find(entry => entry?.key === DISCUSSION_TOPICS_INPUT);
    return record && Array.isArray(record.ids) ? record : null;
}

// Whether a case_analyses row is still the version a record says was sent.
function isSentVersion(row, record) {
    return (row.job_id ?? null) === (record.jobId ?? null)
        && isoTimeOf(row.generated_at) === (record.generatedAt ?? null)
        && isoTimeOf(row.reviewed_at) === (record.reviewedAt ?? null);
}

// The names of the topics a room received, by id, from the listing row.
function topicNamesOf(row, record) {
    const resolved = resolveJsonPointer(row?.document, record.pointer ?? "/topics");
    if (!resolved.found || !Array.isArray(resolved.value)) {
        return null;
    }
    const names = new Map();
    for (const topic of resolved.value) {
        if (typeof topic?.id === "string" && typeof topic.topic === "string") {
            names.set(topic.id, topic.topic);
        }
    }
    return names;
}

/**
 * The topic list each room received, by room job id: the ids its room job
 * recorded when the room was created (#1221) and, while the case's listing
 * is still that version, their names. A room whose job recorded no
 * `discussion_topics` is left out.
 *
 * @param {Object[]} decisions - The reader's stored decisions.
 * @param {Object} [deps]
 * @param {Function} [deps.getCaseAnalysis] - `({ caseId, serviceId })` ->
 *     the `case_analyses` row or null.
 * @returns {Promise<Map<string, { job: Object, topics: Object[], status: string }>>}
 */
export async function resolveRoomTopics(decisions, {
    getCaseAnalysis = defaultGetCaseAnalysis,
} = {}) {
    const rooms = new Map();
    for (const decision of decisions) {
        const job = decision.job;
        if (!job?.id || rooms.has(job.id)) {
            continue;
        }
        const record = discussionTopicsRecordOf(job);
        if (record) {
            rooms.set(job.id, { job, record });
        }
    }

    const listings = new Map();
    const listingOf = record => {
        const caseId = positiveIdOf(record.caseId);
        const serviceId = typeof record.serviceId === "string" ? record.serviceId : null;
        const key = `${caseId}\u0000${serviceId}`;
        if (!listings.has(key)) {
            listings.set(key, Promise.resolve()
                .then(() => (caseId && serviceId ? getCaseAnalysis({ caseId, serviceId }) : null))
                .catch(error => {
                    console.warn("[polyadic-bridge] Could not read a topic listing for the report.",
                        JSON.stringify({ caseId, ...describeError(error) }));
                    return null;
                }));
        }
        return listings.get(key);
    };

    const resolved = new Map();
    for (const [jobId, { job, record }] of rooms) {
        const row = await listingOf(record);
        const names = row ? topicNamesOf(row, record) : null;
        const status = !row || !names
            ? ROOM_TOPICS_STATUS.LISTING_UNAVAILABLE
            : isSentVersion(row, record)
                ? ROOM_TOPICS_STATUS.AS_SENT
                : ROOM_TOPICS_STATUS.LISTING_CHANGED;
        const topics = record.ids.map(id => ({
            id,
            name: status === ROOM_TOPICS_STATUS.AS_SENT ? names.get(id) ?? null : null,
        }));
        resolved.set(jobId, { job, topics, status });
    }
    return resolved;
}

// The JSON of a room's topics, within the contract's string limit: without
// names when the names would not fit.
function topicsJson(topics) {
    const full = JSON.stringify(topics);
    if (full.length <= MAX_CONTRIBUTION_STRING_LENGTH) {
        return full;
    }
    return JSON.stringify(topics.map(({ id }) => ({ id, name: null })))
        .slice(0, MAX_CONTRIBUTION_STRING_LENGTH);
}

// ─── Transcript rows ────────────────────────────────────────────────────────

function placementOf(decision) {
    const phaseId = positiveIdOf(decision.phaseId);
    if (!phaseId) {
        return null;
    }
    return {
        phaseId,
        questionId: positiveIdOf(decision.questionId),
        groupId:    positiveIdOf(decision.groupId),
    };
}

function idListJson(ids) {
    return JSON.stringify(ids.map(id => positiveIdOf(id)));
}

// The values of one decision row. The record was validated before it was
// stored, but a value of an unexpected type is exported as empty rather
// than making the whole contribution invalid.
function decisionValues(decision) {
    const record = isPlainObject(decision.record) ? decision.record : {};
    const trigger = isPlainObject(record.trigger) ? record.trigger : {};
    const topic = isPlainObject(record.topic) ? record.topic : {};
    const intervention = isPlainObject(record.intervention) ? record.intervention : {};
    const window = Array.isArray(record.window?.messages) ? record.window.messages : [];
    const windowIds = window.map((_, index) => decision.windowChatMessageIds?.[index] ?? null);
    const polyadicIds = window.map(reference => reference?.messageId);
    return {
        [C.ROW_KIND]:                         REPORT_ROW_KIND.DECISION,
        [C.DECISION_ID]:                      textOrNull(record.decisionId),
        [C.PIPELINE_TYPE]:                    textOrNull(record.pipelineType),
        [C.DECISION]:                         textOrNull(record.decision),
        [C.CATEGORY]:                         textOrNull(record.category),
        [C.TOPIC_ID]:                         textOrNull(topic.id),
        [C.TOPIC_NAME]:                       textOrNull(topic.name),
        [C.REASON]:                           textOrNull(record.reason),
        [C.TRIGGER_KIND]:                     textOrNull(trigger.kind),
        [C.TRIGGER_REASON]:                   textOrNull(trigger.reason),
        [C.WINDOW_MESSAGE_IDS]:               idListJson(windowIds),
        [C.WINDOW_POLYADIC_MESSAGE_IDS]:      idListJson(polyadicIds),
        [C.INTERVENTION_STATUS]:              textOrNull(intervention.status),
        [C.INTERVENTION_AGENT]:               textOrNull(intervention.agent),
        [C.INTERVENTION_MESSAGE_ID]:          positiveIdOf(decision.interventionChatMessageId),
        [C.INTERVENTION_POLYADIC_MESSAGE_ID]: positiveIdOf(intervention.messageId),
        [C.INTERVENTION_SUPPRESSED_BY]:       textOrNull(intervention.suppressedBy),
        [C.DECIDED_AT]:                       textOrNull(record.decidedAt),
    };
}

/**
 * The transcript rows of a session's stored decisions: one per decision at
 * its `decidedAt`, and one per room with a recorded topic list at its room
 * job's creation. `agentValues(decision)` gives the bridge's agent columns
 * of a decision row.
 *
 * A decision row names the deciding agent as its author (`authorName`,
 * #1228), the record's `agent`, such as `Validator`. A room row was written
 * by no agent: its `authorName` is null.
 *
 * @param {Object[]} decisions - The reader's stored decisions.
 * @param {Map<string, Object>} roomTopics - resolveRoomTopics().
 * @param {(decision: Object) => Object} agentValues
 * @returns {Object[]} Contributed rows.
 */
export function decisionTranscriptRows(decisions, roomTopics, agentValues) {
    const rows = [];
    const firstDecisionOfRoom = new Map();
    for (const decision of decisions) {
        const placement = placementOf(decision);
        const time = isoTimeOf(decision.record?.decidedAt) ?? isoTimeOf(decision.decidedAt);
        if (!placement || !time) {
            continue;
        }
        if (decision.job?.id && !firstDecisionOfRoom.has(decision.job.id)) {
            firstDecisionOfRoom.set(decision.job.id, { placement, time });
        }
        rows.push({
            ...placement,
            time,
            message:    null,
            authorName: normalizeExternalAgentAuthorName(decision.record?.agent) || null,
            values:     { ...agentValues(decision), ...decisionValues(decision) },
        });
    }

    for (const [jobId, { job, topics, status }] of roomTopics) {
        const first = firstDecisionOfRoom.get(jobId);
        if (!first) {
            continue;
        }
        rows.push({
            ...first.placement,
            time:       isoTimeOf(job.createdAt) ?? first.time,
            message:    null,
            authorName: null,
            values:     {
                [C.ROW_KIND]:           REPORT_ROW_KIND.ROOM_TOPICS,
                [C.ROOM_TOPICS]:        topicsJson(topics),
                [C.ROOM_TOPICS_STATUS]: status,
            },
        });
    }
    return rows;
}
