module.exports.configSocket = function(io){
    module.exports.stateChange = function(sesid){
        io.of("/").emit("stateChange", {ses: sesid});
    };
    module.exports.updateTeam = function(tmid){
        io.of("/").emit("updateTeam", {tmid: tmid});
    };
};