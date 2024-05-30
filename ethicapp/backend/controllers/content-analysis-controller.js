"use strict";

let pg = require("pg");
let express = require("express");
let router = express.Router();
let rpg = require("../db/rest-pg");
let pass = require("../config/keys-n-secrets");
let socket = require("../config/socket.config");
const {isContentAnalysisAvailable} = require("../services/content-analysis");

var DB = null;
function getDBInstance(dbcon) {
    if (DB == null) {
        DB = new pg.Client(dbcon);
        DB.connect();
        DB.on("error", function(err){
            console.error(err);
            DB = null;
        });
        return DB;
    }
    return DB;
}

router.post('/content-analysis-callback', async (req, res) => {
    if(!isContentAnalysisAvailable()){
        return res.status(503).json({ error: "Content analysis is not available" });
    }
    try {
    
        const data = req.body;
        
        const stageId = data.context.phase_id;
        req.body.stage_id = stageId;
        req.body.sesid = data.context.session_id;

        var sql = `
            INSERT INTO content_analysis(response_selections, context, sesid, stage_id)
            VALUES (
                '${JSON.stringify(req.body.response_selections)}', 
                '${JSON.stringify(req.body.context)}',
                ${data.context.session_id},
                ${stageId}
            )
            ON CONFLICT (id) DO UPDATE
            SET response_selections = EXCLUDED.response_selections,
                context = EXCLUDED.context,
                stage_id = EXCLUDED.stage_id;
        `;
        var db = getDBInstance(pass.dbcon);
        var qry;
        qry = db.query(sql);
        qry.on("end", function () {
            socket.contentUpdate(data);
            res.status(200).json({ status: 'success'});
        });
        qry.on("error", function(err){
            console.error(err);
            res.status(500).json({ error: "Internal server error" });
        });

        
    } catch (error) {
        res.status(500).json({ error: "Internal server error" });
    }
});

router.post("/get-content-analysis", (req, res, next) => {
    if(!isContentAnalysisAvailable()){
        return res.status(503).json({ error: "Content analysis is not available" });
    }
    return rpg.multiSQL({
        dbcon: pass.dbcon,
        sql: `
            SELECT *
            FROM content_analysis
            WHERE stage_id = ${req.body.stageid}
        `,
    })(req, res, next);
});

router.post("/content-analysis-availability", (req, res, next) => {
    if(isContentAnalysisAvailable()){
        return res.status(200).json({ status: 'Content analysis is available'});
    }
    else{
        return res.status(503).json({ error: "Content analysis is not available" });
    }
});

module.exports = router;