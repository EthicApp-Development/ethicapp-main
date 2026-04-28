import { io } from 'socket.io-client';
import { Observable } from 'rxjs';

const SocketService = function(namespace) {
    const url = `${window.location.protocol}//${window.location.hostname}${window.location.port ? `:${window.location.port}` : ''}/${namespace}`;
    const socket = io(url);
    const socketTag = `[SocketService:${namespace}]`;

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

        // Join a specific room
        joinSession: (sessionId) => {
            socket.emit("joinSession", sessionId);
        },

        // Exit a specific room
        leaveSession: (sessionId) => {
            socket.emit("leaveSession", sessionId);
        },

        // Disconnect the socket
        disconnect: () => {
            socket.disconnect();
        },
    };
};    

export default SocketService;
