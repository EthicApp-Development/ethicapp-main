// socket.config.js
import { Server as SocketIO } from "socket.io";
import { studentSocketInit, toStudentsNotifications } from "../sockets/student.socket.js";
import { teacherSocketInit, toTeacherNotifications } from "../sockets/teacher.socket.js";

let ioInstance = null;
let studentNotifications = null;
let teacherNotifications = null;

const initializeSockets = (server) => {
    if (!server) {
        throw new Error("Server instance is required to initialize sockets.");
    }

    const io = new SocketIO(server);

    // Teacher namespace
    const teacherSocket = io.of('/teacher');
    teacherSocket.on('connection', teacherSocketInit);
    teacherNotifications = toTeacherNotifications(teacherSocket);

    // Student namespace
    const studentSocket = io.of('/student');
    studentSocket.on('connection', studentSocketInit);
    studentNotifications = toStudentsNotifications(studentSocket);

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
