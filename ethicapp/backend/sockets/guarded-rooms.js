/**
 * @param {unknown} value Room id sent by the client.
 * @returns {number | null} Positive integer id, or null when malformed.
 */
export function parseRoomId(value) {
    const id = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
    return Number.isInteger(id) && id > 0 ? id : null;
}

function reply(ack, result) {
    if (typeof ack === "function") {
        ack(result);
    }
}

/**
 * Registers a join/leave event pair for rooms keyed by a numeric id. The
 * socket joins only after `canJoin` confirms access server-side; the client
 * may pass an acknowledgement callback to learn the outcome.
 *
 * Socket.IO keeps dispatching events while `canJoin` is pending, so each room
 * carries a per-socket generation: every join or leave request for a room
 * starts a new generation, and a join whose generation is no longer current
 * when its check resolves is discarded. The most recent request wins, so a
 * leave sent while a join is being authorized is never undone.
 *
 * @param {import("socket.io").Socket} socket
 * @param {object} options
 * @param {string} options.joinEvent
 * @param {string} options.leaveEvent
 * @param {(id: number) => string} options.roomName
 * @param {(id: number) => Promise<boolean>} options.canJoin
 * @param {Console} [options.logger]
 */
export function registerGuardedRoom(socket, {
    joinEvent,
    leaveEvent,
    roomName,
    canJoin,
    logger = console,
}) {
    const generations = new Map();

    function nextGeneration(room) {
        const generation = (generations.get(room) ?? 0) + 1;
        generations.set(room, generation);
        return generation;
    }

    socket.on(joinEvent, async (rawId, ack) => {
        const id = parseRoomId(rawId);

        if (id === null) {
            reply(ack, { ok: false, error: "invalid_id" });
            return;
        }

        const room = roomName(id);
        const generation = nextGeneration(room);

        try {
            const allowed = await canJoin(id);

            if (generations.get(room) !== generation) {
                reply(ack, { ok: false, error: "superseded" });
                return;
            }

            if (!allowed) {
                logger.warn(`[socket] Denied ${joinEvent} ${id} for user ${socket.data.uid}.`);
                reply(ack, { ok: false, error: "forbidden" });
                return;
            }

            socket.join(room);
            reply(ack, { ok: true });
        } catch (error) {
            logger.error(`[socket] ${joinEvent} ${id} failed for user ${socket.data.uid}:`, error);
            reply(ack, { ok: false, error: "unavailable" });
        }
    });

    socket.on(leaveEvent, (rawId) => {
        const id = parseRoomId(rawId);

        if (id !== null) {
            const room = roomName(id);
            nextGeneration(room);
            socket.leave(room);
        }
    });
}
