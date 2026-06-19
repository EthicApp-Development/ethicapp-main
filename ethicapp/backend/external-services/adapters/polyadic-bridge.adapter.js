import * as rpg2 from "../../db/rest-pg-2.js";
import * as config from "../../config/database.config.js";
import defaultAiAdditionsClient from "../../services/ai-additions-client.service.js";

const DEFAULT_POLYADIC_BASE_PATH = "/polyadic-agent/api";
const DEFAULT_PIPELINE_TYPE = "abogado-del-diablo";

let aiAdditionsClient = defaultAiAdditionsClient;

function normalizeText(value) {
    if (value === null || value === undefined) {
        return "";
    }

    const text = String(value).trim();
    return text.length > 0 ? text : "";
}

function readBoolean(value, fallback) {
    if (value === undefined || value === null || value === "") {
        return fallback;
    }

    return String(value).trim().toLowerCase() === "true";
}

export function getPolyadicApiBaseUrl(client = aiAdditionsClient) {
    return normalizeText(process.env.AI_ADDITIONS_POLYADIC_AGENTS_API_BASE_URL)
        || client.buildServiceUrl(DEFAULT_POLYADIC_BASE_PATH);
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

async function getTeamIdsForPhase(phaseId) {
    const rows = await rpg2.execSQL({
        sql: `
            SELECT t.id AS team_id
            FROM teams AS t
            WHERE t.stageid = $1
            ORDER BY t.id
        `,
        dbcon: config.dbconnString,
        sqlParams: [rpg2.param("plain", phaseId)],
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
        dbcon: config.dbconnString,
        sqlParams: [rpg2.param("plain", phaseId)],
    });

    return rows.length > 0 ? Number(rows[0].question_id) : null;
}

async function getFirstQuestionForPhase(phaseId) {
    const rows = await rpg2.execSQL({
        sql: `
            SELECT d.id AS question_id, d.title, d.tleft, d.tright
            FROM differential AS d
            WHERE d.stageid = $1
            ORDER BY d.orden, d.id
            LIMIT 1
        `,
        dbcon: config.dbconnString,
        sqlParams: [rpg2.param("plain", phaseId)],
    });

    if (rows.length === 0) {
        return null;
    }

    return {
        id:     Number(rows[0].question_id),
        title:  normalizeText(rows[0].title),
        tleft:  normalizeText(rows[0].tleft),
        tright: normalizeText(rows[0].tright),
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
    const title = normalizeText(question.title);
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

function createDependencies(overrides = {}) {
    return {
        getTeamIdsForPhase,
        getFirstQuestionIdForPhase,
        getFirstQuestionForPhase,
        getCaseIdBySessionId: getDefaultCaseIdBySessionId,
        getCaseDocumentRawText: getDefaultCaseDocumentRawText,
        ...overrides,
    };
}

async function requestPolyadicJson(pathname, { method = "GET", body = null } = {}) {
    return aiAdditionsClient.requestJson(pathname, {
        method,
        body,
        baseUrl: getPolyadicApiBaseUrl(),
        authenticated: isPolyadicAuthenticated(),
    });
}

async function ensurePolyadicSession(roomName, topic) {
    await requestPolyadicJson(`/rooms/${encodeURIComponent(roomName)}/sessions`, {
        method: "POST",
        body:   {
            prompt_inicial: topic || "EthicApp discussion",
            pipeline_type:  getPipelineType(),
        },
    });

    console.info(`[polyadic-bridge] Polyadic session ready for ${roomName}.`);
    return true;
}

async function closePolyadicSession(roomName) {
    await requestPolyadicJson(`/rooms/${encodeURIComponent(roomName)}/sessions/active`, {
        method: "DELETE",
    });

    console.info(`[polyadic-bridge] Polyadic session closed for ${roomName}.`);
    return true;
}

async function forwardChatMessage(roomName, username, content) {
    await requestPolyadicJson(`/rooms/${encodeURIComponent(roomName)}/messages`, {
        method: "POST",
        body:   { username, content },
    });

    console.info(`[polyadic-bridge] Message forwarded to ${roomName}.`);
    return true;
}

export async function register({
    service,
    subscribe,
    publishGroupChatMessage,
    aiAdditionsClient: providedAiAdditionsClient,
    polyadicBridgeDependencies = {},
}) {
    aiAdditionsClient = providedAiAdditionsClient || defaultAiAdditionsClient;

    const dependencies = createDependencies(polyadicBridgeDependencies);
    const phaseRooms = new Map();
    const roomContext = new Map();

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

    async function buildTopicForPhase(sessionId, phaseId) {
        const caseText = await resolveCaseText(sessionId, dependencies);
        const question = await dependencies.getFirstQuestionForPhase(phaseId);
        const questionText = formatQuestionText(question);
        const fallbackTopic = `EthicApp session ${sessionId} phase ${phaseId}`;

        return {
            questionId: question?.id ?? null,
            topic: composeTopic(caseText || fallbackTopic, questionText),
        };
    }

    async function createRoom({ sessionId, phaseId, groupId, questionId, topic }) {
        const roomName = getRoomName(sessionId, phaseId, groupId);
        rememberRoomContext(roomName, sessionId, phaseId, groupId, questionId);

        try {
            await ensurePolyadicSession(roomName, topic);
            return roomName;
        } catch (error) {
            roomContext.delete(roomName);
            console.warn(`[polyadic-bridge] Failed to create polyadic room ${roomName}.`, error);
            return null;
        }
    }

    subscribe("phaseStarted", async (context, { callback }) => {
        const { sessionId, phaseId } = context;
        const teamIds = await dependencies.getTeamIdsForPhase(phaseId);
        const { questionId, topic } = await buildTopicForPhase(sessionId, phaseId);
        const createdRooms = new Set();

        for (const groupId of teamIds) {
            const roomName = await createRoom({ sessionId, phaseId, groupId, questionId, topic });
            if (roomName) {
                createdRooms.add(roomName);
            }
        }

        phaseRooms.set(phaseId, createdRooms);

        await callback({
            serviceId: service.id,
            hook:      "phaseStarted",
            status:    "completed",
            payload:   {
                sessionId,
                phaseId,
                roomsCreated: createdRooms.size,
            },
        });
    });

    subscribe("chat-message-received", async (context, { callback }) => {
        const { sessionId, phaseId, groupId, questionId, userId } = context;
        const content = normalizeText(context.content);
        const roomName = getRoomName(sessionId, phaseId, groupId);

        if (!content) {
            await callback({
                serviceId: service.id,
                hook:      "chat-message-received",
                status:    "skipped",
                payload:   { sessionId, phaseId, groupId, reason: "empty_content" },
            });
            return;
        }

        let phaseCreatedRooms = phaseRooms.get(phaseId);
        if (!phaseCreatedRooms) {
            phaseCreatedRooms = new Set();
            phaseRooms.set(phaseId, phaseCreatedRooms);
        }

        if (!phaseCreatedRooms.has(roomName)) {
            const topicData = await buildTopicForPhase(sessionId, phaseId);
            const createdRoom = await createRoom({
                sessionId,
                phaseId,
                groupId,
                questionId: questionId ?? topicData.questionId,
                topic: topicData.topic,
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

            phaseCreatedRooms.add(createdRoom);
        } else {
            rememberRoomContext(roomName, sessionId, phaseId, groupId, questionId);
        }

        try {
            await forwardChatMessage(roomName, `user-${userId}`, content);
            await callback({
                serviceId: service.id,
                hook:      "chat-message-received",
                status:    "completed",
                payload:   { sessionId, phaseId, groupId, forwarded: true },
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

    subscribe("external-service-result", async (context, { callback }) => {
        const requestPayload = context.requestPayload || {};
        const roomName = normalizeText(requestPayload.room);
        const evaluations = Array.isArray(requestPayload.evaluations) ? requestPayload.evaluations : [];
        const savedMessages = [];

        if (!roomName || evaluations.length === 0) {
            await callback({
                serviceId: service.id,
                hook:      "external-service-result",
                status:    "failed",
                payload:   { reason: "invalid_payload" },
            });
            return;
        }

        const storedContext = roomContext.get(roomName) || parseRoomName(roomName);
        if (!storedContext) {
            await callback({
                serviceId: service.id,
                hook:      "external-service-result",
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
                    hook:      "external-service-result",
                    status:    "failed",
                    payload:   { reason: "question_not_found", room: roomName },
                });
                return;
            }
        }

        for (const evaluation of evaluations) {
            const agentName = normalizeText(evaluation?.agente);
            const content = normalizeText(evaluation?.respuesta);

            if (!content || agentName.toLowerCase() !== "orientador") {
                continue;
            }

            const published = await publishGroupChatMessage({
                sessionId: storedContext.sessionId,
                phaseId: storedContext.phaseId,
                questionId: storedContext.questionId,
                groupId: storedContext.groupId,
                agentDisplayName: agentName,
                content,
            });

            if (published?.savedMessage) {
                savedMessages.push(published.savedMessage);
            }
        }

        await callback({
            serviceId: service.id,
            hook:      "external-service-result",
            status:    "completed",
            payload:   {
                room: roomName,
                evaluationsReceived: evaluations.length,
                messagesPublished: savedMessages.length,
            },
        });
    });

    subscribe("phaseEnded", async (context, { callback }) => {
        const { sessionId, phaseId } = context;
        const rooms = phaseRooms.get(phaseId) || new Set();
        let roomsClosed = 0;

        for (const roomName of rooms) {
            try {
                await closePolyadicSession(roomName);
                roomsClosed++;
            } catch (error) {
                console.warn(`[polyadic-bridge] Failed to close room ${roomName}.`, error);
            }
            roomContext.delete(roomName);
        }

        phaseRooms.delete(phaseId);

        await callback({
            serviceId: service.id,
            hook:      "phaseEnded",
            status:    "completed",
            payload:   { sessionId, phaseId, roomsClosed },
        });
    });

    subscribe("sessionEnded", async (context, { callback }) => {
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
                console.warn(`[polyadic-bridge] Failed to close room ${roomName}.`, error);
            }
            roomContext.delete(roomName);
        }

        for (const [phaseId, rooms] of phaseRooms.entries()) {
            for (const roomName of rooms) {
                const parsedRoom = parseRoomName(roomName);
                if (parsedRoom?.sessionId === sessionId) {
                    phaseRooms.delete(phaseId);
                    break;
                }
            }
        }

        await callback({
            serviceId: service.id,
            hook:      "sessionEnded",
            status:    "completed",
            payload:   { sessionId, roomsClosed },
        });
    });
}
