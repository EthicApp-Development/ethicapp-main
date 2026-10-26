// socket.config.js
import { Server as SocketIO } from "socket.io";
import { studentSocketInit, toStudentsNotifications } from "../sockets/student.socket.js";
import { teacherSocketInit, toTeacherNotifications } from "../sockets/teacher.socket.js";
import { hydrateEngineRequest, requireSocketRole } from "../sockets/socket-auth.js";
import { getLegacySessionMiddleware } from "./session.config.js";

let ioInstance = null;
let studentNotifications = null;
let teacherNotifications = null;

/**
 * Wires authentication and namespaces on a Socket.IO server.
 *
 * Every Engine.IO request (polling and the WebSocket upgrade) goes through the
 * same Express session and hydrateLegacySession as HTTP requests, so sockets
 * see the effective identity, including impersonation. Namespace middleware
 * then rejects unauthenticated sockets and wrong roles before `connection`.
 *
 * @param {SocketIO} io
 * @param {object} options
 * @param {import("express").RequestHandler} options.sessionMiddleware
 * @param {Function} [options.studentInit]
 * @param {Function} [options.teacherInit]
 */
export function configureSocketServer(io, {
    sessionMiddleware,
    studentInit = studentSocketInit,
    teacherInit = teacherSocketInit,
}) {
    io.engine.use(sessionMiddleware);
    io.engine.use(hydrateEngineRequest);

    const teacherNamespace = io.of("/teacher");
    teacherNamespace.use(requireSocketRole("P"));
    teacherNamespace.on("connection", socket => teacherInit(socket, teacherNamespace));

    const studentNamespace = io.of("/student");
    studentNamespace.use(requireSocketRole("A"));
    studentNamespace.on("connection", socket => studentInit(socket, studentNamespace));

    return { teacherNamespace, studentNamespace };
}

const initializeSockets = (server) => {
    if (!server) {
        throw new Error("Server instance is required to initialize sockets.");
    }

    console.info("[socket.config] Initializing Socket.IO namespaces.");
    const io = new SocketIO(server);

    const { teacherNamespace, studentNamespace } = configureSocketServer(io, {
        sessionMiddleware: getLegacySessionMiddleware(),
    });

    teacherNotifications = toTeacherNotifications(teacherNamespace);
    studentNotifications = toStudentsNotifications(studentNamespace);
    console.info("[socket.config] Namespaces '/teacher' and '/student' initialized.");

    ioInstance = io;

    return io;
};

// Export the initialized namespaces and notifications
export {
    initializeSockets,
    ioInstance,
    studentNotifications,
    teacherNotifications
};
