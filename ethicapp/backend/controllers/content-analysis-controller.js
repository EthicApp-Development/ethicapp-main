let pg = require("pg");
let express = require("express");
let router = express.Router();
let rpg = require("../db/rest-pg");
let pass = require("../config/keys-n-secrets");
let socket = require("../config/socket.config");

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
            socket.contentUpdate(req.session.ses, data);
            res.status(200).json({ status: 'success'});
        });
        qry.on("error", function(err){
            console.error(err);
            res.end('{"status":"err"}');
        });

        
    } catch (error) {
        console.error('Error al procesar el callback:', error);
        res.end('{"status":"err"}');
    }
});

router.post("/get-content-analysis", (req, res, next) => {
    return rpg.multiSQL({
        dbcon: pass.dbcon,
        sql: `
            SELECT *
            FROM content_analysis
            WHERE stage_id = ${req.body.stageid}
        `,
    })(req, res, next);
});