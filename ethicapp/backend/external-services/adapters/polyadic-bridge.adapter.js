import { io } from "socket.io-client";

const POLYADIC_BASE_URL = process.env.POLYADIC_AGENTS_URL || "http://localhost:5000";
const BRIDGE_USERNAME = "ethicapp-bridge";
const PIPELINE_TYPE = "abogado-del-diablo";

function getRoomName(sessionId, phaseId, groupId) {
    return `ethicapp-s${sessionId}-p${phaseId}-g${groupId}`;
}

export async function register({ service, subscribe, publishGroupChatMessage }) {
    const activeRooms = new Map();
    const phaseToRooms = new Map();

    function getOrCreateRoomSocket(roomName, sessionId, phaseId, groupId, questionId) {
        if (activeRooms.has(roomName)) {
            return activeRooms.get(roomName);
        }

        const socket = io(POLYADIC_BASE_URL, {
            transports: ["websocket", "polling"],
            autoConnect: true,
            reconnection: true,
        });

        socket.on("connect", () => {
            console.info(`[polyadic-bridge] Socket connected for room ${roomName}`);
            socket.emit("join", { username: BRIDGE_USERNAME, room: roomName });
            const entry = activeRooms.get(roomName);
            if (entry) {
                entry.connected = true;
            }
        });

        socket.on("disconnect", () => {
            console.warn(`[polyadic-bridge] Socket disconnected for room ${roomName}`);
            const entry = activeRooms.get(roomName);
            if (entry) {
                entry.connected = false;
            }
        });

        socket.on("evaluacion", async (respuestas) => {
            await handlePolyadicEvaluation(roomName, respuestas);
        });

        const entry = {
            socket,
            sessionId,
            phaseId,
            groupId,
            questionId,
            connected: false,
        };
        activeRooms.set(roomName, entry);

        if (!phaseToRooms.has(phaseId)) {
            phaseToRooms.set(phaseId, new Set());
        }
        phaseToRooms.get(phaseId).add(roomName);

        return entry;
    }

    async function handlePolyadicEvaluation(roomName, respuestas) {
        const entry = activeRooms.get(roomName);
        if (!entry) {
            console.warn(`[polyadic-bridge] Received evaluation for unknown room ${roomName}`);
            return;
        }

        if (!Array.isArray(respuestas)) {
            console.warn(
                `[polyadic-bridge] Expected array for evaluacion, got ${typeof respuestas}`
            );
            return;
        }

        for (const r of respuestas) {
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
                `[polyadic-bridge] Publishing Orientador response to group ${entry.groupId}`
            );
            await publishGroupChatMessage({
                sessionId: entry.sessionId,
                phaseId: entry.phaseId,
                questionId: entry.questionId,
                groupId: entry.groupId,
                agentDisplayName: r.agente,
                content,
            });
        }
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

    function disconnectRoom(roomName) {
        const entry = activeRooms.get(roomName);
        if (!entry) {
            return;
        }
        if (entry.socket) {
            try {
                entry.socket.emit("leave", { username: BRIDGE_USERNAME, room: roomName });
            } catch {
                // ignore
            }
            entry.socket.disconnect();
        }
        activeRooms.delete(roomName);
    }

    async function forwardChatMessage(context) {
        const { sessionId, phaseId, groupId, questionId, userId, content } = context;
        const roomName = getRoomName(sessionId, phaseId, groupId);
        const topic = `EthicApp session ${sessionId} phase ${phaseId}`;

        const created = await ensurePolyadicSession(roomName, topic);
        if (!created) {
            console.warn(
                `[polyadic-bridge] Skipping message forwarding: could not create polyadic session.`
            );
            return;
        }

        const entry = getOrCreateRoomSocket(roomName, sessionId, phaseId, groupId, questionId);

        if (!entry.connected) {
            await new Promise((resolve) => setTimeout(resolve, 500));
        }

        const messageContent = typeof content === "string" ? content.trim() : "";
        if (!messageContent) {
            return;
        }

        entry.socket.emit("message", {
            room: roomName,
            username: `user-${userId}`,
            content: messageContent,
        });
    }

    subscribe("chat-message-received", async (context, { callback }) => {
        await forwardChatMessage(context);
        await callback({
            serviceId: service.id,
            hook: "chat-message-received",
            status: "completed",
            payload: {
                sessionId: context.sessionId,
                phaseId: context.phaseId,
                groupId: context.groupId,
                forwarded: true,
            },
        });
    });

    subscribe("phaseStarted", async (context, { callback }) => {
        await callback({
            serviceId: service.id,
            hook: "phaseStarted",
            status: "completed",
            payload: {
                sessionId: context.sessionId,
                phaseId: context.phaseId,
                ready: true,
            },
        });
    });

    subscribe("phaseEnded", async (context, { callback }) => {
        const { sessionId, phaseId } = context;
        const rooms = phaseToRooms.get(phaseId);

        if (rooms) {
            for (const roomName of rooms) {
                await closePolyadicSession(roomName);
                disconnectRoom(roomName);
            }
            phaseToRooms.delete(phaseId);
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
}
