import { io } from "socket.io-client";
import { Observable } from "rxjs";
import { trackSocketRooms } from "../helpers/socket-rooms.js";

const SESSION_ROOM = { join: "joinSession", leave: "leaveSession" };
const GROUP_CHAT_ROOM = { join: "joinGroupChat", leave: "leaveGroupChat" };

// `connect` and `location` are for tests; the app uses socket.io-client and
// the page's location.
const SocketService = function(namespace, {
    connect = io,
    location = globalThis.window?.location,
} = {}) {
    const port = location.port ? `:${location.port}` : "";
    const url = `${location.protocol}//${location.hostname}${port}/${namespace}`;
    const socket = connect(url);
    const socketTag = `[SocketService:${namespace}]`;
    // The rooms joined through this service are joined again after each
    // reconnect (#1116).
    const rooms = trackSocketRooms(socket);

    socket.on("connect", () => {
        console.debug(`${socketTag} connected`, { socketId: socket.id, url });
    });

    socket.on("disconnect", (reason) => {
        console.debug(`${socketTag} disconnected`, { reason });
    });

    socket.on("connect_error", (error) => {
        console.error(`${socketTag} connection error`, error);
    });

    socket.onAny((eventName, payload) => {
        console.debug(`${socketTag} incoming event`, { eventName, payload });
    });

    return {
        // Listen to generic events
        onEvent: (eventName, callback) => {
            socket.on(eventName, (data) => {
                callback(data);
            });
        },

        // Listen to generic events using RxJS Observable
        fromEvent: (eventName) => {
            return new Observable((observer) => {
                const handler = (data) => {
                    console.debug(`${socketTag} fromEvent`, { eventName, data });
                    observer.next(data);
                };

                socket.on(eventName, handler);

                // Cleanup when unsubscribing
                return () => {
                    socket.off(eventName, handler);
                };
            });
        },        

        // Emit generic events
        emitEvent: (eventName, data) => {
            socket.emit(eventName, data);
        },

        // Whether the socket is connected now. Best-effort signals, such as
        // the composing signal (#1200), are sent only then, never buffered.
        isConnected: () => socket.connected === true,

        // Join a session's room, again after each reconnect
        joinSession: (sessionId) => {
            rooms.join(SESSION_ROOM.join, sessionId);
        },

        // Exit a session's room
        leaveSession: (sessionId) => {
            rooms.leave(SESSION_ROOM.join, sessionId, SESSION_ROOM.leave);
        },

        // Join a group's chat room (teacher namespace), again after each
        // reconnect
        joinGroupChat: (groupId) => {
            rooms.join(GROUP_CHAT_ROOM.join, groupId);
        },

        leaveGroupChat: (groupId) => {
            rooms.leave(GROUP_CHAT_ROOM.join, groupId, GROUP_CHAT_ROOM.leave);
        },

        // Calls `listener` after each reconnect, once the rooms are joined
        // again, so it can read what was missed while disconnected. Returns
        // the function that stops it.
        onReconnect: (listener) => rooms.onReconnect(listener),

        // Disconnect the socket
        disconnect: () => {
            socket.disconnect();
        },
    };
};    

export default SocketService;
