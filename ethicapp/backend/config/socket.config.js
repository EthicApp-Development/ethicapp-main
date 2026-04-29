// socket.config.js
import { Server as SocketIO } from "socket.io";
import { studentSocketInit, toStudentsNotifications } from "../sockets/student.socket.js";
import { teacherSocketInit, toTeacherNotifications } from "../sockets/teacher.socket.js";

let ioInstance = null;
let studentNotifications = null;
let teacherNotifications = null;

const initializeSockets = (server) => {
    console.log("[socket.config] Initializing Socket.IO...");
    
    if (!server) {
        throw new Error("Server instance is required to initialize sockets.");
    }

    console.info("[socket.config] Initializing Socket.IO namespaces.");
    const io = new SocketIO(server);

    // Teacher namespace
    const teacherSocket = io.of("/teacher");
    teacherSocket.on("connection", (socket) => teacherSocketInit(socket, teacherSocket));
    teacherNotifications = toTeacherNotifications(teacherSocket);
    console.info("[socket.config] Teacher namespace '/teacher' initialized.");

    // Student namespace
    const studentSocket = io.of("/student");
    studentSocket.on("connection", (socket) => studentSocketInit(socket, studentSocket));
    studentNotifications = toStudentsNotifications(studentSocket);
    console.info("[socket.config] Student namespace '/student' initialized.");

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
