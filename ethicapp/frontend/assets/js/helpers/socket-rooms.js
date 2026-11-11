// The rooms a Socket.IO client has joined, joined again after a reconnect
// (#1116, epic #1105).
//
// The server forgets a socket's rooms when it disconnects, and a reconnect
// is a new server-side socket. Without a rejoin, the teacher's dashboard
// stops receiving its activity's events after a network drop or a laptop
// sleep. The tracker remembers each room joined and not left, emits its join
// event again on every reconnect, and then calls the reconnect listeners, so
// they can read again what they may have missed while disconnected.
//
// The first `connect` is not a reconnect: Socket.IO sends the joins emitted
// before it once it connects.

/**
 * @param {{ on: Function, emit: Function }} socket A Socket.IO client socket.
 * @returns {{
 *   join: (joinEvent: string, roomId: *) => void,
 *   leave: (joinEvent: string, roomId: *, leaveEvent: string) => void,
 *   onReconnect: (listener: Function) => Function,
 *   rooms: () => Array<{ joinEvent: string, roomId: * }>,
 * }}
 */
export function trackSocketRooms(socket) {
    // Key: `${joinEvent}:${roomId}`, value: what to emit on a rejoin.
    const joined = new Map();
    const reconnectListeners = new Set();
    let connectedBefore = false;

    const roomKey = (joinEvent, roomId) => `${joinEvent}:${String(roomId)}`;

    socket.on("connect", () => {
        if (!connectedBefore) {
            connectedBefore = true;
            return;
        }
        joined.forEach(({ joinEvent, roomId }) => socket.emit(joinEvent, roomId));
        Array.from(reconnectListeners).forEach((listener) => {
            try {
                listener();
            } catch (error) {
                console.error("[socket-rooms] A reconnect listener failed.", error);
            }
        });
    });

    return {
        join(joinEvent, roomId) {
            joined.set(roomKey(joinEvent, roomId), { joinEvent, roomId });
            socket.emit(joinEvent, roomId);
        },

        // Forgets the room that `joinEvent` joined and emits `leaveEvent`.
        leave(joinEvent, roomId, leaveEvent) {
            joined.delete(roomKey(joinEvent, roomId));
            socket.emit(leaveEvent, roomId);
        },

        // Calls `listener` after each reconnect, once the rooms are joined
        // again. Returns the function that stops it.
        onReconnect(listener) {
            reconnectListeners.add(listener);
            return () => reconnectListeners.delete(listener);
        },

        rooms() {
            return Array.from(joined.values())
                .map(({ joinEvent, roomId }) => ({ joinEvent, roomId }));
        },
    };
}
