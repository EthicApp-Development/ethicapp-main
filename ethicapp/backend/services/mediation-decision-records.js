import { readFileSync } from "node:fs";
import { Validator } from "@cfworker/json-schema";
import { errorClassification } from "./external-service-handler-run.js";
import {
    DOCUMENT_PROBLEM_CODES,
    jsonData,
    ROOT_PATH,
    schemaProblems,
} from "./student-result-documents.js";

/**
 * Validation of `mediation-decision/v1` records (#1222, epic
 * ethicapp-ai-additions#293): one decision of a chat mediation agent that
 * does not speak in the chat, such as Polyadic's Validator. Polyadic sends
 * them in its room callback's `decisions` list, and EthicApp stores only the
 * records that validate. A record may carry the room's topic coverage as the
 * agent saw it, `topicCoverage` (#1233, ethicapp-ai-additions#313).
 *
 * The schema is EthicApp's verbatim copy in `canonical-schemas/ai-additions/`,
 * compiled with `@cfworker/json-schema` as `npm run test:schemas` does. The
 * rules JSON Schema cannot express are checked as in ethicapp-ai-additions'
 * `ethicapp_ai_capabilities.validate_mediation_decision()`, with the same
 * codes, so both sides refuse the same records.
 *
 * Problems are `{ code, path }` (plus `keyword` for a schema violation), in
 * the Python validator's path notation. No problem carries a value from the
 * record: `reason` may quote participants, so problems can be logged and the
 * record cannot.
 */

export const MEDIATION_DECISION_SCHEMA = "mediation-decision/v1";

export const MEDIATION_DECISION_PROBLEM_CODES = Object.freeze({
    SCHEMA_UNAVAILABLE:    DOCUMENT_PROBLEM_CODES.SCHEMA_UNAVAILABLE,
    SCHEMA_VIOLATION:      DOCUMENT_PROBLEM_CODES.SCHEMA_VIOLATION,
    DECISION_MISMATCH:     "decision_mismatch",
    INTERVENTION_MISMATCH: "intervention_mismatch",
    DUPLICATE_MESSAGE_REF: "duplicate_message_ref",
    DUPLICATE_TOPIC_ID:    "duplicate_topic_id",
    UNKNOWN_TOPIC_ID:      "unknown_topic_id",
    COVERAGE_MISMATCH:     "coverage_mismatch",
});

const SCHEMA_FILE_NAME = "mediation-decision.v1.schema.json";
const DECISIONS = new Set(["intervene", "no_intervention", "unparsed"]);
const INTERVENTION_STATUSES = new Set(["intervened", "suppressed", "failed", "not_requested"]);
const TOPIC_STATUSES = new Set(["pending", "partial", "developed"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * A record's `decisionId` when it is the UUID the schema requires, which may
 * be logged; null for anything else.
 */
export function loggableDecisionId(record) {
    const id = isPlainObject(record) ? record.decisionId : null;
    return typeof id === "string" && UUID_PATTERN.test(id) ? id : null;
}

// Only an intervention has a category or a topic, and asks the speaking agent.
function decisionProblems(record) {
    const decision = record.decision;
    const status = isPlainObject(record.intervention) ? record.intervention.status : null;
    if (!DECISIONS.has(decision) || !INTERVENTION_STATUSES.has(status)) {
        return [];
    }
    const problems = [];
    if (decision !== "intervene") {
        for (const key of ["category", "topic"]) {
            if (record[key] !== null && record[key] !== undefined) {
                problems.push({
                    code: MEDIATION_DECISION_PROBLEM_CODES.DECISION_MISMATCH,
                    path: key,
                });
            }
        }
        if (status !== "not_requested") {
            problems.push({
                code: MEDIATION_DECISION_PROBLEM_CODES.DECISION_MISMATCH,
                path: "intervention.status",
            });
        }
    } else if (status === "not_requested") {
        problems.push({
            code: MEDIATION_DECISION_PROBLEM_CODES.DECISION_MISMATCH,
            path: "intervention.status",
        });
    }
    return problems;
}

// Each intervention status carries exactly its own details.
function interventionProblems(intervention) {
    if (!isPlainObject(intervention) || !INTERVENTION_STATUSES.has(intervention.status)) {
        return [];
    }
    const status = intervention.status;
    const expected = {
        agent:        status !== "not_requested",
        messageId:    status === "intervened",
        suppressedBy: status === "suppressed",
    };
    const problems = [];
    for (const [key, present] of Object.entries(expected)) {
        if (!Object.hasOwn(intervention, key)) {
            continue;
        }
        if ((intervention[key] !== null) !== present) {
            problems.push({
                code: MEDIATION_DECISION_PROBLEM_CODES.INTERVENTION_MISMATCH,
                path: `intervention.${key}`,
            });
        }
    }
    return problems;
}

// Each message is referenced once in a list of references.
function duplicateReferenceProblems(references, path) {
    if (!Array.isArray(references)) {
        return [];
    }
    const problems = [];
    const seen = new Set();
    references.forEach((ref, index) => {
        const messageId = isPlainObject(ref) ? ref.messageId : null;
        if (!Number.isInteger(messageId)) {
            return;
        }
        if (seen.has(messageId)) {
            problems.push({
                code: MEDIATION_DECISION_PROBLEM_CODES.DUPLICATE_MESSAGE_REF,
                path: `${path}[${index}].messageId`,
            });
        }
        seen.add(messageId);
    });
    return problems;
}

// No message appears twice in a window.
function windowProblems(window) {
    const messages = isPlainObject(window) ? window.messages : null;
    return duplicateReferenceProblems(messages, "window.messages");
}

const COVERAGE = Object.freeze({
    duplicateTopic: path => ({ code: MEDIATION_DECISION_PROBLEM_CODES.DUPLICATE_TOPIC_ID, path }),
    unknownTopic:   path => ({ code: MEDIATION_DECISION_PROBLEM_CODES.UNKNOWN_TOPIC_ID, path }),
    mismatch:       path => ({ code: MEDIATION_DECISION_PROBLEM_CODES.COVERAGE_MISMATCH, path }),
});

// A pending topic has no evidence, a covered one has some, each message once.
function topicProgressProblems(progress, path) {
    const { status, evidence } = progress;
    if (!Array.isArray(evidence)) {
        return [];
    }
    const mismatch = status === "pending"
        ? evidence.length > 0
        : TOPIC_STATUSES.has(status) && evidence.length === 0;
    return [
        ...(mismatch ? [COVERAGE.mismatch(`${path}.evidence`)] : []),
        ...duplicateReferenceProblems(evidence, `${path}.evidence`),
    ];
}

// Only an `updated` run names topics, each once, all of them covered topics
// of the snapshot. `statuses` maps the snapshot's topic ids to their status,
// or is null when the snapshot is not a list (the schema reports it).
function updatedTopicProblems(coverage, statuses) {
    const updated = coverage.updatedTopicIds;
    if (!Array.isArray(updated)) {
        return [];
    }
    const problems = [];
    const status = coverage.status;
    if ((status === "unchanged" || status === "failed") && updated.length > 0) {
        problems.push(COVERAGE.mismatch("topicCoverage.updatedTopicIds"));
    } else if (status === "updated" && updated.length === 0) {
        problems.push(COVERAGE.mismatch("topicCoverage.updatedTopicIds"));
    }
    const seen = new Set();
    updated.forEach((topicId, index) => {
        if (typeof topicId !== "string") {
            return;
        }
        const path = `topicCoverage.updatedTopicIds[${index}]`;
        if (seen.has(topicId)) {
            problems.push(COVERAGE.duplicateTopic(path));
            return;
        }
        seen.add(topicId);
        if (statuses === null) {
            return;
        }
        if (!statuses.has(topicId)) {
            problems.push(COVERAGE.unknownTopic(path));
        } else if (statuses.get(topicId) === "pending") {
            problems.push(COVERAGE.mismatch(path));
        }
    });
    return problems;
}

// The coverage is one consistent snapshot of the room's topics: each topic
// once, its evidence matching its level, the updated topics among them and
// raised, and the decision's topic one of them.
function coverageProblems(coverage, topic) {
    if (!isPlainObject(coverage)) {
        return [];
    }
    const problems = [];
    const topics = Array.isArray(coverage.topics) ? coverage.topics : null;
    const statuses = new Map();
    (topics ?? []).forEach((progress, index) => {
        if (!isPlainObject(progress)) {
            return;
        }
        const path = `topicCoverage.topics[${index}]`;
        problems.push(...topicProgressProblems(progress, path));
        const topicId = progress.id;
        if (typeof topicId !== "string") {
            return;
        }
        if (statuses.has(topicId)) {
            problems.push(COVERAGE.duplicateTopic(`${path}.id`));
            return;
        }
        statuses.set(topicId, progress.status);
    });
    problems.push(...updatedTopicProblems(coverage, topics ? statuses : null));
    const topicId = isPlainObject(topic) ? topic.id : null;
    if (typeof topicId === "string" && topics && !statuses.has(topicId)) {
        problems.push(COVERAGE.unknownTopic("topic.id"));
    }
    return problems;
}

/**
 * The integrity rules of `mediation-decision/v1` that JSON Schema cannot
 * express (`_decision_problems`, `_intervention_problems`,
 * `_window_problems` and, for a record with `topicCoverage`,
 * `_coverage_problems` in ethicapp_ai_capabilities/mediation_decision.py).
 */
export function mediationDecisionIntegrityProblems(record) {
    if (!isPlainObject(record)) {
        return [];
    }
    return [
        ...decisionProblems(record),
        ...interventionProblems(record.intervention),
        ...windowProblems(record.window),
        ...(Object.hasOwn(record, "topicCoverage")
            ? coverageProblems(record.topicCoverage, record.topic)
            : []),
    ];
}

function schemaCopyUrl() {
    return new URL(`../../../canonical-schemas/ai-additions/${SCHEMA_FILE_NAME}`, import.meta.url);
}

/**
 * Creates a record validator. The schema copy is read and compiled on first
 * use and kept for the life of the process. A copy that cannot be read is
 * logged once, and every record is refused with `schema_unavailable`.
 *
 * @param {Object} [options]
 * @param {() => unknown} [options.readSchema] - Reads and parses the copy;
 *     replaced in tests.
 * @param {{ error: Function }} [options.logger]
 * @returns {(record: unknown) => { valid: boolean, problems: Object[] }}
 */
export function createMediationDecisionValidator({
    readSchema = () => JSON.parse(readFileSync(schemaCopyUrl(), "utf8")),
    logger = console,
} = {}) {
    let compiled;

    function validator() {
        if (compiled === undefined) {
            try {
                compiled = new Validator(readSchema(), "2020-12", false);
            } catch (error) {
                logger.error(
                    "[external-services] Cannot load the copy of the mediation decision schema; "
                    + "its records are refused.",
                    JSON.stringify({
                        documentSchema: MEDIATION_DECISION_SCHEMA,
                        ...errorClassification(error),
                    })
                );
                compiled = null;
            }
        }
        return compiled;
    }

    return function validateMediationDecision(record) {
        const compiledValidator = validator();
        if (!compiledValidator) {
            return {
                valid:    false,
                problems: [{
                    code: MEDIATION_DECISION_PROBLEM_CODES.SCHEMA_UNAVAILABLE,
                    path: ROOT_PATH,
                }],
            };
        }

        const data = jsonData(record);
        let result;
        try {
            result = data.ok ? compiledValidator.validate(data.value) : null;
        } catch {
            result = null;
        }
        if (!result) {
            return {
                valid:    false,
                problems: [{
                    code:    MEDIATION_DECISION_PROBLEM_CODES.SCHEMA_VIOLATION,
                    keyword: "not_json",
                    path:    ROOT_PATH,
                }],
            };
        }

        const problems = [
            ...(result.valid ? [] : schemaProblems(result.errors)),
            ...mediationDecisionIntegrityProblems(data.value),
        ];
        return { valid: problems.length === 0, problems };
    };
}

export const validateMediationDecision = createMediationDecisionValidator();
