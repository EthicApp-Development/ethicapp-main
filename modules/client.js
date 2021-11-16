const celery = require("celery-node");
const client = celery.createClient("redis://localhost:6379/0", "redis://localhost:6379/0");

var getDataRealTime = client.createTask('get-data-rt');
var getDifferentialByStage = client.createTask('get-prediction-by-stage');
let socket = require("../modules/socket.config");


module.exports.sendDiffSelection = function (dataDiffSelection) {
    result = getDataRealTime.delay([dataDiffSelection])
    result.get().then(data => {
        return data
      });
}

module.exports.sendAllDiffselection = function (dataAllDifferential) {
  let result = getDifferentialByStage.delay([dataAllDifferential])
  result.get().then(data => {
      console.log(data);
      socket.dashboard(data);
      return data
    });
}

