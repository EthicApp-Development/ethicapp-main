const configSocket = function(io) {
    const stateChange = function(sesid) {
        io.of("/").emit("stateChange", { ses: sesid });
    };

    const updateTeam = function(tmid) {
        io.of("/").emit("updateTeam", { tmid: tmid });
    };

    const reportChange = function(sesid) {
        io.of("/").emit("reportChange", { ses: sesid });
    };

    const reportBroadcast = function(sesid, rid) {
        io.of("/").emit("reportReceived", { ses: sesid, rid: rid });
    };

    const diffBroadcast = function(sesid, content) {
        io.of("/").emit("diffReceived", { ses: sesid, content: content });
    };

    const teamProgress = function(sesid, tmid) {
        io.of("/").emit("teamProgress", { ses: sesid, tmid: tmid });
    };

    const chatMsg = function(sesid, tmid) {
        io.of("/").emit("chatMsg", { ses: sesid, tmid: tmid });
    };

    const chatMsgStage = function(stageid, tmid) {
        io.of("/").emit("chatMsgStage", { stageid: stageid, tmid: tmid });
    };

    const contentUpdate = function(data) {
        io.of("/").emit("contentUpdate", { data: data });
    };

    return {
        stateChange,
        updateTeam,
        reportChange,
        reportBroadcast,
        diffBroadcast,
        teamProgress,
        chatMsg,
        chatMsgStage,
        contentUpdate
    };
};

export default configSocket;
