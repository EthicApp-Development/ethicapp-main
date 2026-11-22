import * as rpg2 from "../../db/rest-pg-2.js";
import * as config from "../../config/database.config.js";
import defaultAiAdditionsClient, {
    isAiAdditionsCredentialsMissing,
    isAiAdditionsNotConfigured,
} from "../../services/ai-additions-client.service.js";
import { applicableConfiguration } from "../../../common/modules/configuration-conditions.js";
import { plainTextOf } from "../../helpers/rich-text-helper.js";
import { describeError } from "../../helpers/log-safety.js";
import { normalizeExternalAgentAuthorName } from "../../helpers/external-agent-author.js";
import { JOB_SOURCE_KIND } from "../../services/external-service-jobs.service.js";
import { readPhaseClock } from "../../helpers/phase-clock.js";
import { TIME_MODES } from "../../helpers/session-time-mode.js";
import {
    MAX_CONTRIBUTION_STRING_LENGTH,
} from "../../services/external-service-report-contributions.js";
import { PARTICIPANT_ACTIVITY_HOOK } from "../catalog.js";
import { sendRoomActivity } from "./polyadic-bridge.activity.js";
import {
    decisionIdOf,
    COVERAGE_REPORT_COLUMN_DECLARATIONS,
    DECISION_REPORT_COLUMN_DECLARATIONS,
    decisionTranscriptRows,
    hasTopicCoverage,
    resolveRoomTopics,
    storeCallbackDecisions,
} from "./polyadic-bridge.decisions.js";
import {
    caseInputRejection,
    rejectedCaseInput,
    resolveRoomCaseInputs,
    ROOM_FAILURE_REASONS,
} from "./polyadic-bridge.case-inputs.js";

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

// The session's case, read once for the topic and the case inputs. A failed
// read is kept, so that a room that requires a case input is not created
// without it.
async function lookupSessionCase(sessionId, dependencies) {
    try {
        return { caseId: await dependencies.getCaseIdBySessionId(sessionId) ?? null, error: null };
    } catch (error) {
        console.warn(`[polyadic-bridge] Unable to find the case of session ${sessionId}.`,
            describeError(error));
        return { caseId: null, error };
    }
}

async function resolveCaseText(sessionId, caseLookup, dependencies) {
    if (caseLookup.error) {
        return "";
    }
    try {
        const caseId = caseLookup.caseId;
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

// Polyadic's phase clock (#1178; ethicapp-ai-additions#259, "Phase clock" in
// polyadic-agents/README.md): the session input a room of a timed phase is
// created with, and the body of PUT /rooms/:room/sessions/active/clock after
// "+1 min". Both values are relative to the moment Polyadic receives the
// request. Polyadic answers 400 outside these bounds.
export const PHASE_CLOCK_INPUT = "phase_clock";
export const PHASE_CLOCK_MIN_DURATION_SECONDS = 60;
export const PHASE_CLOCK_MAX_DURATION_SECONDS = 86400;

function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
}

/**
 * The `phase_clock` of a room of phase `phaseId`, from the activity's clock
 * as helpers/phase-clock.js reads it, or null when the room has no clock to
 * follow: the activity is untimed (`timeMode` "none") or finished, `phaseId`
 * is not its current phase, or the phase has no duration or started before
 * V45.
 *
 * - `duration_seconds` is the phase's whole length, `endsAt - startedAt`,
 *   extensions included;
 * - `remaining_seconds` is `endsAt - serverNow`, the time left when the clock
 *   was read. It is negative after the deadline: a soft-mode phase past
 *   00:00, or a hard-mode last phase, which its deadline never finishes.
 *
 * Both are whole seconds and kept within Polyadic's bounds: the duration
 * between 60 s and 24 h, and the remaining time between -24 h and the
 * duration. Only a phase run on for most of a day reaches them.
 * @param {object|null} clock helpers/phase-clock.js `readPhaseClock()`
 * @param {number} phaseId the room's phase (`stages.id`)
 * @returns {{ duration_seconds: number, remaining_seconds: number } | null}
 */
export function buildPhaseClock(clock, phaseId) {
    if (!clock || clock.finished || clock.timeMode === TIME_MODES.NONE
        || clock.phaseId === null || clock.phaseId === undefined
        || Number(clock.phaseId) !== Number(phaseId)) {
        return null;
    }

    const startedAtMs = clock.startedAt ? Date.parse(clock.startedAt) : Number.NaN;
    const endsAtMs = clock.endsAt ? Date.parse(clock.endsAt) : Number.NaN;
    const nowMs = clock.serverNow ? Date.parse(clock.serverNow) : Number.NaN;
    if (![startedAtMs, endsAtMs, nowMs].every(Number.isFinite)) {
        return null;
    }

    const duration = clamp(Math.round((endsAtMs - startedAtMs) / 1000),
        PHASE_CLOCK_MIN_DURATION_SECONDS, PHASE_CLOCK_MAX_DURATION_SECONDS);
    const remaining = clamp(Math.round((endsAtMs - nowMs) / 1000),
        -PHASE_CLOCK_MAX_DURATION_SECONDS, duration);
    return { duration_seconds: duration, remaining_seconds: remaining };
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
 * `phase_clock` (#1178) is the phase's clock (buildPhaseClock()), sent only
 * for a timed phase; no setting replaces it either. Without it the room is
 * untimed, unless the design still stores the deprecated
 * `session_duration_seconds`, which a `phase_clock` overrides.
 * `caseInputs` (#1221) are the case's session inputs that the room's
 * configuration requires, such as the `discussion_topics` of a
 * `contentCoverage` room (polyadic-bridge.case-inputs.js), each under its
 * key; a room that requires none gets no key.
 * @param {{ topic?: string, locale?: string,
 *   serviceConfiguration?: object, pipelineType?: string,
 *   roomCorrelationId?: string|null,
 *   phaseClock?: { duration_seconds: number, remaining_seconds: number }|null,
 *   caseInputs?: Object<string, unknown>|null }} options
 */
export function buildPolyadicSessionPayload({
    topic,
    locale,
    serviceConfiguration = {},
    pipelineType = getPipelineType(),
    roomCorrelationId = null,
    phaseClock = null,
    caseInputs = null,
} = {}) {
    const payload = {
        prompt_inicial: topic || "EthicApp discussion",
        pipeline_type:  pipelineType,
        locale:         locale || DEFAULT_POLYADIC_LOCALE,
        ...configuredSettings(serviceConfiguration),
    };
    delete payload.ethicapp_room_correlation_id;
    delete payload[PHASE_CLOCK_INPUT];
    if (roomCorrelationId) {
        payload.ethicapp_room_correlation_id = roomCorrelationId;
    }
    if (phaseClock) {
        payload[PHASE_CLOCK_INPUT] = phaseClock;
    }
    if (isPlainObject(caseInputs)) {
        Object.assign(payload, caseInputs);
    }
    return payload;
}

/**
 * The configuration a room is created with, as its case inputs are judged
 * (#1221): the body buildPolyadicSessionPayload() sends, without the prompt
 * and the per-request values. `pipeline_type` is therefore the phase's
 * setting, else AI_ADDITIONS_POLYADIC_AGENTS_PIPELINE_TYPE, else
 * `abogado-del-diablo`.
 * @param {{ locale?: string, serviceConfiguration?: object }} options
 */
export function roomConfiguration({ locale, serviceConfiguration = {} } = {}) {
    const configuration = buildPolyadicSessionPayload({ locale, serviceConfiguration });
    delete configuration.prompt_inicial;
    return configuration;
}

/**
 * The phase's settings a room is created with (#1234): `serviceConfiguration`
 * without the values of the instance fields whose `applies_when` does not
 * hold. Conditions are evaluated on the configuration the room is created
 * with (roomConfiguration()), as its case inputs are, so `topic_tracking`
 * reaches Polyadic only for a `contentCoverage` room. The design keeps the
 * value, which is sent again once the field applies. Without a readable
 * descriptor, or with one that declares no `applies_when`, every setting is
 * sent, as before.
 * @param {{ descriptor: object|null, locale?: string, serviceConfiguration?: object }} options
 *   `descriptor`: Polyadic's normalized instance configuration
 *   (registry getSessionServiceInstanceConfiguration()), or null.
 */
export function applicableRoomSettings({ descriptor, locale, serviceConfiguration = {} }) {
    if (!descriptor || descriptor.available === false || !Array.isArray(descriptor.fields)) {
        return serviceConfiguration;
    }
    return applicableConfiguration(serviceConfiguration, descriptor.fields,
        roomConfiguration({ locale, serviceConfiguration }));
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
        getPhaseClock:          readPhaseClock,
        // helpers/case-session-inputs.js reads the case's analyses with its
        // own defaults (the registry's producers, case-analyses-helper.js).
        caseInputDependencies:  {},
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

// `timeoutMs` replaces the client's default timeout (12 s) for one request.
async function requestPolyadicJson(pathname, { method = "GET", body = null, timeoutMs } = {}) {
    return aiAdditionsClient.requestJson(pathname, {
        method,
        body,
        basePath:      POLYADIC_API_BASE_PATH,
        // Unauthenticated calls still need the connection: without one the
        // client rejects with `not_configured` before any request.
        authenticated: isPolyadicAuthenticated(),
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
}

// Transport failures that Node's fetch (undici) and the network stack report
// by code, on the error or on its `cause`.
const NO_ANSWER_ERROR_CODES = new Set([
    "ECONNREFUSED",
    "ECONNRESET",
    "EPIPE",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "ENOTFOUND",
    "EAI_AGAIN",
    "ETIMEDOUT",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_BODY_TIMEOUT",
    "UND_ERR_SOCKET",
]);

/**
 * Whether a request to AI Additions ended without an answer (#1227), so its
 * outcome is unknown: the service may or may not have acted on it.
 *
 * - The client aborts a request after its timeout (`AbortController`), and
 *   fetch rejects with an `AbortError` (a `TimeoutError` for a timeout
 *   signal).
 * - A connection that fails before a status arrives (refused, reset, DNS)
 *   rejects with undici's `TypeError: fetch failed`, its network code on
 *   `cause`.
 *
 * Never for an answer with an HTTP status (`statusCode`, set by the client
 * for any non-2xx), nor for EthicApp's own configuration gaps
 * (`not_configured`, `credentials_missing`), which no resend fixes.
 * @param {unknown} error
 * @returns {boolean}
 */
export function isUnansweredRequest(error) {
    if (!error || typeof error !== "object") {
        return false;
    }
    if (Number.isInteger(error.statusCode) && error.statusCode > 0) {
        return false;
    }
    if (isAiAdditionsNotConfigured(error) || isAiAdditionsCredentialsMissing(error)) {
        return false;
    }
    if (error.name === "AbortError" || error.name === "TimeoutError") {
        return true;
    }
    if (NO_ANSWER_ERROR_CODES.has(error.code) || NO_ANSWER_ERROR_CODES.has(error.cause?.code)) {
        return true;
    }
    return error instanceof TypeError;
}

// An error that says why a room was not created (#1221), kept on its room job.
function roomCreationFailure(reason, details, cause) {
    return Object.assign(new Error(`The Polyadic room was not created: ${reason}.`), {
        roomFailure: { reason, ...details },
        statusCode:  cause?.statusCode,
        cause,
    });
}

// Why a room creation failed, from its error.
function roomFailureOf(error) {
    if (error?.roomFailure) {
        return error.roomFailure;
    }
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : null;
    return {
        reason: ROOM_FAILURE_REASONS.SESSION_CREATION_FAILED,
        ...(statusCode ? { statusCode } : {}),
    };
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

// How many times one room creation is sent when it gets no answer (#1227):
// the request and one resend.
const ROOM_CREATION_ATTEMPTS = 2;

/**
 * Sends one room creation, `POST /rooms/{room}/sessions` with
 * `bodyOf(phaseClock)`, and resolves to `{ response, phaseClock }`.
 *
 * A request without an answer (isUnansweredRequest()) leaves the outcome
 * unknown: Polyadic may have created the room after EthicApp stopped waiting.
 * It is sent once more with the same body, so with the same room correlation
 * id, its clock read again. Creation is idempotent in Polyadic: for a running
 * room it answers `ya_inicializado` and stores and echoes the id it was sent,
 * which binds the same room job. A second request without an answer rejects
 * with a `roomFailure` `session_creation_timed_out`.
 *
 * Each request keeps the client's timeout (AI_ADDITIONS_HTTP_TIMEOUT_MS,
 * 12 s by default) rather than a longer one: a resend reaches a room that
 * Polyadic registered before its welcome, so it answers without waiting for
 * the model, and an unreachable Polyadic already costs the phase start two
 * timeouts per room, its rooms being created one after another.
 *
 * An answer with an HTTP status, or any other error, rejects at once as the
 * client reported it, whether the request or the resend got it.
 */
async function sendRoomCreation(roomName, path, resolvePhaseClock, bodyOf) {
    for (let attempt = 1; ; attempt += 1) {
        const phaseClock = await resolvePhaseClock();
        try {
            const response = await requestPolyadicJson(path, {
                method: "POST",
                body:   bodyOf(phaseClock),
            });
            return { response, phaseClock };
        } catch (error) {
            if (!isUnansweredRequest(error)) {
                throw error;
            }
            if (attempt >= ROOM_CREATION_ATTEMPTS) {
                throw roomCreationFailure(
                    ROOM_FAILURE_REASONS.SESSION_CREATION_TIMED_OUT, {}, error);
            }
            console.warn(`[polyadic-bridge] Polyadic did not answer the creation of ${roomName}; `
                + "sending it again with the same room job.", describeError(error));
        }
    }
}

/**
 * Creates the Polyadic session of a room and returns Polyadic's lifecycle
 * report, `{ warnings, degraded, configurationRejected }` (#735, recorded by
 * #737), and whether Polyadic acknowledged the room correlation id (#833).
 * Polyadic answers 400 when a configured value fails its format rules,
 * which a design saved before a rule tightened can still hold (#731 accepts it
 * with a warning). The room is then created once more without the configured
 * settings, so the group still gets its agent, and `configurationRejected` says so.
 *
 * `resolvePhaseClock` gives the room's `phase_clock` (#1178), or null. It is
 * called right before each request is sent, the retry included, so that
 * `remaining_seconds` is the time left when Polyadic receives it. The clock
 * sent is returned as `phaseClock`.
 *
 * `caseInputs` (#1221) is the room's resolveRoomCaseInputs() result: its
 * `values` go into the body. The retry without the configured settings would
 * create the room in another mode, so it never runs for a 400 that names a
 * case input, nor for a configuration that requires one: the creation then
 * fails with a `roomFailure` (`case_input_rejected` or
 * `configuration_rejected`).
 *
 * A request that gets no answer (#1227) is sent once more, unchanged but for
 * its clock (sendRoomCreation()), and a second one without an answer fails
 * the creation with `session_creation_timed_out`. The retry without the
 * configured settings follows only an answered 400, never a timeout.
 */
async function ensurePolyadicSession(roomName, {
    topic, locale, serviceConfiguration, roomCorrelationId = null,
    resolvePhaseClock = async () => null,
    caseInputs = null,
}) {
    const path = `/rooms/${encodeURIComponent(roomName)}/sessions`;

    try {
        const { response, phaseClock } = await sendRoomCreation(roomName, path, resolvePhaseClock,
            clock => buildPolyadicSessionPayload({
                topic, locale, serviceConfiguration, roomCorrelationId, phaseClock: clock,
                caseInputs: caseInputs?.values ?? null,
            }));
        console.info(`[polyadic-bridge] Polyadic session ready for ${roomName}.`);
        return creationOutcome(response, roomCorrelationId, {
            configurationRejected: false,
            phaseClock,
        });
    } catch (error) {
        if (rejectedCaseInput(error, caseInputs?.keys ?? [])) {
            throw roomCreationFailure(ROOM_FAILURE_REASONS.CASE_INPUT_REJECTED, {
                rejection: caseInputRejection(error),
            }, error);
        }
        const hasConfiguration = Object.keys(configuredSettings(serviceConfiguration)).length > 0;
        if (Number(error?.statusCode) !== 400 || !hasConfiguration) {
            throw error;
        }
        if (caseInputs?.required) {
            throw roomCreationFailure(ROOM_FAILURE_REASONS.CONFIGURATION_REJECTED, {
                rejection: error.responseBody ?? null,
            }, error);
        }

        console.warn(`[polyadic-bridge] Polyadic rejected the configured settings for ${roomName}; `
            + "creating the session with EthicApp's defaults.", error.responseBody ?? error);
        const { response, phaseClock } = await sendRoomCreation(roomName, path, resolvePhaseClock,
            clock => buildPolyadicSessionPayload({
                topic, locale, roomCorrelationId, phaseClock: clock,
            }));
        console.info(`[polyadic-bridge] Polyadic session ready for ${roomName} without configured settings.`);
        return creationOutcome(response, roomCorrelationId, {
            configurationRejected: true,
            rejection:             error.responseBody ?? null,
            phaseClock,
        });
    }
}

/**
 * Sends a running room its phase's new clock (#1178):
 * `PUT /rooms/{room}/sessions/active/clock` with `{ phase_clock }`. Resolves
 * to `"updated"`, or `"not_running"` when Polyadic answers 404 because the
 * room has no running session (it was never created, or it was closed).
 * Rejects with the client's error otherwise.
 */
async function updatePolyadicPhaseClock(roomName, phaseClock) {
    try {
        await requestPolyadicJson(`/rooms/${encodeURIComponent(roomName)}/sessions/active/clock`, {
            method: "PUT",
            body:   { [PHASE_CLOCK_INPUT]: phaseClock },
        });
    } catch (error) {
        if (Number(error?.statusCode) === 404) {
            return "not_running";
        }
        throw error;
    }
    console.info(`[polyadic-bridge] Phase clock sent to ${roomName}.`);
    return "updated";
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
    // Declared with the decision columns (#1226): only a transcript whose
    // session has mediation decisions gets it.
    DECISION_ID:         "polyadic_agent_decision_id",
});

const REPORT_COLUMN_DECLARATIONS = Object.freeze([
    { id: REPORT_COLUMNS.AGENT_NAME,          label: "Polyadic agent" },
    { id: REPORT_COLUMNS.TRIGGER,             label: "Polyadic agent trigger" },
    { id: REPORT_COLUMNS.IN_REPLY_TO,         label: "Student message answered" },
    { id: REPORT_COLUMNS.VISIBLE_TO_STUDENTS, label: "Visible to students" },
]);

const DECISION_ID_COLUMN_DECLARATION = Object.freeze({
    id:    REPORT_COLUMNS.DECISION_ID,
    label: "Decision that made the agent speak",
});

// What made an agent speak. Polyadic says it in each callback evaluation's
// `trigger.kind` (ethicapp-ai-additions#303): `session_start`,
// `time_milestone`, `inactivity`, `mention`, `message`, or the window step's
// kind (`adaptive_window`, `window_full`); the export gives the kind
// verbatim. An evaluation without `trigger` (an older Polyadic, or a callback
// stored before it sent one) falls back to what EthicApp can tell from the
// callback: a reactive reply carries the correlation id of the student
// message it answers, the id of that message's chat-message-received job,
// whose `source` names the message (#946). Every other such callback is
// `unknown`: on the room job's correlation id (#833) Polyadic sends its
// proactive interventions (welcome, time milestones, inactivity), but also
// the replies of its window events, which answer the room's recent messages;
// and a callback without a job (before #833) may be either too. A `trigger`
// whose kind is not an identifier is `unknown` too.
export const AGENT_TRIGGER = Object.freeze({
    REACTIVE: "reactive",
    UNKNOWN:  "unknown",
});

// The shape of Polyadic's trigger kinds, as `mediation-decision/v1` gives
// its `trigger.kind`.
const TRIGGER_KIND_PATTERN = /^[a-z][a-z0-9_]*$/u;
const MAX_TRIGGER_KIND_LENGTH = 64;

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

function isTriggerKind(value) {
    return typeof value === "string" && value.length <= MAX_TRIGGER_KIND_LENGTH
        && TRIGGER_KIND_PATTERN.test(value);
}

// What made one evaluation's agent speak (#1226): the evaluation's own
// `trigger.kind` and `trigger.decision_id` when it carries a `trigger`, else
// the callback's (triggerOf()). The answered message always comes from the
// callback's job. `evaluation` is undefined when the row's evaluation cannot
// be told, as for messages published before #949.
function evaluationTriggerOf(evaluation, result) {
    const callbackTrigger = triggerOf(result);
    const trigger = isPlainObject(evaluation) ? evaluation.trigger : undefined;
    if (trigger === undefined || trigger === null) {
        return { ...callbackTrigger, decisionId: null };
    }
    return {
        trigger:    isTriggerKind(trigger?.kind) ? trigger.kind : AGENT_TRIGGER.UNKNOWN,
        inReplyTo:  callbackTrigger.inReplyTo,
        decisionId: isPlainObject(trigger) ? decisionIdOf(trigger.decision_id) : null,
    };
}

// The bridge's agent columns of a row; the decision link only in a
// transcript that declares it.
function agentValues({
    agentName, trigger, inReplyTo, decisionId = null, visible,
}, { withDecisions }) {
    return {
        [REPORT_COLUMNS.AGENT_NAME]:          reportText(agentName),
        [REPORT_COLUMNS.TRIGGER]:             trigger,
        [REPORT_COLUMNS.IN_REPLY_TO]:         inReplyTo,
        [REPORT_COLUMNS.VISIBLE_TO_STUDENTS]: visible,
        ...(withDecisions ? { [REPORT_COLUMNS.DECISION_ID]: decisionId } : {}),
    };
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

// The evaluations of a callback that the handler did not publish, each once,
// with their position in `evaluations`: those of agents that do not speak in
// the chat, and those of chat agents whose publication failed. Evaluations
// without text are skipped, as the handler skips them. Each published message
// names the evaluation it came from (`evaluationIndex`); when any entry of
// the result lacks it, the evaluations are matched by agent instead
// (unpublishedByAgent()).
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

    return unpublished.map(({ index, agentName, content }) => ({ index, agentName, content }));
}

// The author of an unpublished evaluation's row (#1228): the name the room
// shows for the agent, as its published messages do (#1026), else its
// canonical name. Undefined, so the row is the service's, when the
// evaluation names neither.
function unpublishedAuthorNameOf(evaluation, agentName) {
    return normalizeExternalAgentAuthorName(evaluation?.display_name)
        || normalizeExternalAgentAuthorName(agentName)
        || undefined;
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
 *   trigger of the evaluation it came from (#1226), the student message it
 *   answered when known, and `visible_to_students = true`; in a session with
 *   mediation decisions, also the decision that made the agent speak.
 *   Messages published before #947 have no link and get no values. The
 *   agent is the one the callback recorded, unless that name is not a chat
 *   agent's: then the erasure redacted the result of an anonymized student
 *   (V31), and the message row's agent (`externalAgentName`) names it
 *   (#1155).
 * - Each evaluation a handled callback received but did not publish becomes
 *   a row at the result's `receivedAt`, with the same columns and
 *   `visible_to_students = false`. Published evaluations are already rows of
 *   the transcript and are never added again. The row's author (#1228) is
 *   the name the room shows for the agent, else the agent's canonical name.
 * - A session with mediation decisions also gets their rows (#1222), each
 *   authored by its deciding agent, and a row per room's topic list,
 *   authored by no agent.
 *
 * `mensajes_evaluados` is not exported: it repeats the students' messages
 * under their display names.
 */
export function buildChatTranscriptContribution(context, storedResults, {
    decisions = [],
    roomTopics = new Map(),
} = {}) {
    const serviceId = context.serviceId;
    const withDecisions = decisions.length > 0;
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
        for (const row of ownRows) {
            const published = handled.publishedMessages
                .find(entry => entry?.messageId !== null && entry?.messageId !== undefined
                    && String(entry.messageId) === String(row.messageId));
            // The evaluation the message came from (#949), for its trigger.
            const evaluation = isEvaluationIndex(published?.evaluationIndex, handled.evaluations)
                ? handled.evaluations[published.evaluationIndex]
                : undefined;
            values.push({
                rowKey: row.messageId,
                values: agentValues({
                    agentName: publishedAgentName(published, row),
                    ...evaluationTriggerOf(evaluation, handled.result),
                    visible:   true,
                }, { withDecisions }),
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
        for (const { index, agentName, content } of unpublished) {
            const authorName = unpublishedAuthorNameOf(evaluations[index], agentName);
            rows.push({
                ...placement,
                time:    time.toISOString(),
                message: reportText(content),
                ...(authorName ? { authorName } : {}),
                values:  agentValues({
                    agentName,
                    ...evaluationTriggerOf(evaluations[index], result),
                    visible: false,
                }, { withDecisions }),
            });
        }
    }

    // The mediation decisions (#1222) add their columns and rows only when
    // the session has any, so every other transcript stays as it was.
    if (!withDecisions) {
        return {
            columns: REPORT_COLUMN_DECLARATIONS.map(column => ({ ...column })),
            values,
            rows,
        };
    }
    // A decision row's own trigger is in its decision columns.
    const decisionRows = decisionTranscriptRows(decisions, roomTopics, decision => agentValues({
        agentName: decision.record?.agent,
        trigger:   null,
        inReplyTo: null,
        visible:   false,
    }, { withDecisions }));
    // The topic coverage (#1233) adds its columns only when a decision of
    // the session carries one.
    return {
        columns: [
            ...REPORT_COLUMN_DECLARATIONS,
            DECISION_ID_COLUMN_DECLARATION,
            ...DECISION_REPORT_COLUMN_DECLARATIONS,
            ...(hasTopicCoverage(decisions) ? COVERAGE_REPORT_COLUMN_DECLARATIONS : []),
        ].map(column => ({ ...column })),
        values,
        rows: [...rows, ...decisionRows],
    };
}

// The `report-building` handler: the chat transcript only, from the results
// reader the collecting dispatch hands it. It reads EthicApp's database
// only: the stored results and mediation decisions through the reader, and
// the case's topic listing for the names of the rooms' topics (#1222).
// `deps.getCaseAnalysis` replaces that read in tests.
export async function contributeToReport(context, { results }, deps = {}) {
    if (context.reportType !== "chat_transcript") {
        return null;
    }
    const [storedResults, decisions] = await Promise.all([
        results.list(),
        typeof results.mediationDecisions === "function" ? results.mediationDecisions() : [],
    ]);
    const roomTopics = decisions.length > 0 ? await resolveRoomTopics(decisions, deps) : new Map();
    return buildChatTranscriptContribution(context, storedResults, { decisions, roomTopics });
}

// Without room jobs (a registry that provides none), rooms are created without
// a room correlation id, as before #833.
const NO_ROOM_JOBS = Object.freeze({
    create: async () => null,
    open:   async () => false,
    fail:   async () => {},
});

// Without the registry's access to the descriptor, no session input is
// declared, so no `phase_clock` and no case input is sent.
const NO_SESSION_INPUTS = Object.freeze({
    declares:   async () => false,
    descriptor: async () => null,
});

const CASE_INPUT_FAILURES = new Set([
    ROOM_FAILURE_REASONS.MISSING_CASE_INPUTS,
    ROOM_FAILURE_REASONS.CASE_INPUTS_UNREADABLE,
    ROOM_FAILURE_REASONS.CASE_INPUT_REJECTED,
    ROOM_FAILURE_REASONS.CONFIGURATION_REJECTED,
]);

// What a room job records about its room (#1221), in its
// `instantiation_report`: Polyadic's report and the case inputs sent, or why
// the room was not created.
function roomJobReport({ outcome = null, caseInputs = null, failure = null }) {
    return {
        warnings:              outcome?.warnings ?? [],
        degraded:              outcome?.degraded === true,
        configurationRejected: outcome?.configurationRejected === true,
        ...(caseInputs?.sent?.length > 0 ? { caseInputs: caseInputs.sent } : {}),
        ...(failure ? { failure } : {}),
    };
}

export async function register({
    service,
    subscribe,
    publishGroupChatMessage,
    aiAdditionsClient: providedAiAdditionsClient,
    roomJobs = NO_ROOM_JOBS,
    sessionInputs = NO_SESSION_INPUTS,
    // Stored mediation decisions (#1222); without it, the records of a
    // callback are validated but not stored.
    mediationDecisions = null,
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

    // Polyadic's normalized instance configuration under the session's
    // pinned AI service policy, for its case inputs (#1221), or null when it
    // cannot be read: the room then gets no case input, and Polyadic still
    // refuses a room whose mode requires one.
    async function caseInputsDescriptor(sessionId) {
        if (typeof sessionInputs.descriptor !== "function") {
            return null;
        }
        try {
            return await sessionInputs.descriptor({ sessionId });
        } catch (error) {
            console.warn("[polyadic-bridge] Could not read Polyadic's session inputs; "
                + "creating rooms without case inputs.", describeError(error));
            return null;
        }
    }

    // The case inputs of the phase's rooms (#1221), resolved once for them
    // all with helpers/case-session-inputs.js, under the configuration the
    // rooms are created with.
    async function resolvePhaseCaseInputs({
        sessionId, descriptor, caseLookup, locale, serviceConfiguration,
    }) {
        const caseInputs = await resolveRoomCaseInputs({
            descriptor,
            configuration: roomConfiguration({ locale, serviceConfiguration }),
            caseId:        caseLookup.caseId,
            caseIdError:   caseLookup.error,
            deps:          dependencies.caseInputDependencies,
        });
        if (caseInputs.error) {
            console.warn("[polyadic-bridge] Could not read the case inputs of session "
                + `${sessionId}.`, describeError(caseInputs.error));
        }
        return caseInputs;
    }

    // What every room of a phase is created with: the topic, the locale and
    // the question, the case inputs its configuration requires, and the
    // phase's settings that apply to it (applicableRoomSettings(), #1234).
    async function buildRoomInputs(sessionId, phaseId, serviceConfiguration) {
        const caseLookup = await lookupSessionCase(sessionId, dependencies);
        const caseText = await resolveCaseText(sessionId, caseLookup, dependencies);
        const question = await dependencies.getFirstQuestionForPhase(phaseId);
        const questionText = formatQuestionText(question);
        const fallbackTopic = `EthicApp session ${sessionId} phase ${phaseId}`;
        const { locale } = await resolveSessionLanguageContext(sessionId);
        const descriptor = await caseInputsDescriptor(sessionId);
        const caseInputs = await resolvePhaseCaseInputs({
            sessionId, descriptor, caseLookup, locale, serviceConfiguration,
        });
        const settings = applicableRoomSettings({ descriptor, locale, serviceConfiguration });

        return {
            questionId: question?.id ?? null,
            topic:      composeTopic(caseText || fallbackTopic, questionText),
            locale,
            caseInputs,
            serviceConfiguration: settings,
        };
    }

    // Whether Polyadic's descriptor declares `session_inputs.phase_clock`
    // (#1178). An older Polyadic does not, and would report a room created
    // with it as degraded, so EthicApp sends it no clock. The descriptor is
    // cached by the registry (capability-descriptors.service.js).
    async function acceptsPhaseClock() {
        try {
            return await sessionInputs.declares(PHASE_CLOCK_INPUT) === true;
        } catch (error) {
            console.warn("[polyadic-bridge] Could not read whether Polyadic accepts a phase clock; "
                + "sending none.", describeError(error));
            return false;
        }
    }

    // The `phase_clock` for a room of phase `phaseId`, read from the
    // database when it is called, or null: an untimed phase, a phase that is
    // no longer current, or a Polyadic that does not accept it. A failed read
    // sends no clock rather than no room.
    async function phaseClockFor(sessionId, phaseId) {
        if (!await acceptsPhaseClock()) {
            return null;
        }
        try {
            return buildPhaseClock(await dependencies.getPhaseClock(sessionId), phaseId);
        } catch (error) {
            console.warn("[polyadic-bridge] Could not read the phase clock of session "
                + `${sessionId}; creating the room without one.`, describeError(error));
            return null;
        }
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

    // A room that was not created: its room job fails and records why
    // (#1221), so the failure stays visible after the request.
    async function failRoom({ roomName, roomJobId, caseInputs, failure, error = null }) {
        roomContext.delete(roomName);
        console.warn(`[polyadic-bridge] Failed to create polyadic room ${roomName}: `
            + `${failure.reason}.`, error ? describeError(error) : "");
        await settleRoomJob(roomJobId, roomName,
            id => roomJobs.fail(id, { report: roomJobReport({ caseInputs, failure }) }));
        return { roomName, roomJobId, failure };
    }

    // Creates the room with a new room job, whose id it sends to Polyadic.
    // Once the room exists the job opens, bound when Polyadic echoed the id,
    // and supersedes the room's older room jobs; when the room could not be
    // created it fails. Returns `{ roomName, roomJobId, warnings, degraded,
    // configurationRejected, caseInputs? }`, or `{ roomName, roomJobId,
    // failure }` when the room could not be created. A room whose required
    // case input is missing is never requested (#1221).
    async function createRoom({
        hookName, sessionId, phaseId, groupId, questionId, caseInputs = null, ...sessionOptions
    }) {
        const roomName = getRoomName(sessionId, phaseId, groupId);
        rememberRoomContext(roomName, sessionId, phaseId, groupId, questionId);
        const roomJob = await createRoomJob(hookName, {
            sessionId, phaseId, groupId, questionId: questionId ?? null, room: roomName,
        });
        const roomJobId = roomJob?.id ?? null;

        if (caseInputs?.failure) {
            return failRoom({ roomName, roomJobId, caseInputs, failure: caseInputs.failure });
        }

        let outcome;
        try {
            outcome = await ensurePolyadicSession(roomName, {
                ...sessionOptions,
                caseInputs,
                roomCorrelationId: roomJobId,
                resolvePhaseClock: () => phaseClockFor(sessionId, phaseId),
            });
        } catch (error) {
            return failRoom({
                roomName, roomJobId, caseInputs, failure: roomFailureOf(error), error,
            });
        }

        const { roomCorrelationAcknowledged, ...report } = outcome;
        const sent = caseInputs?.sent ?? [];
        // Only a room created with case inputs gets a report on its room job,
        // so the others' room jobs stay as they were.
        const openOptions = sent.length > 0
            ? { bound: roomCorrelationAcknowledged, report: roomJobReport({ outcome, caseInputs }) }
            : { bound: roomCorrelationAcknowledged };
        await settleRoomJob(roomJobId, roomName, id => roomJobs.open(id, openOptions));
        return { roomName, roomJobId, ...report, ...(sent.length > 0 ? { caseInputs: sent } : {}) };
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
    // `phaseClock`, the clock the room was created with (#1178), only for a
    // timed room.
    function roomReports(rooms) {
        return rooms.map(({
            roomName, warnings, degraded, configurationRejected, rejection, phaseClock, caseInputs,
        }) => ({
            room: roomName,
            warnings,
            degraded,
            configurationRejected,
            ...(configurationRejected ? { rejection: rejection ?? null } : {}),
            ...(phaseClock ? { phaseClock } : {}),
            ...(caseInputs ? { caseInputs } : {}),
        }));
    }

    // The rooms that were not created and why (#1221), for the job result.
    function failedRoomReports(rooms) {
        return rooms.map(({ roomName, failure }) => ({ room: roomName, ...failure }));
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
        const roomInputs = await buildRoomInputs(sessionId, phaseId, serviceConfiguration);
        // Rooms are tracked as they are created, so a chat message in a room
        // already created does not create it again.
        const createdRooms = new Set();
        phaseRooms.set(getPhaseRoomsKey(sessionId, phaseId), createdRooms);
        const created = [];
        const failed = [];

        for (const groupId of teamIds) {
            const room = await createRoomOnce({
                hookName: "phase-started",
                sessionId,
                phaseId,
                groupId,
                ...roomInputs,
            });
            if (room?.failure) {
                failed.push(room);
            } else if (room) {
                createdRooms.add(room.roomName);
                created.push(room);
            }
        }

        await reportRooms(created, reportInstantiation);

        // A room that could not get its case inputs fails the job (#1221):
        // the phase's configuration cannot run, and no room runs another mode.
        const caseInputsFailed = failed.some(room => CASE_INPUT_FAILURES.has(room.failure.reason));
        await callback({
            serviceId: service.id,
            hook:      "phase-started",
            status:    caseInputsFailed ? "failed" : "completed",
            payload:   {
                sessionId,
                phaseId,
                roomsCreated: createdRooms.size,
                rooms:        roomReports(created),
                ...(failed.length > 0 ? { roomsFailed: failedRoomReports(failed) } : {}),
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
            const roomInputs = await buildRoomInputs(sessionId, phaseId, serviceConfiguration);
            const createdRoom = await createRoomOnce({
                hookName:   "chat-message-received",
                sessionId,
                phaseId,
                groupId,
                ...roomInputs,
                questionId: questionId ?? roomInputs.questionId,
            });

            // The message is not forwarded; the group's next message tries to
            // create the room again.
            if (!createdRoom || createdRoom.failure) {
                const failure = createdRoom?.failure
                    ?? { reason: ROOM_FAILURE_REASONS.SESSION_CREATION_FAILED };
                await callback({
                    serviceId: service.id,
                    hook:      "chat-message-received",
                    status:    "failed",
                    payload:   { sessionId, phaseId, groupId, ...failure },
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
        // A `contentCoverage` room adds its Validator's decisions (#1222);
        // after a silent window the callback carries only them.
        const carriesDecisions = Object.hasOwn(requestPayload, "decisions");
        const decisions = Array.isArray(requestPayload.decisions) ? requestPayload.decisions : [];
        const savedMessages = [];

        if (!roomName || (evaluations.length === 0 && decisions.length === 0)) {
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

        const decisionsOutcome = carriesDecisions
            ? await storeCallbackDecisions({
                decisions,
                room:      roomName,
                placement: {
                    sessionId:  storedContext.sessionId,
                    phaseId:    storedContext.phaseId,
                    questionId: storedContext.questionId ?? null,
                    groupId:    storedContext.groupId,
                },
                jobId:     context.jobId ?? null,
                resultId:  context.resultId ?? null,
                savedMessages,
                store:     mediationDecisions,
            })
            : null;
        // A callback with decisions only did its work when one was stored, or
        // had been stored by an earlier delivery.
        const decisionsOnlyFailed = evaluations.length === 0 && decisionsOutcome
            && decisionsOutcome.stored.length + decisionsOutcome.duplicates.length === 0;

        await callback({
            serviceId: service.id,
            hook:      "callback-received",
            status:    decisionsOnlyFailed ? "failed" : "completed",
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
                // What became of the callback's decisions (#1222): ids,
                // indexes and problem codes, never their text. Only in the
                // result of a callback that carried `decisions`.
                ...(decisionsOutcome ? { decisions: decisionsOutcome } : {}),
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

    // The teacher added a minute to the phase's deadline (#1112, #1178):
    // each running room of the phase gets the new clock. The rooms are the
    // phase's groups, read from the database, so rooms created before a
    // restart are included; one without a running session answers 404 and
    // is counted as not running. A room still being created gets the clock
    // once its creation settles, since the creation may have read the old
    // deadline. Each clock is read right before its request. A failure is
    // logged and reported, and the extension stands.
    subscribe("phase-clock-changed", async (context, { callback }) => {
        const { sessionId, phaseId } = context;
        const result = (status, payload) => callback({
            serviceId: service.id,
            hook:      "phase-clock-changed",
            status,
            payload:   { sessionId, phaseId, ...payload },
        });

        if (!await acceptsPhaseClock()) {
            await result("skipped", { reason: "phase_clock_not_supported" });
            return;
        }

        const teamIds = await dependencies.getTeamIdsForPhase(sessionId, phaseId);
        const rooms = [];
        for (const groupId of teamIds) {
            const roomName = getRoomName(sessionId, phaseId, groupId);
            await roomCreations.get(roomName)?.catch(() => null);

            let phaseClock;
            try {
                phaseClock = buildPhaseClock(await dependencies.getPhaseClock(sessionId), phaseId);
            } catch (error) {
                console.warn("[polyadic-bridge] Could not read the phase clock of session "
                    + `${sessionId}.`, describeError(error));
                rooms.push({ room: roomName, outcome: "failed" });
                continue;
            }
            if (!phaseClock) {
                // The phase is over or has no clock any more: nothing to send.
                await result("skipped", { reason: "no_phase_clock", rooms });
                return;
            }

            try {
                const outcome = await updatePolyadicPhaseClock(roomName, phaseClock);
                rooms.push({ room: roomName, outcome, phaseClock });
            } catch (error) {
                console.warn(`[polyadic-bridge] Failed to send the phase clock to ${roomName}.`,
                    describeError(error));
                rooms.push({ room: roomName, outcome: "failed", phaseClock });
            }
        }

        const count = outcome => rooms.filter(room => room.outcome === outcome).length;
        await result(count("failed") > 0 ? "failed" : "completed", {
            roomsUpdated:    count("updated"),
            roomsNotRunning: count("not_running"),
            roomsFailed:     count("failed"),
            rooms,
        });
    });

    // A participant is writing in the group's chat (epic #601, #657): an
    // ephemeral hook, so the handler receives its context only and reports
    // nothing. The signal goes only to a room the bridge already knows and
    // has finished creating; activity alone never opens a room, and a room
    // still being created is skipped, not awaited. After a restart the bridge
    // knows no room until the group's next message, which remains the
    // baseline activity. A 404 means the room is not running; any other
    // failure, a timeout included, is logged at debug level without content
    // and swallowed.
    subscribe(PARTICIPANT_ACTIVITY_HOOK, async context => {
        const { sessionId, phaseId, groupId } = context;
        const roomName = getRoomName(sessionId, phaseId, groupId);
        if (roomCreations.has(roomName)
            || !phaseRooms.get(getPhaseRoomsKey(sessionId, phaseId))?.has(roomName)) {
            return;
        }

        try {
            await sendRoomActivity(requestPolyadicJson, roomName, context);
        } catch (error) {
            const { name, code, statusCode } = describeError(error);
            console.debug(`[polyadic-bridge] Could not send participant activity to ${roomName}.`,
                { name, code, statusCode });
        }
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
