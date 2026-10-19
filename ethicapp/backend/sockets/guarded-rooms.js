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
    socket.on(joinEvent, async (rawId, ack) => {
        const id = parseRoomId(rawId);

        if (id === null) {
            reply(ack, { ok: false, error: "invalid_id" });
            return;
        }

        try {
            if (!(await canJoin(id))) {
                logger.warn(`[socket] Denied ${joinEvent} ${id} for user ${socket.data.uid}.`);
                reply(ack, { ok: false, error: "forbidden" });
                return;
            }

            socket.join(roomName(id));
            reply(ack, { ok: true });
        } catch (error) {
            logger.error(`[socket] ${joinEvent} ${id} failed for user ${socket.data.uid}:`, error);
            reply(ack, { ok: false, error: "unavailable" });
        }
    });

    socket.on(leaveEvent, (rawId) => {
        const id = parseRoomId(rawId);

        if (id !== null) {
            socket.leave(roomName(id));
        }
    });
}
