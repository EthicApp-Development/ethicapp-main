module.exports.configSocket = function(io){
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
    module.exports.updateOverlay = function(qid){
        io.of("/").emit("updateOverlay", {qid: qid});
    };
    module.exports.chatMsg = function(sesid, tmid){
        io.of("/").emit("chatMsg", {ses: sesid, tmid: tmid});
    };
    module.exports.chatMsgStage = function(stageid, tmid){
        io.of("/").emit("chatMsgStage", {stageid: stageid, tmid: tmid});
    };
};
