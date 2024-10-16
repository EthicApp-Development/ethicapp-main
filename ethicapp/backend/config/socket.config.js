const configSocket = function(io) {
    module.exports.stateChange = function(sesid){
        io.of("/").emit("stateChange", {ses: sesid});
    };
    module.exports.updateTeam = function(tmid){
        io.of("/").emit("updateTeam", {tmid: tmid});
    };
    module.exports.reportChange = function(sesid){
        io.of("/").emit("reportChange", {ses: sesid});
    };
    module.exports.reportBroadcast = function(sesid, rid){
        io.of("/").emit("reportReceived", {ses: sesid, rid: rid});
    };
    module.exports.diffBroadcast = function(sesid, content){
        io.of("/").emit("diffReceived", {ses: sesid, content: content});
    };
    module.exports.teamProgress = function(sesid, tmid){
        io.of("/").emit("teamProgress", {ses: sesid, tmid: tmid});
    };
    module.exports.chatMsg = function(sesid, tmid){
        io.of("/").emit("chatMsg", {ses: sesid, tmid: tmid});
    };
    module.exports.chatMsgStage = function(stageid, tmid){
        io.of("/").emit("chatMsgStage", {stageid: stageid, tmid: tmid});
    };
    module.exports.contentUpdate = function(data){
        io.of("/").emit("contentUpdate", {data: data});
    };
};

export default configSocket;
