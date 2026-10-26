import * as rpg2 from "../../db/rest-pg-2.js";
import * as config from "../../config/database.config.js";
import defaultAiAdditionsClient from "../../services/ai-additions-client.service.js";
import { plainTextOf } from "../../helpers/rich-text-helper.js";

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

const AGENT_NICKNAMES = {
    en_US: "@agent",
    es_CL: "@agente",
};
const DEFAULT_AGENT_NICKNAME = AGENT_NICKNAMES.es_CL;

// Polyadic's `locale` (#735; replaces the deprecated `idioma` alias).
const POLYADIC_LOCALES = {
    en_US: "en-US",
    es_CL: "es-CL",
};
const DEFAULT_POLYADIC_LOCALE = POLYADIC_LOCALES.es_CL;

function isEnglishLanguageCode(languageCode) {
    return normalizeText(languageCode).toLowerCase().startsWith("en");
}

export function resolveAgentNickname(languageCode) {
    const normalized = normalizeText(languageCode);
    if (AGENT_NICKNAMES[normalized]) {
        return AGENT_NICKNAMES[normalized];
    }

    return isEnglishLanguageCode(normalized) ? AGENT_NICKNAMES.en_US : DEFAULT_AGENT_NICKNAME;
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
 * first: the deployment pipeline (AI_ADDITIONS_POLYADIC_AGENTS_PIPELINE_TYPE),
 * and the guide nickname and `locale` from the design language. The phase's
 * configured settings (#734), validated against the capability descriptor on
 * save (#731), replace them and add any other instance field (`llm_tier`,
 * `session_duration_seconds`, ...). Fields left unset take Polyadic's defaults.
 * `ethicapp_room_correlation_id` (#833) is the id of the room's room job, which
 * Polyadic uses for the room's proactive callbacks; no setting replaces it.
 * @param {{ topic?: string, agentNickname?: string, locale?: string,
 *   serviceConfiguration?: object, pipelineType?: string,
 *   roomCorrelationId?: string|null }} options
 */
export function buildPolyadicSessionPayload({
    topic,
    agentNickname,
    locale,
    serviceConfiguration = {},
    pipelineType = getPipelineType(),
    roomCorrelationId = null,
} = {}) {
    const payload = {
        prompt_inicial: topic || "EthicApp discussion",
        pipeline_type:  pipelineType,
        agent_nickname: agentNickname || DEFAULT_AGENT_NICKNAME,
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
    topic, agentNickname, locale, serviceConfiguration, roomCorrelationId = null,
}) {
    const path = `/rooms/${encodeURIComponent(roomName)}/sessions`;
    const body = buildPolyadicSessionPayload({
        topic, agentNickname, locale, serviceConfiguration, roomCorrelationId,
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
        const fallback = buildPolyadicSessionPayload({ topic, agentNickname, locale, roomCorrelationId });
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

async function forwardChatMessage(roomName, username, content, correlationId) {
    await requestPolyadicJson(`/rooms/${encodeURIComponent(roomName)}/messages`, {
        method: "POST",
        body:   {
            username,
            content,
            ethicapp_correlation_id: correlationId ?? null,
        },
    });

    console.info(`[polyadic-bridge] Message forwarded to ${roomName}.`);
    return true;
}

// Without room jobs (a registry that provides none), rooms are created without
// a room correlation id, as before #833.
const NO_ROOM_JOBS = Object.freeze({
    create: async () => null,
    open:   async () => false,
    fail:   async () => {},
    close:  async () => 0,
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
            return {
                agentNickname: resolveAgentNickname(languageCode),
                locale:        resolvePolyadicLocale(languageCode),
            };
        } catch (error) {
            console.warn(`[polyadic-bridge] Unable to resolve conversation language for session ${sessionId}; using defaults.`, error);
            return {
                agentNickname: DEFAULT_AGENT_NICKNAME,
                locale:        DEFAULT_POLYADIC_LOCALE,
            };
        }
    }

    async function buildTopicForPhase(sessionId, phaseId) {
        const caseText = await resolveCaseText(sessionId, dependencies);
        const question = await dependencies.getFirstQuestionForPhase(phaseId);
        const questionText = formatQuestionText(question);
        const fallbackTopic = `EthicApp session ${sessionId} phase ${phaseId}`;
        const { agentNickname, locale } = await resolveSessionLanguageContext(sessionId);

        return {
            questionId: question?.id ?? null,
            topic:      composeTopic(caseText || fallbackTopic, questionText),
            agentNickname,
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
            console.warn(`[polyadic-bridge] Failed to create polyadic room ${roomName}.`, error);
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

    async function closeRoomJobs(scope) {
        try {
            return await roomJobs.close(scope);
        } catch (error) {
            console.error("[polyadic-bridge] Could not close room jobs.", scope, error);
            return 0;
        }
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
            await forwardChatMessage(roomName, polyadicUsername, content, correlationId);
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
            console.warn(`[polyadic-bridge] Failed to forward message to ${roomName}.`, error);
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

        for (const evaluation of evaluations) {
            const agentName = normalizeText(evaluation?.agente);
            const content = normalizeText(evaluation?.respuesta);

            if (!content || !isPublishableChatAgent(agentName)) {
                continue;
            }

            const published = await publishGroupChatMessage({
                sessionId:        storedContext.sessionId,
                phaseId:          storedContext.phaseId,
                questionId:       storedContext.questionId,
                groupId:          storedContext.groupId,
                agentDisplayName: agentName,
                content,
            });

            if (published?.savedMessage) {
                savedMessages.push(published.savedMessage);
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
            },
        });
    });

    subscribe("phase-ended", async (context, { callback }) => {
        const { sessionId, phaseId } = context;
        const phaseRoomsKey = getPhaseRoomsKey(sessionId, phaseId);
        const rooms = phaseRooms.get(phaseRoomsKey) || new Set();
        let roomsClosed = 0;
        // First, so the rooms' callbacks are refused from now on, including
        // rooms this process no longer tracks (#833).
        const roomJobsClosed = await closeRoomJobs({ sessionId, phaseId });

        for (const roomName of rooms) {
            try {
                await closePolyadicSession(roomName);
                roomsClosed++;
            } catch (error) {
                console.warn(`[polyadic-bridge] Failed to close room ${roomName}.`, error);
            }
            roomContext.delete(roomName);
        }

        phaseRooms.delete(phaseRoomsKey);

        await callback({
            serviceId: service.id,
            hook:      "phase-ended",
            status:    "completed",
            payload:   { sessionId, phaseId, roomsClosed, roomJobsClosed },
        });
    });

    subscribe("activity-finished", async (context, { callback }) => {
        const sessionId = Number(context.sessionId);
        let roomsClosed = 0;
        const roomJobsClosed = await closeRoomJobs({ sessionId });

        for (const [roomName, storedContext] of roomContext.entries()) {
            if (storedContext.sessionId !== sessionId) {
                continue;
            }

            try {
                await closePolyadicSession(roomName);
                roomsClosed++;
            } catch (error) {
                console.warn(`[polyadic-bridge] Failed to close room ${roomName}.`, error);
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
            payload:   { sessionId, roomsClosed, roomJobsClosed },
        });
    });
}
