const celery = require("celery-node");
const client = celery.createClient("redis://localhost:6379/0", "redis://localhost:6379/0");


var getDataRealTime = client.createTask('get-data-rt', queue='celery');
var getDifferentialByStage = client.createTask('get-prediction-by-stage', queue='celery');
let socket = require("../modules/socket.config");


module.exports.sendDiffSelection = async function (dataDiffSelection) {
    let result = getDataRealTime.applyAsync([dataDiffSelection])
    await result.get().then(data => {
        return data
      }).catch(err => {console.log(err);});
}

module.exports.sendAllDiffselection = async function (dataAllDifferential) {
  let result = getDifferentialByStage.applyAsync([dataAllDifferential])
  await result.get().then(data => {
      console.log(data);
      if (data.hasOwnProperty("job")) {
        data.job.map(job => {
          console.log(job);
    
        })
      } else {
      socket.dashboard(data);
      }
      return data
    }).catch(err => {console.log(err);});
}



