const { Server: SocketIO } = require("socket.io");
const { studentSocketInit, toStudentsNotifications } = require("../socket/student.socket.js");
const { teacherSocketInit, toTeacherNotifications } = require("../socket/teacher.socket.js");

let ioInstance = null;
let studentNotifications = null;
let teacherNotifications = null;

function configSocket(server) {
    if (!server) {
        throw new Error("Server instance is required to initialize sockets.");
    }

    const io = new SocketIO(server);

    // Guardar instancia global
    ioInstance = io;

    // Namespaces
    const teacherSocket = io.of('/teacher');
    teacherSocket.on('connection', (socket) => teacherSocketInit(socket, teacherSocket));
    teacherNotifications = toTeacherNotifications(teacherSocket);

    const studentSocket = io.of('/student');
    studentSocket.on('connection', (socket) => studentSocketInit(socket, studentSocket));
    studentNotifications = toStudentsNotifications(studentSocket);

    // Legacy (compatibilidad con la API vieja que usaba io.of("/").emit)
    module.exports.stateChange = function(sesid) {
        io.of("/").emit("stateChange", { ses: sesid });
    };
    module.exports.updateTeam = function(tmid) {
        io.of("/").emit("updateTeam", { tmid: tmid });
    };
    module.exports.reportChange = function(sesid) {
        io.of("/").emit("reportChange", { ses: sesid });
    };
    module.exports.reportBroadcast = function(sesid, rid) {
        io.of("/").emit("reportReceived", { ses: sesid, rid: rid });
    };
    module.exports.diffBroadcast = function(sesid, content) {
        io.of("/").emit("diffReceived", { ses: sesid, content: content });
    };
    module.exports.teamProgress = function(sesid, tmid) {
        io.of("/").emit("teamProgress", { ses: sesid, tmid: tmid });
    };
    module.exports.chatMsg = function(sesid, tmid) {
        io.of("/").emit("chatMsg", { ses: sesid, tmid: tmid });
    };
    module.exports.chatMsgStage = function(stageid, tmid) {
        io.of("/").emit("chatMsgStage", { stageid: stageid, tmid: tmid });
    };

    // Exportar referencias útiles
    module.exports.ioInstance = io;
    module.exports.studentNotifications = studentNotifications;
    module.exports.teacherNotifications = teacherNotifications;
}

module.exports.configSocket = configSocket;