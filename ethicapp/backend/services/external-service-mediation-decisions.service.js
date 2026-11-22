import { JOB_SOURCE_KIND, poolQuery } from "./external-service-jobs.service.js";

/**
 * Stored mediation decisions (#1222, epic ethicapp-ai-additions#293, V46):
 * the `mediation-decision/v1` records a service's callbacks carry, such as
 * the decisions of Polyadic's Validator in the `contentCoverage` mode, with
 * the room's topic coverage when the record has one (#1233, V47).
 *
 * The adapter validates each record (services/mediation-decision-records.js)
 * and stores the valid ones through createMediationDecisionsAccess(). Each
 * is stored once per service and `decisionId`, so a callback delivered twice
 * adds nothing. The report reads them back through its results reader
 * (external-service-report-results.service.js).
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function windowReferences(record) {
    const messages = record?.window?.messages;
    return Array.isArray(messages) ? messages : [];
}

// The topics of a record's coverage, or null for a record without one.
function coverageTopics(record) {
    const coverage = record?.topicCoverage;
    if (coverage === null || typeof coverage !== "object" || Array.isArray(coverage)) {
        return null;
    }
    return Array.isArray(coverage.topics) ? coverage.topics : [];
}

function evidenceReferences(topic) {
    return Array.isArray(topic?.evidence) ? topic.evidence : [];
}

// Every message reference of a record: its window's and its coverage's.
function messageReferences(record) {
    return [
        ...windowReferences(record),
        ...(coverageTopics(record) ?? []).flatMap(evidenceReferences),
    ];
}

function positiveIdOrNull(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export class ExternalServiceMediationDecisionsService {
    constructor({ dbQuery } = {}) {
        this._db = dbQuery || poolQuery;
    }

    /**
     * EthicApp's chat message ids of the given correlation ids: each one is
     * the id of the `chat-message-received` job that forwarded a message,
     * whose source is the message (V38). Only the service's jobs of the
     * session are read.
     * @returns {Promise<Map<string, number>>} Lower-case correlation id ->
     *     chat message id.
     */
    async chatMessageIdsByCorrelation({ serviceId, sessionId, correlationIds }) {
        const ids = [...new Set(correlationIds
            .filter(id => typeof id === "string" && UUID_PATTERN.test(id))
            .map(id => id.toLowerCase()))];
        if (ids.length === 0) {
            return new Map();
        }
        const rows = await this._db(
            `SELECT id::text AS correlation_id, source_id
             FROM external_service_jobs
             WHERE service_id = $1
               AND session_id = $2
               AND source_kind = $3
               AND id = ANY($4::uuid[])`,
            [serviceId, sessionId, JOB_SOURCE_KIND.CHAT_MESSAGE, ids]
        );
        return new Map(rows.map(row => [String(row.correlation_id).toLowerCase(),
            positiveIdOrNull(row.source_id)]));
    }

    /**
     * Stores validated records of one callback, each once.
     *
     * @param {Object} args
     * @param {string} args.serviceId
     * @param {number} args.sessionId
     * @param {number} args.phaseId
     * @param {number|null} [args.questionId]
     * @param {number|null} [args.groupId]
     * @param {string|null} [args.jobId] - The job the callback correlated with.
     * @param {string|null} [args.resultId] - The callback's result row.
     * @param {Array<{ record: Object, interventionChatMessageId?: number|null }>} args.decisions
     * @returns {Promise<{ stored: string[], duplicates: string[] }>} The
     *     decision ids stored now, and those already stored.
     */
    async recordDecisions({
        serviceId,
        sessionId,
        phaseId,
        questionId = null,
        groupId = null,
        jobId = null,
        resultId = null,
        decisions,
    }) {
        const stored = [];
        const duplicates = [];
        if (!Array.isArray(decisions) || decisions.length === 0) {
            return { stored, duplicates };
        }

        const chatMessageIds = await this.chatMessageIdsByCorrelation({
            serviceId,
            sessionId,
            correlationIds: decisions.flatMap(({ record }) => messageReferences(record)
                .map(reference => reference?.correlationId)),
        });
        const chatMessageIdOf = reference => {
            const correlationId = reference?.correlationId;
            return typeof correlationId === "string"
                ? chatMessageIds.get(correlationId.toLowerCase()) ?? null
                : null;
        };

        for (const { record, interventionChatMessageId = null } of decisions) {
            const windowChatMessageIds = windowReferences(record).map(chatMessageIdOf);
            // Aligned with the coverage's topics and each topic's evidence;
            // null for a record without coverage (#1233, V47).
            const topics = coverageTopics(record);
            const coverageEvidenceChatMessageIds = topics
                ? topics.map(topic => evidenceReferences(topic).map(chatMessageIdOf))
                : null;
            const rows = await this._db(
                `INSERT INTO external_service_mediation_decisions
                     (service_id, decision_id, session_id, phase_id, question_id, group_id,
                      job_id, result_id, decided_at, record, window_chat_message_ids,
                      intervention_chat_message_id, coverage_evidence_chat_message_ids)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::bigint[], $12,
                         $13::jsonb)
                 ON CONFLICT (service_id, decision_id) DO NOTHING
                 RETURNING id`,
                [
                    serviceId, record.decisionId, sessionId, phaseId, questionId, groupId,
                    jobId, resultId, record.decidedAt, JSON.stringify(record),
                    windowChatMessageIds, positiveIdOrNull(interventionChatMessageId),
                    coverageEvidenceChatMessageIds === null
                        ? null
                        : JSON.stringify(coverageEvidenceChatMessageIds),
                ]
            );
            (rows.length > 0 ? stored : duplicates).push(record.decisionId);
        }
        return { stored, duplicates };
    }
}

/**
 * The mediation decisions of one service, as an adapter receives them in
 * register(). Errors propagate; the adapter decides how a failed write
 * degrades.
 */
export function createMediationDecisionsAccess(store, serviceId) {
    return Object.freeze({
        record: options => store.recordDecisions({ ...options, serviceId }),
    });
}

export const externalServiceMediationDecisionsService =
    new ExternalServiceMediationDecisionsService();
