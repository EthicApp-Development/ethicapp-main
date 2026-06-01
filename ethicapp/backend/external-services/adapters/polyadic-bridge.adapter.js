import { getCaseDocumentRawText } from "../../helpers/case-document-content-helper.js";
import { getCaseIdBySessionId } from "../../helpers/sessions-helper.js";
import * as rpg2 from "../../db/rest-pg-2.js";
import * as config from "../../config/database.config.js";

const POLYADIC_BASE_URL = process.env.POLYADIC_AGENTS_URL || "http://localhost:5000";
const PIPELINE_TYPE = "abogado-del-diablo";

function getRoomName(sessionId, phaseId, groupId) {
    return `ethicapp-s${sessionId}-p${phaseId}-g${groupId}`;
}

function parseRoomName(roomName) {
    const match = roomName.match(/^ethicapp-s(\d+)-p(\d+)-g(\d+)$/);
    if (!match) {
        return null;
    }
    return {
        sessionId: Number(match[1]),
        phaseId: Number(match[2]),
        groupId: Number(match[3]),
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
    return rows.map(row => Number(row.team_id));
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
        id: Number(rows[0].question_id),
        title: rows[0].title || "",
        tleft: rows[0].tleft || "",
        tright: rows[0].tright || "",
    };
}

function formatQuestionText(question) {
    if (!question) {
        return null;
    }
    const parts = [];
    if (question.title) {
        parts.push(question.title.trim());
    }
    if (question.tleft && question.tright) {
        parts.push(`${question.tleft.trim()} vs. ${question.tright.trim()}`);
    } else if (question.tleft) {
        parts.push(question.tleft.trim());
    }
    return parts.length > 0 ? parts.join(" — ") : null;
}

function composeTopic(caseText, preguntaCentral) {
    if (!preguntaCentral) {
        return caseText;
    }
    const base = caseText || "";
    const delimiter = "\n\n===\n\n";
    return `${base}${delimiter}La pregunta central a discutir es: ${preguntaCentral}`;
}

export async function register({ service, subscribe, publishGroupChatMessage }) {
    const phaseRooms = new Map();
    const roomContext = new Map();

    function registerRoomContext(roomName, sessionId, phaseId, groupId, questionId) {
        const existing = roomContext.get(roomName);
        if (existing && existing.questionId == null && questionId != null) {
            existing.questionId = questionId;
            return;
        }
        roomContext.set(roomName, { sessionId, phaseId, groupId, questionId });
    }

    async function ensurePolyadicSession(roomName, topic) {
        try {
            const response = await fetch(
                `${POLYADIC_BASE_URL}/api/rooms/${encodeURIComponent(roomName)}/sessions`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        prompt_inicial: topic || "EthicApp discussion",
                        pipeline_type: PIPELINE_TYPE,
                    }),
                }
            );

            if (response.status === 201 || response.status === 200) {
                console.info(`[polyadic-bridge] Polyadic session ready for ${roomName}`);
                return true;
            }

            if (response.status === 409) {
                console.info(`[polyadic-bridge] Polyadic session already exists for ${roomName}`);
                return true;
            }

            const body = await response.text().catch(() => "");
            console.warn(
                `[polyadic-bridge] Failed to create polyadic session for ${roomName}: HTTP ${response.status} - ${body}`
            );
            return false;
        } catch (error) {
            console.warn(
                `[polyadic-bridge] Error creating polyadic session for ${roomName}:`,
                error
            );
            return false;
        }
    }

    async function closePolyadicSession(roomName) {
        try {
            const response = await fetch(
                `${POLYADIC_BASE_URL}/api/rooms/${encodeURIComponent(roomName)}/sessions/active`,
                { method: "DELETE" }
            );
            if (response.ok) {
                console.info(`[polyadic-bridge] Polyadic session closed for ${roomName}`);
            }
        } catch (error) {
            console.warn(
                `[polyadic-bridge] Error closing polyadic session for ${roomName}:`,
                error
            );
        }
    }

    async function forwardChatMessage(roomName, username, content) {
        try {
            const response = await fetch(
                `${POLYADIC_BASE_URL}/api/rooms/${encodeURIComponent(roomName)}/messages`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ username, content }),
                }
            );

            if (response.ok || response.status === 202) {
                console.info(`[polyadic-bridge] Message forwarded to ${roomName}`);
                return true;
            }

            const body = await response.text().catch(() => "");
            console.warn(
                `[polyadic-bridge] Failed to forward message to ${roomName}: HTTP ${response.status} - ${body}`
            );
            return false;
        } catch (error) {
            console.warn(
                `[polyadic-bridge] Error forwarding message to ${roomName}:`,
                error
            );
            return false;
        }
    }

    subscribe("phaseStarted", async (context, { callback }) => {
        const { sessionId, phaseId } = context;

        let caseText = null;
        try {
            const caseId = await getCaseIdBySessionId(sessionId);
            if (caseId) {
                caseText = await getCaseDocumentRawText(caseId);
                console.info(`[polyadic-bridge] Case text loaded for session ${sessionId}, case ${caseId} (${caseText.length} chars)`);
            } else {
                console.warn(
                    `[polyadic-bridge] No case found for session ${sessionId}; case text will not be sent.`
                );
            }
        } catch (error) {
            console.warn(
                `[polyadic-bridge] Unable to load raw case text for session ${sessionId}:`,
                error
            );
        }

        const teamIds = await getTeamIdsForPhase(phaseId);
        const question = await getFirstQuestionForPhase(phaseId);
        const questionId = question ? question.id : null;
        const preguntaCentral = formatQuestionText(question);
        const basePrompt = caseText || `EthicApp session ${sessionId} phase ${phaseId}`;
        const prompt = composeTopic(basePrompt, preguntaCentral);
        const createdRooms = new Set();

        if (teamIds.length > 0) {
            for (const groupId of teamIds) {
                const roomName = getRoomName(sessionId, phaseId, groupId);
                const created = await ensurePolyadicSession(roomName, prompt);
                if (created) {
                    createdRooms.add(roomName);
                    registerRoomContext(roomName, sessionId, phaseId, groupId, questionId);
                }
            }
        } else {
            console.warn(
                `[polyadic-bridge] No groups found for phase ${phaseId}; sessions will be created on first message.`
            );
        }

        phaseRooms.set(phaseId, createdRooms);

        await callback({
            serviceId: service.id,
            hook: "phaseStarted",
            status: "completed",
            payload: {
                sessionId,
                phaseId,
                roomsCreated: createdRooms.size,
                ready: true,
            },
        });
    });

    subscribe("chat-message-received", async (context, { callback }) => {
        const { sessionId, phaseId, groupId, questionId, userId, content } = context;
        const roomName = getRoomName(sessionId, phaseId, groupId);

        if (questionId != null) {
            const existing = roomContext.get(roomName);
            if (existing) {
                existing.questionId = questionId;
            }
        }

        const phaseCreatedRooms = phaseRooms.get(phaseId);
        if (!phaseCreatedRooms || !phaseCreatedRooms.has(roomName)) {
            let prompt = `EthicApp session ${sessionId} phase ${phaseId}`;
            try {
                const caseId = await getCaseIdBySessionId(sessionId);
                if (caseId) {
                    const caseText = await getCaseDocumentRawText(caseId);
                    if (caseText) {
                        prompt = caseText;
                    }
                }
            } catch (_) {}

            const questionDeferred = await getFirstQuestionForPhase(phaseId);
            const preguntaCentralDeferred = formatQuestionText(questionDeferred);
            prompt = composeTopic(prompt, preguntaCentralDeferred);

            const created = await ensurePolyadicSession(
                roomName,
                prompt
            );
            if (!created) {
                console.warn(
                    `[polyadic-bridge] Skipping message forwarding: could not create polyadic session.`
                );
                await callback({
                    serviceId: service.id,
                    hook: "chat-message-received",
                    status: "failed",
                    payload: {
                        sessionId,
                        phaseId,
                        groupId,
                        forwarded: false,
                        reason: "session_creation_failed",
                    },
                });
                return;
            }
            if (phaseCreatedRooms) {
                phaseCreatedRooms.add(roomName);
            }
            registerRoomContext(roomName, sessionId, phaseId, groupId, questionId);
        }

        const messageContent = typeof content === "string" ? content.trim() : "";
        if (!messageContent) {
            await callback({
                serviceId: service.id,
                hook: "chat-message-received",
                status: "completed",
                payload: {
                    sessionId,
                    phaseId,
                    groupId,
                    forwarded: false,
                    reason: "empty_content",
                },
            });
            return;
        }

        const forwarded = await forwardChatMessage(roomName, `user-${userId}`, messageContent);

        await callback({
            serviceId: service.id,
            hook: "chat-message-received",
            status: forwarded ? "completed" : "failed",
            payload: {
                sessionId,
                phaseId,
                groupId,
                forwarded,
            },
        });
    });

    subscribe("external-service-result", async (context, { callback }) => {
        const { requestPayload } = context;
        if (!requestPayload || !requestPayload.room || !Array.isArray(requestPayload.evaluations)) {
            console.warn("[polyadic-bridge] Received callback with invalid payload.", requestPayload);
            await callback({
                serviceId: service.id,
                hook: "external-service-result",
                status: "failed",
                payload: { reason: "invalid_payload" },
            });
            return;
        }

        const { room: roomName, evaluations } = requestPayload;
        const ctx = roomContext.get(roomName);

        if (!ctx) {
            console.warn(`[polyadic-bridge] Ignoring callback for unknown/closed room ${roomName}`);
            await callback({
                serviceId: service.id,
                hook: "external-service-result",
                status: "failed",
                payload: { reason: "room_not_found_or_closed", room: roomName },
            });
            return;
        }

        if (ctx.questionId == null) {
            ctx.questionId = await getFirstQuestionIdForPhase(ctx.phaseId);
            if (ctx.questionId == null) {
                console.warn(`[polyadic-bridge] Cannot resolve questionId for phase ${ctx.phaseId} in room ${roomName}.`);
            }
        }

        for (const r of evaluations) {
            if (!r || typeof r.respuesta !== "string") {
                continue;
            }
            const content = r.respuesta.trim();
            if (!content) {
                continue;
            }

            const agenteLower = String(r.agente).toLowerCase();

            if (agenteLower !== "orientador") {
                console.debug(
                    `[polyadic-bridge] Skipping ${r.agente} response (only Orientador is published)`
                );
                continue;
            }

            console.info(
                `[polyadic-bridge] Publishing Orientador response to group ${ctx.groupId}`
            );
            await publishGroupChatMessage({
                sessionId: ctx.sessionId,
                phaseId: ctx.phaseId,
                questionId: ctx.questionId,
                groupId: ctx.groupId,
                agentDisplayName: r.agente,
                content,
            });
        }

        await callback({
            serviceId: service.id,
            hook: "external-service-result",
            status: "completed",
            payload: {
                room: roomName,
                evaluationsProcessed: evaluations.length,
            },
        });
    });

    subscribe("phaseEnded", async (context, { callback }) => {
        const { sessionId, phaseId } = context;
        const rooms = phaseRooms.get(phaseId);

        if (rooms) {
            for (const roomName of rooms) {
                await closePolyadicSession(roomName);
                roomContext.delete(roomName);
            }
            phaseRooms.delete(phaseId);
        }

        await callback({
            serviceId: service.id,
            hook: "phaseEnded",
            status: "completed",
            payload: {
                sessionId,
                phaseId,
                roomsClosed: rooms ? rooms.size : 0,
            },
        });
    });

    subscribe("sessionEnded", async (context, { callback }) => {
        const { sessionId } = context;
        let cleanedRooms = 0;
        let cleanedPhases = 0;

        for (const [roomName, ctx] of roomContext.entries()) {
            if (ctx.sessionId === sessionId) {
                await closePolyadicSession(roomName);
                roomContext.delete(roomName);
                cleanedRooms++;
            }
        }

        for (const [phaseId, rooms] of phaseRooms.entries()) {
            let belongsToSession = false;
            for (const roomName of rooms) {
                const parsed = parseRoomName(roomName);
                if (parsed && parsed.sessionId === sessionId) {
                    belongsToSession = true;
                    break;
                }
            }
            if (belongsToSession) {
                phaseRooms.delete(phaseId);
                cleanedPhases++;
            }
        }

        console.info(`[polyadic-bridge] Session ${sessionId} ended. Cleaned ${cleanedRooms} rooms, ${cleanedPhases} phases.`);

        await callback({
            serviceId: service.id,
            hook: "sessionEnded",
            status: "completed",
            payload: {
                sessionId,
                cleanedRooms,
                cleanedPhases,
            },
        });
    });
}