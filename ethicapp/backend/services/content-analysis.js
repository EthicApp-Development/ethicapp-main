let Redis = require("ioredis");
let rpg = require("../db/rest-pg");
let pass = require("../config/keys-n-secrets");
const fetch = require('node-fetch');

let redisClient = new Redis({
    host: "RedisContainer", // Redis server host
    port: 6379,       // Redis server port
});


redisClient.on("error", function (error) {
    console.error(error);
  });

async function handleQuestionCounter(redisKey, req, res,) {
    try {
        
        const boolean = {
            "true": 1,
            "false": 2
        }
        
        const redisUserKey = `${redisKey}_${req.session.uid}`;

        const exists = await redisClient.exists(redisKey);
        if (exists === 0 ){
            rpg.multiSQL({
                dbcon: pass.dbcon,
                sql:   `
                SELECT *
                FROM sessions AS q
                LEFT JOIN Stages AS qa
                    ON q.current_stage = qa.id
                LEFT JOIN differential AS qb
                    ON q.id = qb.sesid AND qa.id = qb.stageid
                LEFT JOIN differential_selection AS qc
                    ON qb.id = qc.did
                WHERE q.id = $1 AND qb.id = ${req.body.did}
                `,
                sqlParams:   [rpg.param("ses", "ses")],
                preventResEnd: true,
                onEnd: async (req, res, result) => {
                    const itemsCounter = result.length;
                    const userAnswered = await redisClient.get(redisUserKey);
                    if (!userAnswered || userAnswered === 0){
                        await redisClient.set(redisKey, itemsCounter);
                        await redisClient.set(redisUserKey, boolean["true"]);
                    }
                }
            })(req,res);
        }
        else{
            const userAnswered = await redisClient.get(redisUserKey);
            if (!userAnswered || parseInt(userAnswered) === 0){
                await redisClient.incr(redisKey);
                await redisClient.set(redisUserKey, boolean["true"]);
            }
        }

        const counterInRedis = await redisClient.get(redisKey);

        if (parseInt(counterInRedis) >= 10) {
            return true;
        }
        else {
            return false;
        }
    } catch (error) {
        console.error('Error handling redis counter:', error);
        return false;
    }
}

async function buildContentAnalysisUnit(req, res) {
    return new Promise((resolve, reject) => {
        rpg.multiSQL({
            dbcon: pass.dbcon,
            sql:    `
                SELECT q.session AS session_id,
                    qc.id AS phase_id,
                    qa.path AS case_url,
                    qd.title AS question,
                    qd.id AS question_id,
                    qe.id AS response_id,
                    qe.comment AS response_text,
                    qe.uid AS user_id
                FROM activity AS q
                    LEFT JOIN designs_documents AS qa
                        ON q.design = qa.dsgnid
                    LEFT JOIN sessions AS qb
                        ON q.session = qb.id
                    LEFT JOIN Stages AS qc
                        ON qb.current_stage = qc.id
                    LEFT JOIN differential AS qd
                        ON qb.id = qd.sesid AND qc.id = qd.stageid
                    LEFT JOIN differential_selection AS qe
                        ON qd.id = qe.did
                WHERE q.session = $1 AND qd.id = ${req.body.did}
            `,
            sqlParams:   [rpg.param("ses", "ses")],
            preventResEnd: true,
            onEnd: async (req, res, result) => {
                const groupedResults = result.reduce((acc, cur) => {
                    if (!acc[cur.question_id]) {
                      acc[cur.question_id] = [];
                    }
                    acc[cur.question_id].push(cur);
                    return acc;
                  }, {});
                
                const nodeHostName = process.env.ETHICAPP_HOSTNAME;
                const nodePort = process.env.NODE_PORT;
                const sessionURL = `http://${nodeHostName}:${nodePort}/${result[0].case_url}`;

                const workUnitJson = {
                    context: {
                        session_id: result[0].session_id,
                        phase_id: result[0].phase_id,
                        callback_url: `http://${nodeHostName}:${nodePort}/content-analysis-callback`, 
                        timestamp: Date.now(),
                    },
                    content: {
                        case_url: sessionURL,
                        phase_content: Object.values(groupedResults).map(group => ({
                            question: group[0].question,
                            question_id: group[0].question_id,
                            responses: group.map(item => ({
                                response_id: item.response_id,
                                response_text: item.response_text,
                                user_id: item.user_id
                            }))
                        }))
                    }
                };
                resolve(workUnitJson);
            }
        })(req,res);
    });
}

async function sendContentAnalysisWorkunit(workunit){
    try {
        const contentAnalysisHostName = process.env.CONTENT_ANALYSIS_HOST_NAME;
        const contentAnalysisPort = process.env.CONTENT_ANALYSIS_PORT;
        const response = await fetch(`http://${contentAnalysisHostName}:${contentAnalysisPort}/top-worst`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(workunit)
        });
        if (!response.ok) {
            throw new Error('The server response was not successful');
        }
            const responseData = await response.json();
    } catch (error) {
        console.error('Error sending content analysis work unit', error);
    }
}

async function contentAnalysis(req, res) {
    if (req.body.comment) {
        try {
            const result = await new Promise((resolve, reject) => {
                rpg.singleSQL({
                    dbcon: pass.dbcon,
                    sql: `
                        SELECT qa.number as stage_id, qb.id as question_id, qc.uid
                        FROM sessions AS q
                        LEFT JOIN Stages AS qa
                        ON q.current_stage = qa.id
                        LEFT JOIN differential AS qb
                        ON q.id = qb.sesid AND qa.id = qb.stageid
                        LEFT JOIN differential_selection AS qc
                        ON qb.id = qc.did
                        WHERE q.id = $1 AND qb.id = ${req.body.did} AND qc.uid = ${req.session.uid}
                    `,
                    sqlParams: [rpg.param("ses", "ses")],
                    preventResEnd: true,
                    onEnd: (req, res, result) => {
                        resolve(result);
                    },
                    onError: (err) => {
                        reject(err);
                    }
                })(req, res);
            });

            const redisKey = `${req.session.ses}_${result.stage_id}_${result.question_id}`;
            const isCounterTenOrMore = await handleQuestionCounter(redisKey, req, res);

            if (isCounterTenOrMore) {
                const workUnitJson = await buildContentAnalysisUnit(req, res);
                await sendContentAnalysisWorkunit(workUnitJson);
            }
        } catch (error) {
            console.error("Error processing content analysis:", error);
        }
    } else {
        res.status(400).send('No comment provided');
    }
}


function isContentAnalysisAvailable(){

    const trueOrFalse = {
        "true": true,
        "false": false
    }
    const value = process.env.CONTENT_ANALYSIS_SERVICE;
    return trueOrFalse[value]
}

function initializeContentAnalysis(req, res) {
    try {
        if (isContentAnalysisAvailable()) {
            contentAnalysis(req, res);
        } else {
            res.status(503).send('Content analysis not available');
        }
    } catch (error) {
        console.error('Error running content analysis:', error);
        res.status(500).send('Internal Server Error');
    }
}

module.exports = {
    initializeContentAnalysis,
    isContentAnalysisAvailable
};