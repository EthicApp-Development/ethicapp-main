import * as rpg2 from "../../db/rest-pg-2.js";
import * as config from "../../config/database.config.js";
import defaultAiAdditionsClient from "../../services/ai-additions-client.service.js";
import { plainTextOf } from "../../helpers/rich-text-helper.js";
import { describeError } from "../../helpers/log-safety.js";
import { normalizeExternalAgentAuthorName } from "../../helpers/external-agent-author.js";
import { JOB_SOURCE_KIND } from "../../services/external-service-jobs.service.js";
import {
    MAX_CONTRIBUTION_STRING_LENGTH,
} from "../../services/external-service-report-contributions.js";

// The Polyadic Agents API under the AI Additions connection's base URL (#814).
export const POLYADIC_API_BASE_PATH = "/polyadic-agent/api";

// The texts teachers read about this service (#723), available even when
// Polyadic does not respond (#757).
const UI_TRANSLATIONS = {
    es_CL: {
        label:       "Agentes de discusión",
        description: "Agentes de IA que participan en el chat de cada grupo y guían la discusión.",
    },
    en_US: {
        label:       "Discussion agents",
        description: "AI agents that join each group's chat and guide the discussion.",
    },
};

export async function getUiTranslations() {
    return UI_TRANSLATIONS;
}
const DEFAULT_PIPELINE_TYPE = "abogado-del-diablo";
const CHAT_AGENT_IDENTITIES = new Set(["conversationguide", "orientador"]);

let aiAdditionsClient = defaultAiAdditionsClient;

function normalizeText(value) {
    if (value === null || value === undefined) {
        return "";
    }

    const text = String(value).trim();
    return text.length > 0 ? text : "";
}

function isPublishableChatAgent(agentName) {
    return CHAT_AGENT_IDENTITIES.has(normalizeText(agentName).toLowerCase());
}

function readBoolean(value, fallback) {
    if (value === undefined || value === null || value === "") {
        return fallback;
    }

    return String(value).trim().toLowerCase() === "true";
}

function isPolyadicAuthenticated() {
    return readBoolean(process.env.AI_ADDITIONS_POLYADIC_AGENTS_AUTHENTICATED, true);
}

function getPipelineType() {
    return normalizeText(process.env.AI_ADDITIONS_POLYADIC_AGENTS_PIPELINE_TYPE)
        || DEFAULT_PIPELINE_TYPE;
}

export function getRoomName(sessionId, phaseId, groupId) {
    return `ethicapp-s${sessionId}-p${phaseId}-g${groupId}`;
}

// The destination a Polyadic callback names: the session, phase and group
// encoded in its room. The registry refuses the callback when they differ
// from the job it correlates with (#815). An unparseable room names nothing,
// and the handler then reports it as unknown.
export function getCallbackTarget(requestPayload) {
    return parseRoomName(requestPayload?.room) ?? {};
}

export function parseRoomName(roomName) {
    const match = normalizeText(roomName).match(/^ethicapp-s(\d+)-p(\d+)-g(\d+)$/);
    if (!match) {
        return null;
    }

    return {
        sessionId: Number(match[1]),
        phaseId:   Number(match[2]),
        groupId:   Number(match[3]),
    };
}

function getPhaseRoomsKey(sessionId, phaseId) {
    return `${sessionId}:${phaseId}`;
}

async function getTeamIdsForPhase(sessionId, phaseId) {
    const rows = await rpg2.execSQL({
        sql: `
            SELECT t.id AS team_id
            FROM teams AS t
            WHERE t.sesid = $1
              AND t.stageid = $2
            ORDER BY t.id
        `,
        dbcon:     config.dbconnString,
        sqlParams: [
            rpg2.param("plain", sessionId),
            rpg2.param("plain", phaseId),
        ],
    });

    return rows.map(row => Number(row.team_id)).filter(Number.isInteger);
}

async function getFirstQuestionIdForPhase(phaseId) {
    const rows = await rpg2.execSQL({
        sql: `
            SELECT d.id AS question_id
            FROM differential AS d
            WHERE d.stageid = $1
            ORDER BY d.orden, d.id
            LIMIT 1
        `,
        dbcon:     config.dbconnString,
        sqlParams: [rpg2.param("plain", phaseId)],
    });

    return rows.length > 0 ? Number(rows[0].question_id) : null;
}

async function getParticipantIdentity(groupId, userId) {
    const rows = await rpg2.execSQL({
        sql: `
            SELECT tu.anon_mask,
                   u.firstname,
                   u.lastname,
                   u.name,
                   st.anon AS phase_anonymous
            FROM teamusers AS tu
            INNER JOIN users AS u ON u.id = tu.uid
            INNER JOIN teams AS t ON t.id = tu.tmid
            INNER JOIN stages AS st ON st.id = t.stageid
            WHERE tu.tmid = $1
              AND tu.uid = $2
            LIMIT 1
        `,
        dbcon:     config.dbconnString,
        sqlParams: [
            rpg2.param("plain", groupId),
            rpg2.param("plain", userId),
        ],
    });

    return rows.length > 0 ? rows[0] : null;
}

async function getFirstQuestionForPhase(phaseId) {
    const rows = await rpg2.execSQL({
        sql: `
            SELECT d.id AS question_id, d.title, d.title_content_type, d.tleft, d.tright
            FROM differential AS d
            WHERE d.stageid = $1
            ORDER BY d.orden, d.id
            LIMIT 1
        `,
        dbcon:     config.dbconnString,
        sqlParams: [rpg2.param("plain", phaseId)],
    });

    if (rows.length === 0) {
        return null;
    }

    return {
        id:               Number(rows[0].question_id),
        title:            normalizeText(rows[0].title),
        titleContentType: rows[0].title_content_type,
        tleft:            normalizeText(rows[0].tleft),
        tright:           normalizeText(rows[0].tright),
    };
}

async function getDefaultCaseIdBySessionId(sessionId) {
    const sessionsHelper = await import("../../helpers/sessions-helper.js");
    return sessionsHelper.getCaseIdBySessionId(sessionId);
}

async function getDefaultCaseDocumentRawText(caseId) {
    const caseDocumentContentHelper = await import("../../helpers/case-document-content-helper.js");
    return caseDocumentContentHelper.getCaseDocumentRawText(caseId);
}

export function formatQuestionText(question) {
    if (!question) {
        return "";
    }

    const parts = [];
    // Markdown questions reach Polyadic as plain text (#768).
    const title = normalizeText(plainTextOf(question.title, question.titleContentType));
    const left = normalizeText(question.tleft);
    const right = normalizeText(question.tright);

    if (title) {
        parts.push(title);
    }

    if (left && right) {
        parts.push(`${left} vs. ${right}`);
    } else if (left) {
        parts.push(left);
    }

    return parts.join(" | ");
}

export function composeTopic(caseText, questionText) {
    const topic = normalizeText(caseText);
    const question = normalizeText(questionText);

    if (!question) {
        return topic || "EthicApp discussion";
    }

    return `${topic || "EthicApp discussion"}\n\nCentral question: ${question}`;
}

async function resolveCaseText(sessionId, dependencies) {
    try {
        const caseId = await dependencies.getCaseIdBySessionId(sessionId);
        if (!caseId) {
            console.warn(`[polyadic-bridge] No case found for session ${sessionId}.`);
            return "";
        }

        const caseText = normalizeText(await dependencies.getCaseDocumentRawText(caseId));
        console.info(`[polyadic-bridge] Case text loaded for session ${sessionId}, case ${caseId}.`);
        return caseText;
    } catch (error) {
        console.warn(`[polyadic-bridge] Unable to load case text for session ${sessionId}.`, error);
        return "";
    }
}

async function getSessionLanguageCode(sessionId) {
    const row = await rpg2.singleSQL({
        sql: `
            SELECT d.language_code
            FROM activity AS a
            INNER JOIN designs AS d ON d.id = a.design
            WHERE a.session = $1
            LIMIT 1
        `,
        dbcon:     config.dbconnString,
        sqlParams: [rpg2.param("plain", sessionId)],
    });

    return row?.language_code ? normalizeText(row.language_code) : null;
}

// Polyadic's `locale` (#735; replaces the deprecated `idioma` alias).
const POLYADIC_LOCALES = {
    en_US: "en-US",
    es_CL: "es-CL",
};
const DEFAULT_POLYADIC_LOCALE = POLYADIC_LOCALES.es_CL;

function isEnglishLanguageCode(languageCode) {
    return normalizeText(languageCode).toLowerCase().startsWith("en");
}

export function resolvePolyadicLocale(languageCode) {
    const normalized = normalizeText(languageCode);
    if (POLYADIC_LOCALES[normalized]) {
        return POLYADIC_LOCALES[normalized];
    }

    return isEnglishLanguageCode(normalized) ? POLYADIC_LOCALES.en_US : DEFAULT_POLYADIC_LOCALE;
}

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

// The configured settings to send: set values only. `prompt_inicial` is the
// adapter's own and never comes from a configuration.
function configuredSettings(serviceConfiguration) {
    const settings = {};
    if (!isPlainObject(serviceConfiguration)) {
        return settings;
    }
    for (const [key, value] of Object.entries(serviceConfiguration)) {
        if (key !== "prompt_inicial" && value !== undefined && value !== null) {
            settings[key] = value;
        }
    }
    return settings;
}

/**
 * The body of POST /rooms/:room/sessions (#735). EthicApp's defaults come
 * first: the deployment pipeline (AI_ADDITIONS_POLYADIC_AGENTS_PIPELINE_TYPE)
 * and the `locale` from the design language. The phase's configured settings
 * (#734), validated against the capability descriptor on save (#731), replace
 * them and add any other instance field (`llm_tier`, `agent_nickname`,
 * `session_duration_seconds`, ...). Fields left unset take Polyadic's
 * defaults: without `agent_nickname`, Polyadic names the guide by the room's
 * locale, `agente` or `agent` (#1026, epic #1025).
 * `ethicapp_room_correlation_id` (#833) is the id of the room's room job, which
 * Polyadic uses for the room's proactive callbacks; no setting replaces it.
 * @param {{ topic?: string, locale?: string,
 *   serviceConfiguration?: object, pipelineType?: string,
 *   roomCorrelationId?: string|null }} options
 */
export function buildPolyadicSessionPayload({
    topic,
    locale,
    serviceConfiguration = {},
    pipelineType = getPipelineType(),
    roomCorrelationId = null,
} = {}) {
    const payload = {
        prompt_inicial: topic || "EthicApp discussion",
        pipeline_type:  pipelineType,
        locale:         locale || DEFAULT_POLYADIC_LOCALE,
        ...configuredSettings(serviceConfiguration),
    };
    delete payload.ethicapp_room_correlation_id;
    if (roomCorrelationId) {
        payload.ethicapp_room_correlation_id = roomCorrelationId;
    }
    return payload;
}

export function resolvePolyadicUsername(identity, userId) {
    if (!identity) {
        return `user-${userId}`;
    }

    if (identity.phase_anonymous) {
        return normalizeText(identity.anon_mask) || `user-${userId}`;
    }

    return normalizeText(identity.firstname)
        || normalizeText(identity.lastname)
        || normalizeText(identity.name)
        || `user-${userId}`;
}

function createDependencies(overrides = {}) {
    return {
        getTeamIdsForPhase,
        getFirstQuestionIdForPhase,
        getFirstQuestionForPhase,
        getCaseIdBySessionId:   getDefaultCaseIdBySessionId,
        getCaseDocumentRawText: getDefaultCaseDocumentRawText,
        getParticipantIdentity,
        getSessionLanguageCode,
        ...overrides,
    };
}

// The EthicApp user id as Polyadic's participant id (a decimal string), or
// null when it is not a positive integer.
function participantIdOf(userId) {
    const id = Number(userId);
    return Number.isInteger(id) && id > 0 ? String(id) : null;
}

/**
 * Asks Polyadic to erase what it keeps about one participant (#876):
 * `DELETE /participants/{participant_id}/data`. Idempotent; resolves to
 * Polyadic's counts. Rejects for an invalid user id, and with the client's
 * error (`statusCode` for an HTTP failure) when Polyadic cannot be reached
 * or refuses.
 */
export async function erasePolyadicParticipant(userId) {
    const participantId = participantIdOf(userId);
    if (!participantId) {
        throw Object.assign(new Error("A positive integer user id is required."), {
            code: "invalid_user_id",
        });
    }

    const response = await requestPolyadicJson(
        `/participants/${encodeURIComponent(participantId)}/data`,
        { method: "DELETE" }
    );

    return {
        participantId,
        messagesErased:   Number(response?.messages_erased) || 0,
        messagesRedacted: Number(response?.messages_redacted) || 0,
        roomSessions:     Number(response?.room_sessions) || 0,
        activeRooms:      Number(response?.active_rooms) || 0,
    };
}

async function requestPolyadicJson(pathname, { method = "GET", body = null } = {}) {
    return aiAdditionsClient.requestJson(pathname, {
        method,
        body,
        basePath:      POLYADIC_API_BASE_PATH,
        // Unauthenticated calls still need the connection: without one the
        // client rejects with `not_configured` before any request.
        authenticated: isPolyadicAuthenticated(),
    });
}

// `roomCorrelationAcknowledged`: Polyadic echoed the room correlation id, so it
// stored it and sends it with the room's proactive callbacks (#833). An older
// Polyadic ignores the field and echoes nothing.
function creationOutcome(response, roomCorrelationId, extra = {}) {
    return {
        warnings:                    Array.isArray(response?.warnings) ? response.warnings : [],
        degraded:                    response?.degraded === true,
        roomCorrelationAcknowledged: Boolean(roomCorrelationId)
            && response?.ethicapp_room_correlation_id === roomCorrelationId,
        ...extra,
    };
}

/**
 * Creates the Polyadic session of a room and returns Polyadic's lifecycle
 * report, `{ warnings, degraded, configurationRejected }` (#735, recorded by
 * #737), and whether Polyadic acknowledged the room correlation id (#833).
 * Polyadic answers 400 when a configured value fails its format rules,
 * which a design saved before a rule tightened can still hold (#731 accepts it
 * with a warning). The room is then created once more without the configured
 * settings, so the group still gets its agent, and `configurationRejected` says so.
 */
async function ensurePolyadicSession(roomName, {
    topic, locale, serviceConfiguration, roomCorrelationId = null,
}) {
    const path = `/rooms/${encodeURIComponent(roomName)}/sessions`;
    const body = buildPolyadicSessionPayload({
        topic, locale, serviceConfiguration, roomCorrelationId,
    });

    try {
        const response = await requestPolyadicJson(path, { method: "POST", body });
        console.info(`[polyadic-bridge] Polyadic session ready for ${roomName}.`);
        return creationOutcome(response, roomCorrelationId, { configurationRejected: false });
    } catch (error) {
        const hasConfiguration = Object.keys(configuredSettings(serviceConfiguration)).length > 0;
        if (Number(error?.statusCode) !== 400 || !hasConfiguration) {
            throw error;
        }

        console.warn(`[polyadic-bridge] Polyadic rejected the configured settings for ${roomName}; `
            + "creating the session with EthicApp's defaults.", error.responseBody ?? error);
        const fallback = buildPolyadicSessionPayload({ topic, locale, roomCorrelationId });
        const response = await requestPolyadicJson(path, { method: "POST", body: fallback });
        console.info(`[polyadic-bridge] Polyadic session ready for ${roomName} without configured settings.`);
        return creationOutcome(response, roomCorrelationId, {
            configurationRejected: true,
            rejection:             error.responseBody ?? null,
        });
    }
}

async function closePolyadicSession(roomName) {
    await requestPolyadicJson(`/rooms/${encodeURIComponent(roomName)}/sessions/active`, {
        method: "DELETE",
    });

    console.info(`[polyadic-bridge] Polyadic session closed for ${roomName}.`);
    return true;
}

// `participantId` is the sender's EthicApp user id. Polyadic stores it with
// the message, so it can erase the participant's messages when EthicApp
// forgets them (#876, ethicapp-ai-additions#214). The agents never see it.
async function forwardChatMessage(roomName, username, content, correlationId, participantId) {
    await requestPolyadicJson(`/rooms/${encodeURIComponent(roomName)}/messages`, {
        method: "POST",
        body:   {
            username,
            content,
            participant_id:          participantIdOf(participantId),
            ethicapp_correlation_id: correlationId ?? null,
        },
    });

    console.info(`[polyadic-bridge] Message forwarded to ${roomName}.`);
    return true;
}

// The chat transcript columns this adapter adds (report-building, epic #620,
// #949), under the catalog's `report.columnPrefix`, `polyadic_`.
export const REPORT_COLUMNS = Object.freeze({
    AGENT_NAME:          "polyadic_agent_name",
    TRIGGER:             "polyadic_agent_trigger",
    IN_REPLY_TO:         "polyadic_agent_in_reply_to",
    VISIBLE_TO_STUDENTS: "polyadic_agent_visible_to_students",
});

const REPORT_COLUMN_DECLARATIONS = Object.freeze([
    { id: REPORT_COLUMNS.AGENT_NAME,          label: "Polyadic agent" },
    { id: REPORT_COLUMNS.TRIGGER,             label: "Polyadic agent trigger" },
    { id: REPORT_COLUMNS.IN_REPLY_TO,         label: "Student message answered" },
    { id: REPORT_COLUMNS.VISIBLE_TO_STUDENTS, label: "Visible to students" },
]);

// What made an agent speak, as far as EthicApp can tell. Polyadic's callback
// does not say. A reactive reply carries the correlation id of the student
// message it answers, the id of that message's chat-message-received job,
// whose `source` names the message (#946). Every other callback is `unknown`:
// on the room job's correlation id (#833) Polyadic sends its proactive
// interventions (welcome, time milestones, inactivity), but also the replies
// of its window events, which answer the room's recent messages; and a
// callback without a job (before #833) may be either too.
export const AGENT_TRIGGER = Object.freeze({
    REACTIVE: "reactive",
    UNKNOWN:  "unknown",
});

function positiveIdOf(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// A contributed string longer than the contract's limit would make the whole
// contribution invalid; it is cut instead.
function reportText(value) {
    return normalizeText(value).slice(0, MAX_CONTRIBUTION_STRING_LENGTH) || null;
}

// The trigger and the answered message of one callback result.
function triggerOf(result) {
    const source = result.source;
    if (source?.kind === JOB_SOURCE_KIND.CHAT_MESSAGE && positiveIdOf(source.id)) {
        return { trigger: AGENT_TRIGGER.REACTIVE, inReplyTo: positiveIdOf(source.id) };
    }
    return { trigger: AGENT_TRIGGER.UNKNOWN, inReplyTo: null };
}

// The agent of a message the bridge published (#1155): the name its callback
// recorded, which is always a chat agent's, since only those are published.
// Any other recorded name is the erasure's placeholder (V31 redacts every
// string of the result of an anonymized student), so the message row's agent,
// which the erasure never touches, names it.
function publishedAgentName(published, row) {
    const recorded = normalizeText(published?.agentName);
    if (isPublishableChatAgent(recorded)) {
        return recorded;
    }
    return normalizeText(row?.externalAgentName) || recorded;
}

// A callback the `callback-received` handler completed, with the evaluations
// it received and the messages it published (#947), or null. Results stored
// before #947 list no published messages: their evaluations cannot be told
// apart from the messages already in the transcript, so they add nothing.
function handledCallbackOf(result) {
    const adapterResult = result?.adapterResult;
    const publishedMessages = adapterResult?.payload?.publishedMessages;
    const evaluations = result?.rawPayload?.evaluations;
    if (adapterResult?.hook !== "callback-received" || adapterResult?.status !== "completed"
        || !Array.isArray(publishedMessages) || !Array.isArray(evaluations)) {
        return null;
    }
    return { result, evaluations, publishedMessages };
}

function isEvaluationIndex(value, evaluations) {
    return Number.isInteger(value) && value >= 0 && value < evaluations.length;
}

// For published messages stored without `evaluationIndex` (before #949),
// only what can be told without guessing. A chat agent with no published
// message had none of its evaluations published. A chat agent with at least
// one published message adds nothing: with as many published messages as
// evaluations all were published, and with fewer, which of its evaluations
// failed cannot be told, and a guess could repeat a message already in the
// transcript.
function unpublishedByAgent(candidates, publishedMessages) {
    const publishedAgents = new Set(publishedMessages.map(entry => normalizeText(entry?.agentName)));
    return candidates.filter(({ agentName, publishable }) => !publishable
        || !publishedAgents.has(agentName));
}

// The evaluations of a callback that the handler did not publish, each once:
// those of agents that do not speak in the chat, and those of chat agents
// whose publication failed. Evaluations without text are skipped, as the
// handler skips them. Each published message names the evaluation it came
// from (`evaluationIndex`); when any entry of the result lacks it, the
// evaluations are matched by agent instead (unpublishedByAgent()).
export function unpublishedEvaluations(evaluations, publishedMessages) {
    const candidates = [];
    evaluations.forEach((evaluation, index) => {
        const agentName = normalizeText(evaluation?.agente);
        const content = normalizeText(evaluation?.respuesta);
        if (content) {
            candidates.push({ index, agentName, content, publishable: isPublishableChatAgent(agentName) });
        }
    });

    const indexed = publishedMessages
        .every(entry => isEvaluationIndex(entry?.evaluationIndex, evaluations));
    const unpublished = indexed
        ? candidates.filter(({ index }) => !publishedMessages.some(entry => entry.evaluationIndex === index))
        : unpublishedByAgent(candidates, publishedMessages);

    return unpublished.map(({ agentName, content }) => ({ agentName, content }));
}

// Where a callback's unpublished evaluations go: beside the messages the same
// callback published, else at the destination of its job, else in the room
// its payload names, only when that room is in the report's session. Null
// when no phase or group can be found.
function placementOf({ result, ownRows, sessionId }) {
    const published = ownRows.find(row => positiveIdOf(row.phaseId) && positiveIdOf(row.groupId));
    if (published) {
        return {
            phaseId:    positiveIdOf(published.phaseId),
            groupId:    positiveIdOf(published.groupId),
            questionId: positiveIdOf(published.questionId),
        };
    }

    const room = parseRoomName(result.rawPayload?.room);
    if (room && room.sessionId !== sessionId) {
        return null;
    }
    const phaseId = positiveIdOf(result.phaseId) ?? room?.phaseId ?? null;
    const groupId = positiveIdOf(result.groupId) ?? room?.groupId ?? null;
    if (!phaseId || !groupId) {
        return null;
    }
    return { phaseId, groupId, questionId: positiveIdOf(result.questionId) };
}

/**
 * The bridge's contribution to a chat transcript (#949), from the report's
 * row keys and the service's stored results for the session.
 *
 * - Each agent message the bridge published from a callback (linked by
 *   `externalServiceResultId`, #947) gets the agent that wrote it, the
 *   trigger, the student message it answered when known, and
 *   `visible_to_students = true`. Messages published before #947 have no
 *   link and get no values. The agent is the one the callback recorded,
 *   unless that name is not a chat agent's: then the erasure redacted the
 *   result of an anonymized student (V31), and the message row's agent
 *   (`externalAgentName`) names it (#1155).
 * - Each evaluation a handled callback received but did not publish becomes
 *   a row at the result's `receivedAt`, with the same columns and
 *   `visible_to_students = false`. Published evaluations are already rows of
 *   the transcript and are never added again.
 *
 * `mensajes_evaluados` is not exported: it repeats the students' messages
 * under their display names.
 */
export function buildChatTranscriptContribution(context, storedResults) {
    const serviceId = context.serviceId;
    const callbacks = new Map();
    for (const result of storedResults) {
        const handled = handledCallbackOf(result);
        if (handled) {
            callbacks.set(String(result.id), handled);
        }
    }

    const ownRowsByResult = new Map();
    for (const row of context.rows) {
        if (row.externalServiceId !== serviceId || row.externalServiceResultId === null
            || row.externalServiceResultId === undefined) {
            continue;
        }
        const key = String(row.externalServiceResultId);
        ownRowsByResult.set(key, [...(ownRowsByResult.get(key) || []), row]);
    }

    const values = [];
    for (const [resultKey, ownRows] of ownRowsByResult) {
        const handled = callbacks.get(resultKey);
        if (!handled) {
            continue;
        }
        const { trigger, inReplyTo } = triggerOf(handled.result);
        for (const row of ownRows) {
            const published = handled.publishedMessages
                .find(entry => entry?.messageId !== null && entry?.messageId !== undefined
                    && String(entry.messageId) === String(row.messageId));
            values.push({
                rowKey: row.messageId,
                values: {
                    [REPORT_COLUMNS.AGENT_NAME]:          reportText(publishedAgentName(published, row)),
                    [REPORT_COLUMNS.TRIGGER]:             trigger,
                    [REPORT_COLUMNS.IN_REPLY_TO]:         inReplyTo,
                    [REPORT_COLUMNS.VISIBLE_TO_STUDENTS]: true,
                },
            });
        }
    }

    const rows = [];
    for (const [resultKey, { result, evaluations, publishedMessages }] of callbacks) {
        const unpublished = unpublishedEvaluations(evaluations, publishedMessages);
        const time = result.receivedAt ? new Date(result.receivedAt) : null;
        if (unpublished.length === 0 || !time || Number.isNaN(time.getTime())) {
            continue;
        }
        const placement = placementOf({
            result,
            ownRows:   ownRowsByResult.get(resultKey) || [],
            sessionId: context.sessionId,
        });
        if (!placement) {
            continue;
        }
        const { trigger, inReplyTo } = triggerOf(result);
        for (const { agentName, content } of unpublished) {
            rows.push({
                ...placement,
                time:    time.toISOString(),
                message: reportText(content),
                values:  {
                    [REPORT_COLUMNS.AGENT_NAME]:          reportText(agentName),
                    [REPORT_COLUMNS.TRIGGER]:             trigger,
                    [REPORT_COLUMNS.IN_REPLY_TO]:         inReplyTo,
                    [REPORT_COLUMNS.VISIBLE_TO_STUDENTS]: false,
                },
            });
        }
    }

    return {
        columns: REPORT_COLUMN_DECLARATIONS.map(column => ({ ...column })),
        values,
        rows,
    };
}

// The `report-building` handler: the chat transcript only, from the results
// reader the collecting dispatch hands it. It reads EthicApp's database only.
export async function contributeToReport(context, { results }) {
    if (context.reportType !== "chat_transcript") {
        return null;
    }
    return buildChatTranscriptContribution(context, await results.list());
}

// Without room jobs (a registry that provides none), rooms are created without
// a room correlation id, as before #833.
const NO_ROOM_JOBS = Object.freeze({
    create: async () => null,
    open:   async () => false,
    fail:   async () => {},
});

export async function register({
    service,
    subscribe,
    publishGroupChatMessage,
    aiAdditionsClient: providedAiAdditionsClient,
    roomJobs = NO_ROOM_JOBS,
    polyadicBridgeDependencies = {},
}) {
    aiAdditionsClient = providedAiAdditionsClient || defaultAiAdditionsClient;

    const dependencies = createDependencies(polyadicBridgeDependencies);
    const phaseRooms = new Map();
    const roomContext = new Map();
    // roomName -> the creation in flight, so concurrent creations of one room
    // share one room job and one Polyadic session.
    const roomCreations = new Map();

    function rememberRoomContext(roomName, sessionId, phaseId, groupId, questionId) {
        const existing = roomContext.get(roomName);
        if (existing) {
            existing.questionId = existing.questionId ?? questionId ?? null;
            return existing;
        }

        const context = { sessionId, phaseId, groupId, questionId: questionId ?? null };
        roomContext.set(roomName, context);
        return context;
    }

    async function resolveSessionLanguageContext(sessionId) {
        try {
            const languageCode = await dependencies.getSessionLanguageCode(sessionId);
            return { locale: resolvePolyadicLocale(languageCode) };
        } catch (error) {
            console.warn(`[polyadic-bridge] Unable to resolve conversation language for session ${sessionId}; using defaults.`, error);
            return { locale: DEFAULT_POLYADIC_LOCALE };
        }
    }

    async function buildTopicForPhase(sessionId, phaseId) {
        const caseText = await resolveCaseText(sessionId, dependencies);
        const question = await dependencies.getFirstQuestionForPhase(phaseId);
        const questionText = formatQuestionText(question);
        const fallbackTopic = `EthicApp session ${sessionId} phase ${phaseId}`;
        const { locale } = await resolveSessionLanguageContext(sessionId);

        return {
            questionId: question?.id ?? null,
            topic:      composeTopic(caseText || fallbackTopic, questionText),
            locale,
        };
    }

    // The room job of a new room (#833). Without one the room is created
    // without a room correlation id, and its proactive callbacks keep the
    // verified-destination rule (#815).
    async function createRoomJob(hookName, room) {
        try {
            return await roomJobs.create({ hookName, ...room });
        } catch (error) {
            console.error(`[polyadic-bridge] Could not create the room job of ${room.room}.`, error);
            return null;
        }
    }

    async function settleRoomJob(roomJobId, roomName, settle) {
        if (!roomJobId) {
            return;
        }
        try {
            await settle(roomJobId);
        } catch (error) {
            console.error(`[polyadic-bridge] Could not update the room job of ${roomName}.`, error);
        }
    }

    // Creates the room with a new room job, whose id it sends to Polyadic.
    // Once the room exists the job opens, bound when Polyadic echoed the id,
    // and supersedes the room's older room jobs; when the room could not be
    // created it fails. Returns `{ roomName, roomJobId, warnings, degraded,
    // configurationRejected }`, or null when the room could not be created.
    async function createRoom({ hookName, sessionId, phaseId, groupId, questionId, ...sessionOptions }) {
        const roomName = getRoomName(sessionId, phaseId, groupId);
        rememberRoomContext(roomName, sessionId, phaseId, groupId, questionId);
        const roomJob = await createRoomJob(hookName, {
            sessionId, phaseId, groupId, questionId: questionId ?? null, room: roomName,
        });
        const roomJobId = roomJob?.id ?? null;

        let outcome;
        try {
            outcome = await ensurePolyadicSession(roomName, {
                ...sessionOptions,
                roomCorrelationId: roomJobId,
            });
        } catch (error) {
            roomContext.delete(roomName);
            console.warn(`[polyadic-bridge] Failed to create polyadic room ${roomName}.`,
                describeError(error));
            await settleRoomJob(roomJobId, roomName, id => roomJobs.fail(id));
            return null;
        }

        const { roomCorrelationAcknowledged, ...report } = outcome;
        await settleRoomJob(roomJobId, roomName,
            id => roomJobs.open(id, { bound: roomCorrelationAcknowledged }));
        return { roomName, roomJobId, ...report };
    }

    // One creation per room at a time: a concurrent caller gets the same
    // room, marked `shared` so it does not report it again.
    function createRoomOnce(options) {
        const roomName = getRoomName(options.sessionId, options.phaseId, options.groupId);
        const inFlight = roomCreations.get(roomName);
        if (inFlight) {
            return inFlight.then(room => room && { ...room, shared: true });
        }

        const creation = createRoom(options).finally(() => roomCreations.delete(roomName));
        roomCreations.set(roomName, creation);
        return creation;
    }

    // Polyadic's lifecycle report for each created room, for the job result.
    function roomReports(rooms) {
        return rooms.map(({ roomName, warnings, degraded, configurationRejected, rejection }) => ({
            room: roomName,
            warnings,
            degraded,
            configurationRejected,
            ...(configurationRejected ? { rejection: rejection ?? null } : {}),
        }));
    }

    // One instantiation report per job (#737): every room's warnings, tagged
    // with their room, and whether any room ran degraded or without its settings.
    async function reportRooms(rooms, reportInstantiation) {
        if (rooms.length === 0 || typeof reportInstantiation !== "function") {
            return;
        }
        const warnings = rooms.flatMap(room => room.warnings
            .map(warning => ({ ...warning, room: room.roomName })));
        // Per room, the state without repeating its warnings.
        const roomStates = roomReports(rooms).map(report => {
            const state = { ...report };
            delete state.warnings;
            return state;
        });

        await reportInstantiation({
            warnings,
            degraded:              rooms.some(room => room.degraded),
            configurationRejected: rooms.some(room => room.configurationRejected),
            rooms:                 roomStates,
        });
    }

    subscribe("report-building", contributeToReport);

    subscribe("phase-started", async (context, { callback, reportInstantiation }) => {
        const { sessionId, phaseId, serviceConfiguration } = context;
        // Without an AI Additions connection the job fails with `not_configured`
        // here, instead of completing with every room silently missing.
        await aiAdditionsClient.getEndpoints();
        const teamIds = await dependencies.getTeamIdsForPhase(sessionId, phaseId);
        const topicData = await buildTopicForPhase(sessionId, phaseId);
        // Rooms are tracked as they are created, so a chat message in a room
        // already created does not create it again.
        const createdRooms = new Set();
        phaseRooms.set(getPhaseRoomsKey(sessionId, phaseId), createdRooms);
        const created = [];

        for (const groupId of teamIds) {
            const room = await createRoomOnce({
                hookName: "phase-started", sessionId, phaseId, groupId, ...topicData, serviceConfiguration,
            });
            if (room) {
                createdRooms.add(room.roomName);
                created.push(room);
            }
        }

        await reportRooms(created, reportInstantiation);

        await callback({
            serviceId: service.id,
            hook:      "phase-started",
            status:    "completed",
            payload:   {
                sessionId,
                phaseId,
                roomsCreated: createdRooms.size,
                rooms:        roomReports(created),
            },
        });
    });

    subscribe("chat-message-received", async (context, { callback, reportInstantiation }) => {
        const {
            sessionId, phaseId, groupId, questionId, userId, correlationId, serviceConfiguration,
        } = context;
        const content = normalizeText(context.content);
        const roomName = getRoomName(sessionId, phaseId, groupId);
        const phaseRoomsKey = getPhaseRoomsKey(sessionId, phaseId);

        if (!content) {
            await callback({
                serviceId: service.id,
                hook:      "chat-message-received",
                status:    "skipped",
                payload:   { sessionId, phaseId, groupId, reason: "empty_content" },
            });
            return;
        }

        let phaseCreatedRooms = phaseRooms.get(phaseRoomsKey);
        if (!phaseCreatedRooms) {
            phaseCreatedRooms = new Set();
            phaseRooms.set(phaseRoomsKey, phaseCreatedRooms);
        }

        let createdReport = null;
        if (!phaseCreatedRooms.has(roomName)) {
            const topicData = await buildTopicForPhase(sessionId, phaseId);
            const createdRoom = await createRoomOnce({
                hookName:   "chat-message-received",
                sessionId,
                phaseId,
                groupId,
                ...topicData,
                questionId: questionId ?? topicData.questionId,
                serviceConfiguration,
            });

            if (!createdRoom) {
                await callback({
                    serviceId: service.id,
                    hook:      "chat-message-received",
                    status:    "failed",
                    payload:   { sessionId, phaseId, groupId, reason: "session_creation_failed" },
                });
                return;
            }

            phaseCreatedRooms.add(createdRoom.roomName);
            if (!createdRoom.shared) {
                createdReport = roomReports([createdRoom])[0];
                await reportRooms([createdRoom], reportInstantiation);
            }
        } else {
            rememberRoomContext(roomName, sessionId, phaseId, groupId, questionId);
        }

        let polyadicUsername = `user-${userId}`;
        try {
            const identity = await dependencies.getParticipantIdentity(groupId, userId);
            polyadicUsername = resolvePolyadicUsername(identity, userId);
        } catch (error) {
            console.warn(`[polyadic-bridge] Failed to resolve participant identity for user ${userId} in ${roomName}; using fallback username.`, error);
        }

        try {
            await forwardChatMessage(roomName, polyadicUsername, content, correlationId, userId);
            await callback({
                serviceId: service.id,
                hook:      "chat-message-received",
                status:    "completed",
                payload:   {
                    sessionId,
                    phaseId,
                    groupId,
                    forwarded: true,
                    ...(createdReport ? { roomCreated: createdReport } : {}),
                },
            });
        } catch (error) {
            console.warn(`[polyadic-bridge] Failed to forward message to ${roomName}.`,
                describeError(error));
            await callback({
                serviceId: service.id,
                hook:      "chat-message-received",
                status:    "failed",
                payload:   { sessionId, phaseId, groupId, forwarded: false },
            });
        }
    });

    subscribe("callback-received", async (context, { callback }) => {
        const requestPayload = context.requestPayload || {};
        const roomName = normalizeText(requestPayload.room);
        const evaluations = Array.isArray(requestPayload.evaluations) ? requestPayload.evaluations : [];
        const savedMessages = [];

        if (!roomName || evaluations.length === 0) {
            await callback({
                serviceId: service.id,
                hook:      "callback-received",
                status:    "failed",
                payload:   { reason: "invalid_payload" },
            });
            return;
        }

        const storedContext = roomContext.get(roomName) || parseRoomName(roomName);
        if (!storedContext) {
            await callback({
                serviceId: service.id,
                hook:      "callback-received",
                status:    "failed",
                payload:   { reason: "unknown_room", room: roomName },
            });
            return;
        }

        if (storedContext.questionId == null) {
            storedContext.questionId = await dependencies.getFirstQuestionIdForPhase(storedContext.phaseId);
            if (storedContext.questionId == null) {
                await callback({
                    serviceId: service.id,
                    hook:      "callback-received",
                    status:    "failed",
                    payload:   { reason: "question_not_found", room: roomName },
                });
                return;
            }
        }

        for (const [evaluationIndex, evaluation] of evaluations.entries()) {
            const agentName = normalizeText(evaluation?.agente);
            const content = normalizeText(evaluation?.respuesta);

            if (!content || !isPublishableChatAgent(agentName)) {
                continue;
            }

            // The name the room shows for the agent (#1026): the guide's
            // nickname, or its default for the room's locale. A Polyadic
            // without `display_name` leaves the canonical name.
            const authorName = normalizeExternalAgentAuthorName(evaluation?.display_name) || agentName;
            const published = await publishGroupChatMessage({
                sessionId:        storedContext.sessionId,
                phaseId:          storedContext.phaseId,
                questionId:       storedContext.questionId,
                groupId:          storedContext.groupId,
                // The service's agent row keeps the canonical name, so other
                // rooms' messages keep theirs.
                agentDisplayName: agentName,
                authorName,
                content,
                // Links the message to this callback's result (#947).
                resultId:         context.resultId,
            });

            if (published?.savedMessage) {
                savedMessages.push({ message: published.savedMessage, agentName, authorName, evaluationIndex });
            }
        }

        await callback({
            serviceId: service.id,
            hook:      "callback-received",
            status:    "completed",
            payload:   {
                room:                roomName,
                evaluationsReceived: evaluations.length,
                messagesPublished:   savedMessages.length,
                // Which agent wrote each published message (#947): the
                // shared external_service_agents row keeps only the latest
                // name. `evaluationIndex` is the message's position in the
                // payload's evaluations, so the report can tell which ones
                // were not published (#949). `displayName` is the name the
                // message shows, which the chat history reads (#1026,
                // helpers/external-agent-author.js). Stored in the result's
                // adapter_result.
                publishedMessages:   savedMessages.map(({ message, agentName, authorName, evaluationIndex }) => ({
                    messageId:   message.id ?? null,
                    agentName,
                    displayName: authorName,
                    evaluationIndex,
                })),
            },
        });
    });

    subscribe("phase-ended", async (context, { callback }) => {
        const { sessionId, phaseId } = context;
        const phaseRoomsKey = getPhaseRoomsKey(sessionId, phaseId);
        const rooms = phaseRooms.get(phaseRoomsKey) || new Set();
        let roomsClosed = 0;
        // The rooms' room jobs are already closed: the registry closes them
        // before dispatching phase-ended, even when this handler does not run
        // (#833).

        for (const roomName of rooms) {
            try {
                await closePolyadicSession(roomName);
                roomsClosed++;
            } catch (error) {
                console.warn(`[polyadic-bridge] Failed to close room ${roomName}.`,
                    describeError(error));
            }
            roomContext.delete(roomName);
        }

        phaseRooms.delete(phaseRoomsKey);

        await callback({
            serviceId: service.id,
            hook:      "phase-ended",
            status:    "completed",
            payload:   { sessionId, phaseId, roomsClosed },
        });
    });

    // An administrator forgot the user (#876). Dispatched by the erasure
    // request processor (services/user-erasure/), which records the outcome
    // and retries a failure, so a failure is thrown, never swallowed.
    subscribe("user-forgotten", async (context, { callback }) => {
        const erasure = await erasePolyadicParticipant(context.userId);
        console.info(`[polyadic-bridge] Participant ${erasure.participantId} erased.`);
        const result = {
            serviceId: service.id,
            hook:      "user-forgotten",
            status:    "completed",
            payload:   erasure,
        };
        await callback(result);
        return result;
    });

    subscribe("activity-finished", async (context, { callback }) => {
        const sessionId = Number(context.sessionId);
        let roomsClosed = 0;

        for (const [roomName, storedContext] of roomContext.entries()) {
            if (storedContext.sessionId !== sessionId) {
                continue;
            }

            try {
                await closePolyadicSession(roomName);
                roomsClosed++;
            } catch (error) {
                console.warn(`[polyadic-bridge] Failed to close room ${roomName}.`,
                    describeError(error));
            }
            roomContext.delete(roomName);
        }

        for (const [phaseRoomsKey, rooms] of phaseRooms.entries()) {
            for (const roomName of rooms) {
                const parsedRoom = parseRoomName(roomName);
                if (parsedRoom?.sessionId === sessionId) {
                    phaseRooms.delete(phaseRoomsKey);
                    break;
                }
            }
        }

        await callback({
            serviceId: service.id,
            hook:      "activity-finished",
            status:    "completed",
            payload:   { sessionId, roomsClosed },
        });
    });
}
