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
};