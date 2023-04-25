"use strict";

let express = require("express");
let router = express.Router();
let rpg = require("../modules/rest-pg");
let pass = require("../modules/passwords");
let pg = require("pg");
require("../midleware/validate-session");

var DB = null;


var getDBInstance = function(dbcon) {
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
};


router.get("/seslist", (req, res) => {
    if (req.session.uid) {
        if (req.session.role == "P")
            //res.redirect("admin");
            res.redirect("home");
        else
            res.render("seslist");
    }
    else
        res.redirect(".");
});


router.post("/get-session-list", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT *
    FROM (
        SELECT DISTINCT s.id,
            s.name,
            s.descr,
            s.status,
            s.type,
            s.time,
            s.code,
            s.options,
            s.archived,
            s.current_stage,
            (
                s.id in (SELECT sesid FROM teams)
            ) AS grouped,
            (
                SELECT count(*)
                FROM report_pair
                WHERE sesid = s.id
            ) AS paired,
            sr.stime
        FROM sessions AS s
        LEFT OUTER JOIN status_record AS sr
        ON sr.sesid = s.id
            AND s.status = sr.status,
        sesusers AS su,
        users AS u
        WHERE su.uid = $1
            AND (OPTIONS like 'X%') IS NOT TRUE
            AND u.id = su.uid
            AND su.sesid = s.id
    ) AS v
    ORDER BY v.time DESC
    `,
    sesReqData: ["uid"],
    sqlParams:  [rpg.param("ses", "uid")]
}));


router.post("/add-session", rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    WITH ROWS AS (
        INSERT INTO sessions(name, descr, creator, TIME, status, TYPE)
        VALUES ($1,
            $2,
            $3,
            now(),
            1,
            $4
        ) RETURNING id
    )
    INSERT INTO sesusers(sesid, UID)
    SELECT id,
        $5
    FROM ROWS
    `,
    sesReqData:  ["uid"],
    postReqData: ["name", "type"],
    sqlParams:   [
        rpg.param("post", "name"), rpg.param("post", "descr"), rpg.param("ses", "uid"),
        rpg.param("post","type"), rpg.param("ses", "uid")
    ],
    onStart: (ses) => {
        if (ses.role != "P") {
            console.warn("Sólo profesor puede crear sesiones");
            console.warn(ses);
            return "SELECT $1, $2, $3, $4, $5";
        }
    },
    onEnd: (req, res) => {
        res.redirect("admin");
    }
}));


router.post("/add-session-activity", (req, res) => {
    var uid = req.session.uid;
    var name =req.body.name;
    var descr = req.body.descr;
    var type = req.body.type;
    var sql = `
    WITH ROWS AS (
        INSERT INTO sessions(name, descr, creator, TIME, status, TYPE)
        VALUES (
            '${name}', '${descr}', ${uid}, now(), 1, '${type}'
        )
        RETURNING id
    )
    INSERT INTO sesusers(sesid, UID)
    SELECT id, ${uid}
    FROM ROWS;
    SELECT max(id)
    FROM sessions
    WHERE creator = ${uid}
    `;
    var db = getDBInstance(pass.dbcon);
    var qry;
    var result;
    qry = db.query(sql,(err,res) =>{
        if(res != null) result = res.rows[0].max;
    });
    qry.on("end", function () {
        res.json({status: 200, id: result});
    });
    qry.on("error", function(err){
        console.error(`Fatal error on the SQL query "${sql}"`);
        console.error(err);
        res.json({status: 400, });

    });
});


router.post("/add-activity", (req, res) => {
    var sesid =req.body.sesid;
    var dsgnid = req.body.dsgnid;
    var sql = `
    INSERT INTO ACTIVITY (design, SESSION)
    VALUES (${dsgnid}, ${sesid});

    UPDATE designs
    SET locked = TRUE
    WHERE id = ${dsgnid};

    SELECT design
    FROM DESIGNS
    WHERE id = ${dsgnid};
    `;
    var db = getDBInstance(pass.dbcon);
    var qry;
    var result;
    qry = db.query(sql, (err,res) =>{
        if(res!= null) result = res.rows[0].design;
    });
    qry.on("end", function () {
        res.json({status: 200, "result": result});
    });
    qry.on("error", function(err){
        console.error(`Fatal error on the SQL query "${sql}"`);
        console.error(err);
        res.json({status: 400, });

    });
});

router.post("/check-design", (req, res) => {
    var dsgnid = req.body.dsgnid;
    var sql = `
    SELECT design
    FROM DESIGNS
    WHERE id = ${dsgnid};
    `;
    var db = getDBInstance(pass.dbcon);
    var qry;
    var result = true;
    var phases;
    qry = db.query(sql, (err,res) =>{
        if(res!= null) {
            phases = res.rows[0].design.phases;
            for(let i =0; i< phases.length; i++){
                var phase = phases[i];
                var questions = phase.questions;
                for(let j=0; j<questions.length; j++){
                    var question = questions[j];
                    var isQtextNA = (question.q_text === "" || question.q_text === "-->>N/A<<--");
                    var isLpoleNA = (question.ans_format.l_pole === "" | 
                                    question.ans_format.l_pole === "-->>N/A<<--");
                    var isRpoleNA = (question.ans_format.r_pole === "" | 
                                    question.ans_format.l_pole === "-->>N/A<<--");
                    question.q_text = isQtextNA ? result = false : result;
                    question.ans_format.l_pole = isLpoleNA ? result = false : result;
                    question.ans_format.r_pole = isRpoleNA ? result = false : result;
                }
            }
            return;
        }
    });
    qry.on("end", function () {
        res.json({status: 200, "result": result});
    });
    qry.on("error", function(err){
        console.error(`Fatal error on the SQL query "${sql}"`);
        console.error(err);
        res.json({status: 400, });

    });
});


router.post("/get-activities", (req, res) => {
    var uid = req.session.uid;
    var sql = `
    SELECT activity.id,
        activity.session,
        sessions.creator,
        sessions.name,
        sessions.descr,
        sessions.time,
        sessions.code,
        sessions.archived,
        designs.design,
        sessions.status,
        sessions.type,
        designs.id AS dsgnid
    FROM activity
    INNER JOIN sessions
    ON activity.session = sessions.id
    INNER JOIN designs
    ON activity.design = designs.id
    WHERE sessions.creator = ${uid};
    `;
    var db = getDBInstance(pass.dbcon);
    var qry;
    var result;
    qry = db.query(sql,(err,res) =>{
        if (res != null)
            result = res.rows;
    });
    qry.on("end", function () {
        res.json({status: 200, activities: result});
    });
    qry.on("error", function(err){
        console.error(`Fatal error on the SQL query "${sql}"`);
        console.error(err);
        res.json({status: 400, });
    });
});


router.get("/admin", (req, res) => {
    if (req.session.role == "P")
        res.render("admin");
    else
        res.redirect(".");
});


//TEST ROUTE DELETE LATER
router.get("/home", function(req,res){
    if (req.session.role == "P" || req.session.role == "I" || req.session.role == "S")
        res.render("home");
    else
        res.redirect(".");
});


router.post("/update-session", rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    UPDATE sessions
    SET name = $1,
        descr = $2
    WHERE id = $3
    `,
    sesReqData: ["name", "descr", "id"],
    sqlParams:  [
        rpg.param("post", "name"), rpg.param("post", "descr"), rpg.param("post", "id")
    ]
}));


router.post("/upload-file", (req, res) => {
    if (
        req.session.uid != null && req.body.title != null && req.body.title != "" &&
        req.files.pdf != null && req.files.pdf.mimetype == "application/pdf" &&
        req.body.sesid != null
    ) {
        rpg.execSQL({
            dbcon: pass.dbcon,
            sql:   `
            INSERT INTO documents(title, PATH, sesid, uploader)
            VALUES ($1,$2,$3,$4)
            `,
            sqlParams: [
                rpg.param("post", "title"), rpg.param("calc", "path"),
                rpg.param("post", "sesid"), rpg.param("ses", "uid")
            ],
            onStart: (ses, data, calc) => {
                calc.path = "uploads" + req.files.pdf.file.split("uploads")[1];
            },
            onEnd: () => {
            }
        })(req, res);
        res.end('{"status":"ok"}');
    }
    res.end('{"status":"err"}');
});


router.post("/upload-design-file", (req, res) => {
    if (
        req.session.uid != null  && req.files.pdf != null
        && req.files.pdf.mimetype == "application/pdf"
    ) {
        rpg.execSQL({
            dbcon: pass.dbcon,
            sql:   `
            INSERT INTO designs_documents(PATH, dsgnid, uploader)
            VALUES ($1,$2,$3)
            `,
            sqlParams: [
                rpg.param("calc", "path"), rpg.param("post", "dsgnid"), rpg.param("ses", "uid")
            ],
            onStart: (ses, data, calc) => {
                calc.path = "uploads" + req.files.pdf.file.split("uploads")[1];
            },
            onEnd: () => {
            }
        })(req, res);
        res.end('{"status":"ok"}');
    }
    res.end('{"status":"err"}');
});


router.post("/delete-design-document", rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    UPDATE designs_documents
    SET active = FALSE
    WHERE id = $1
    `,
    postReqData: ["dsgnid"],
    sqlParams:   [rpg.param("post", "dsgnid")]
}));


router.post("/upload-design", (req, res) => {
    var id = req.session.uid;
    var sql = `
    INSERT INTO DESIGNS(creator, design)
    VALUES (${id}, '${JSON.stringify(req.body)}')
    `;
    var sql2 = "SELECT max(id) FROM DESIGNS WHERE creator = "+id;
    var db = getDBInstance(pass.dbcon);
    var qry;
    var qry2;
    var result;
    qry = db.query(sql);
    qry.on("end", function () {
        qry2 = db.query(sql2,(err,res) =>{
            if(res!= null){
                result = res.rows[0].max;
            }
        });
        qry2.on("end", function () {
            res.end('{"status":"ok", "id":'+result+"}");   
        });
            
    });
    qry.on("error", function(err){
        console.error(err);
        res.end('{"status":"err"}');
    });
});


router.post("/get-design", (req, res) => {
    // var uid = req.session.uid;
    var id = req.body;
    var sql = `
    SELECT *
    FROM DESIGNS
    WHERE id = ${id}
    `;
    var db = getDBInstance(pass.dbcon);
    var qry;
    var result;
    qry = db.query(sql,(err,res) =>{
        if(res != null){
            result = JSON.stringify(res.rows[0].design);   
        }
    });
    qry.on("end", function () {
        res.end('{"status":"ok", "result":'+result+"}");
    });
    qry.on("error", function(err){
        console.error(`Fatal error on the SQL query "${sql}"`);
        console.error(err);
        res.end('{"status":"err"}');
    });
});


router.get("/get-user-designs", (req, res) => {
    var uid = req.session.uid;
    var sql = `
    SELECT *
    FROM DESIGNS
    WHERE creator = ${uid}
    ORDER BY id DESC;
    `;
    var db = getDBInstance(pass.dbcon);
    var qry;
    var result = [];
    qry = db.query(sql,(err,res) =>{
        if(res != null){
            for (let i=0; i<res.rows.length;i++) result.push(res.rows[i].design);
            for (let i=0; i<result.length;i++) result[i].id= res.rows[i].id; //add id to to design
            for (let i=0; i<result.length;i++) result[i].public= res.rows[i].public; //add id to to design
            for (let i=0; i<result.length;i++) result[i].locked= res.rows[i].locked; //add id to to design
        }
    });
    qry.on("end", function () {
        res.json({"status": "ok", "result": result});
    });
    qry.on("error", function(err){
        console.error(`Fatal error on the SQL query "${sql}"`);
        console.error(err);
        res.end('{"status":"err"}');
    });
});

router.get("/get-public-designs", (req, res) => {
    var uid = req.session.uid;
    var sql = `
    SELECT *
    FROM DESIGNS
    WHERE public = true
        AND creator != ${uid}
    ORDER BY id DESC;
    `;
    var db = getDBInstance(pass.dbcon);
    var qry;
    var result = [];
    qry = db.query(sql,(err,res) =>{
        if(res != null){
            for (let i=0; i<res.rows.length;i++) result.push(res.rows[i].design);
            for (let i=0; i<result.length;i++) result[i].id= res.rows[i].id; //add id to to design
        }
    });
    qry.on("end", function () {
        res.json({"status": "ok", "result": result});
    });
    qry.on("error", function(err){
        console.error(`Fatal error on the SQL query "${sql}"`);
        console.error(err);
        res.end('{"status":"err"}');
    });
});

router.post("/design-public", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    UPDATE DESIGNS
    SET PUBLIC = NOT PUBLIC
    WHERE id = $1;
    `,
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post", "dsgnid")]
}));

router.post("/design-lock", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    UPDATE DESIGNS
    SET locked = NOT locked
    WHERE id = $1;
    `,
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post", "dsgnid")]
}));


router.post("/update-design", (req, res) => {
    var uid = req.session.uid;
    var id = req.body.id;
    var sql = `
    UPDATE DESIGNS
    SET design = '${JSON.stringify(req.body.design)}'
    WHERE creator = ${uid}
        AND id = ${id}
    `;
    var db = getDBInstance(pass.dbcon);
    var qry;
    qry = db.query(sql);
    qry.on("end", function () {
        res.end('{"status":"ok"}');
    });
    qry.on("error", function(err){
        console.error(`Fatal error on the SQL query "${sql}"`);
        console.error(err);
        res.end('{"status":"err"}');
    });
});


router.post("/delete-design", (req, res) => {
    var uid = req.session.uid;
    var id = req.body.id;
    var sql = `
    DELETE FROM DESIGNS
    WHERE creator = ${uid}
        AND id = ${id}
    `;
    var db = getDBInstance(pass.dbcon);
    var qry;
    qry = db.query(sql);
    qry.on("end", function () {
        res.end('{"status":"ok"}');
    });
    qry.on("error", function(err){
        console.error(`Fatal error on the SQL query "${sql}"`);
        console.error(err);
        res.end('{"status":"err"}');
    });
});

router.post("/designs-documents", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT id,
        PATH
    FROM designs_documents
    WHERE dsgnid = $1
        AND active = TRUE
    `,
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post", "dsgnid")]
}));


//############################################
router.post("/documents-session", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT id,
        title,
        PATH
    FROM documents
    WHERE sesid = $1
        AND active = TRUE
    `,
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post", "sesid")]
}));

router.post("/questions-session", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT id,
        content,
        OPTIONS,
        answer,
        COMMENT,
        other,
        textid,
        plugin_data
    FROM questions
    WHERE sesid = $1
    ORDER BY id ASC
    `,
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post", "sesid")]
}));


router.post("/get-new-users", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT id,
        name,
        mail
    FROM users
    WHERE id NOT IN (
        SELECT u.id
        FROM users AS u,
            sesusers AS su
        WHERE u.id = su.uid
            AND su.sesid = $1
    )
    `,
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post", "sesid")]
}));

router.post("/get-ses-users", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT u.id,
        u.name,
        u.mail,
        u.aprendizaje,
        u.role,
        su.device
    FROM users AS u,
        sesusers AS su
    WHERE u.id = su.uid
        AND su.sesid = $1
    ORDER BY u.role DESC
    `,
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post", "sesid")]
}));

router.post("/add-ses-users", (req, res) => {
    let sql = `
    INSERT INTO sesusers(UID, sesid)
    VALUES
    `;
    req.body.users.forEach((uid) => {
        if (!isNaN(uid))
            sql += `(${uid},${req.body.sesid}), `;
    });
    sql = sql.substring(0, sql.length - 2); // removing trailing comma
    rpg.execSQL({
        dbcon: pass.dbcon,
        sql:   sql
    })(req, res);
});

router.post("/get-all-users", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT u.id,
        u.name,
        u.mail,
        u.rut,
        u.role
    FROM users AS u
    `,
    sqlParams: [],
    onStart:   (ses) => {
        if (ses.role != "S") return "SELECT 1";
    },
}));

router.post("/convert-prof", rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    UPDATE users
    SET ROLE = 'P'
    WHERE id = $1
    `,
    postReqData: ["uid"],
    sqlParams:   [rpg.param("post", "uid")],
    onStart:     (ses) => {
        if (ses.role != "S") return "SELECT $1";
    },
}));

router.post("/remove-prof", rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    UPDATE users
    SET ROLE = 'R'
    WHERE id = $1
    `,
    postReqData: ["uid"],
    sqlParams:   [rpg.param("post", "uid")],
    onStart:     (ses) => {
        if (ses.role != "S") return "SELECT $1";
    },
}));

router.post("/get-question-text", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT id,
        title,
        content
    FROM question_text
    WHERE sesid = $1
    `,
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post", "sesid")]
}));

router.post("/delete-ses-user", rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    DELETE
    FROM sesusers
    WHERE sesid = $1
        AND UID = $2
    `,
    postReqData: ["sesid", "uid"],
    sqlParams:   [rpg.param("post", "sesid"), rpg.param("post", "uid")]
}));


router.post("/get-selection-comment", rpg.singleSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT answer,
        COMMENT,
        confidence
    FROM selection
    WHERE UID = $1
        AND qid = $2
        AND iteration = $3
    `,
    postReqData: ["qid", "uid", "iteration"],
    sqlParams:   [
        rpg.param("post", "uid"), rpg.param("post", "qid"), rpg.param("post", "iteration")
    ]
}));


router.post("/get-selection-team-comment", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT s.answer,
        s.comment,
        s.confidence,
        u.name AS uname
    FROM selection AS s
    INNER JOIN teamusers AS tu
    ON tu.uid = s.uid
    INNER JOIN users AS u
    ON u.id = s.uid
    WHERE tu.tmid = $1
        AND s.qid = $2
        AND iteration = 3
    `,
    postReqData: ["qid", "tmid"],
    sqlParams:   [rpg.param("post", "tmid"), rpg.param("post", "qid")]
}));

router.post("/semantic-documents", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT id,
        title,
        content
    FROM semantic_document
    WHERE sesid = $1
    ORDER BY orden ASC
    `,
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post", "sesid")]
}));

router.post("/get-semantic-documents", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT id,
        title,
        content
    FROM semantic_document
    WHERE sesid = $1
    ORDER BY orden ASC
    `,
    sesReqData: ["ses"],
    sqlParams:  [rpg.param("ses", "ses")]
}));


router.post("/add-semantic-unit", rpg.singleSQL({
    dbcon: pass.dbcon,
    sql:   `
    INSERT INTO semantic_unit(sentences, docs, COMMENT, UID, sesid, iteration)
    VALUES ($1,$2,$3,$4,$5,$6)
    RETURNING id
    `,
    postReqData: ["comment", "sentences", "docs", "iteration"],
    sesReqData:  ["uid", "ses"],
    sqlParams:   [
        rpg.param("post", "sentences"), rpg.param("post", "docs"), rpg.param("post", "comment"),
        rpg.param("ses", "uid"), rpg.param("ses", "ses"), rpg.param("post", "iteration")
    ]
}));

router.post("/add-sync-semantic-unit", rpg.singleSQL({
    dbcon: pass.dbcon,
    sql:   `
    INSERT INTO semantic_unit(sentences, docs, COMMENT, UID, sesid, iteration)
    VALUES ($1,$2,$3,$4,$5,$6)
    RETURNING id
    `,
    postReqData: ["comment", "sentences", "docs", "iteration", "uidoriginal"],
    sesReqData:  ["uid", "ses"],
    sqlParams:   [
        rpg.param("post", "sentences"), rpg.param("post", "docs"), rpg.param("post", "comment"),
        rpg.param("post", "uidoriginal"), rpg.param("ses", "ses"), rpg.param("post", "iteration")
    ]
}));


router.post("/update-semantic-unit", rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    UPDATE semantic_unit
    SET
        (sentences, COMMENT, docs) = ($1, $2, $3)
    WHERE id = $4
    `,
    postReqData: ["comment", "sentences", "docs", "id"],
    sesReqData:  ["uid"],
    sqlParams:   [
        rpg.param("post", "sentences"), rpg.param("post", "comment"),
        rpg.param("post", "docs"), rpg.param("post", "id")
    ]
}));


router.post("/get-semantic-units", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT u.id,
        u.sentences,
        u.comment,
        u.docs,
        u.iteration
    FROM semantic_unit AS u
    WHERE u.uid = $1
        AND u.sesid = $2
        AND (
            u.iteration = $3
            OR u.iteration <= 0
        )
    `,
    sesReqData:  ["uid", "ses"],
    postReqData: ["iteration"],
    sqlParams:   [
        rpg.param("ses", "uid"), rpg.param("ses", "ses"), rpg.param("post", "iteration")
    ]
}));


router.post("/get-team-sync-units", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT u.id,
        u.sentences,
        u.comment,
        u.docs,
        u.iteration
    FROM semantic_unit AS u
    WHERE u.uid in (
        SELECT original_leader
        FROM teams
        INNER JOIN teamusers
        ON tmid = id
        WHERE UID = $1
        AND sesid = $2
    )
        AND u.sesid = $3
        AND u.iteration = 3
    ORDER BY u.id ASC
    `,
    sesReqData: ["uid", "ses"],
    sqlParams:  [rpg.param("ses", "uid"), rpg.param("ses", "ses"), rpg.param("ses", "ses")]
}));


router.post("/delete-semantic-unit", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    DELETE
    FROM semantic_unit
    WHERE id = $1
    `,
    postReqData: ["id"],
    sqlParams:   [rpg.param("post", "id")]
}));


router.post("/update-ses-options", rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    UPDATE sessions
    SET OPTIONS = $1
    WHERE id = $2
    `,
    postReqData: ["sesid", "options"],
    sqlParams:   [rpg.param("post", "options"), rpg.param("post", "sesid")]
}));


router.post("/differentials", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT *
    FROM differential
    WHERE sesid = $1
    ORDER BY orden
    `,
    postReqData: ["sesid"],
    sesReqData:  ["uid"],
    sqlParams:   [rpg.param("post", "sesid")]
}));


router.post("/get-differentials", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT *
    FROM differential
    WHERE sesid = $1
    ORDER BY orden
    `,
    sesReqData: ["uid", "ses"],
    sqlParams:  [rpg.param("ses", "ses")]
}));


router.post("/get-differentials-stage", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT *
    FROM differential
    WHERE stageid = $1
    ORDER BY orden
    `,
    postReqData: ["stageid"],
    sesReqData:  ["uid"],
    sqlParams:   [rpg.param("post", "stageid")]
}));


router.post("/add-differential", rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    INSERT INTO differential(title, tleft, tright, orden, creator, sesid)
    SELECT $1,
        $2,
        $3,
        $4,
        $5,
        $6
    WHERE NOT EXISTS (
        SELECT id
        FROM differential
        WHERE orden = $7
            AND sesid = $8
    )
    `,
    postReqData: ["orden", "tleft", "tright", "name", "sesid"],
    sesReqData:  ["uid"],
    sqlParams:   [
        rpg.param("post", "name"), rpg.param("post", "tleft"), rpg.param("post", "tright"),
        rpg.param("post", "orden"), rpg.param("ses", "uid"), rpg.param("post", "sesid"),
        rpg.param("post", "orden"), rpg.param("post", "sesid")
    ]
}));


router.post("/add-differential-stage", rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    INSERT INTO differential(
        title, tleft, tright, orden, creator, stageid, num, justify, sesid, word_count
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `,
    postReqData: ["orden", "tleft", "tright", "name", "stageid", "num", "justify", "sesid"],
    sesReqData:  ["uid"],
    sqlParams:   [
        rpg.param("post", "name"), rpg.param("post", "tleft"), rpg.param("post", "tright"),
        rpg.param("post", "orden"), rpg.param("ses", "uid"), rpg.param("post", "stageid"),
        rpg.param("post", "num"), rpg.param("post", "justify"), rpg.param("post", "sesid"),
        rpg.param("post", "word_count")
    ]
}));


router.post("/update-differential", rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    UPDATE differential
    SET title = $1,
        tleft = $2,
        tright = $3
    WHERE id = $4
    `,
    postReqData: ["tleft", "tright", "name", "id"],
    sesReqData:  ["uid"],
    sqlParams:   [
        rpg.param("post", "name"), rpg.param("post", "tleft"), rpg.param("post", "tright"),
        rpg.param("post", "id")
    ]
}));


router.post("/duplicate-session", (req, res) => {
    if (
        req.session.uid != null && req.session.role == "P" && req.body.name != null
        && req.body.name != "" && req.body.tipo != null && req.body.descr != null
        && req.body.originalSesid != null
    ) {
        rpg.singleSQL({
            dbcon: pass.dbcon,
            sql:   `
            INSERT INTO sessions(name, descr, creator, TIME, status, TYPE)
            VALUES ($1, $2, $3, now(), 1, $4)
            RETURNING id
            `,
            postReqData: ["sesid", "uid"],
            sqlParams:   [
                rpg.param("post", "name"), rpg.param("post", "descr"), rpg.param("ses", "uid"),
                rpg.param("post", "tipo")
            ],
            onEnd: (req, res, result) => {
                let sesid = result.id;
                let oldsesid = req.body.originalSesid;
                if (req.body.copyUsers) {
                    rpg.execSQL({
                        dbcon: pass.dbcon,
                        sql:   `
                        INSERT INTO sesusers(sesid, UID)
                        SELECT ${sesid} AS sesid, UID
                        FROM sesusers
                        WHERE sesid = ${oldsesid}
                        `,
                        preventResEnd: true,
                        onEnd:         () => {}
                    })(req,res);
                }
                else {
                    rpg.execSQL({
                        dbcon: pass.dbcon,
                        sql:   `
                        INSERT INTO sesusers(sesid, UID)
                        VALUES (${sesid}, ${req.session.uid})
                        `,
                        preventResEnd: true,
                        onEnd:         () => {}
                    })(req,res);
                }
                if (req.body.copySemDocs) {
                    rpg.execSQL({
                        dbcon: pass.dbcon,
                        sql:   `
                        INSERT INTO semantic_document(sesid, title, content, orden)
                        SELECT ${sesid} AS sesid,
                            title,
                            content,
                            orden
                        FROM semantic_document
                        WHERE sesid = ${oldsesid}
                        `,
                        preventResEnd: true,
                        onEnd:         () => {}
                    })(req,res);
                }
                if (req.body.copySemUnits) {
                    rpg.execSQL({
                        dbcon: pass.dbcon,
                        sql:   `
                        INSERT INTO semantic_unit(sesid, sentences, COMMENT, UID, iteration, docs)
                        SELECT ${sesid} AS sesid,
                            sentences,
                            COMMENT,
                            UID,
                            0 AS iteration,
                            docs
                        FROM semantic_unit
                        WHERE sesid = ${oldsesid}
                            AND iteration <= 0
                        `,
                        preventResEnd: true,
                        onEnd:         () => {}
                    })(req,res);
                }
                if (req.body.copyDocuments) {
                    rpg.execSQL({
                        dbcon: pass.dbcon,
                        sql:   `
                        INSERT INTO documents(sesid, title, PATH, uploader, active)
                        SELECT ${sesid} AS sesid,
                            title,
                            PATH,
                            uploader,
                            active
                        FROM documents
                        WHERE sesid = ${oldsesid}
                        `,
                        preventResEnd: true,
                        onEnd:         () => {}
                    })(req,res);
                }
                if (req.body.copyDifferentials) {
                    rpg.execSQL({
                        dbcon: pass.dbcon,
                        sql:   `
                        INSERT INTO differential(sesid, title, tleft, tright, orden, creator)
                        SELECT ${sesid} AS sesid,
                            title,
                            tleft,
                            tright,
                            orden,
                            creator
                        FROM differential
                        WHERE sesid = ${oldsesid}
                        `,
                        preventResEnd: true,
                        onEnd:         () => {}
                    })(req,res);
                }
                if (req.body.copyQuestions) {
                    rpg.execSQL({
                        dbcon: pass.dbcon,
                        sql:   `
                        INSERT INTO questions(
                            sesid, content, OPTIONS, answer, COMMENT, other, textid, plugin_data,
                            cpid
                        )
                        SELECT ${sesid} AS sesid,
                            content,
                            OPTIONS,
                            answer,
                            COMMENT,
                            other,
                            textid,
                            plugin_data,
                            id AS cpid
                        FROM questions
                        WHERE sesid = ${oldsesid}
                        ORDER BY id ASC
                        `,
                        preventResEnd: true
                    })(req,res);
                    rpg.execSQL({
                        dbcon: pass.dbcon,
                        sql:   `
                        INSERT INTO question_text(sesid, content, title)
                        SELECT ${sesid} AS sesid,
                            content,
                            title
                        FROM question_text
                        WHERE sesid = ${oldsesid}
                        `,
                        preventResEnd: true,
                        onEnd:         () => {}
                    })(req,res);
                }
                if (req.body.copyIdeas) {
                    console.log("Copy Ideas is not implemented yet"); //?
                }
                if (req.body.copyRubrica) {
                    rpg.singleSQL({
                        dbcon: pass.dbcon,
                        sql:   `
                        INSERT INTO rubricas(sesid)
                        VALUES (${sesid})
                        RETURNING id
                        `,
                        onEnd: (req, res, result) => {
                            rpg.execSQL({
                                dbcon: pass.dbcon,
                                sql:   `
                                INSERT INTO criteria(
                                    name, pond, inicio, proceso, competente, avanzado, rid
                                )
                                SELECT c.name,
                                    c.pond,
                                    c.inicio,
                                    c.proceso,
                                    c.competente,
                                    c.avanzado, ${result.id} AS rid
                                FROM criteria AS c
                                INNER JOIN rubricas AS r
                                ON r.id = c.rid
                                WHERE r.sesid = ${oldsesid}
                                `,
                                onEnd:         () => {},
                                preventResEnd: true
                            })(req,res);
                        },
                        preventResEnd: true
                    })(req,res);
                }
            }
        })(req,res);
    }
    else {
        res.end('{"status":"err"}');
    }
});


router.get("/export-session-data-sel", (req,res) => {
    let id = req.query.id;
    if (!isNaN(id)) {
        rpg.multiSQL({
            dbcon: pass.dbcon,
            sql:   `
            SELECT u.name AS nombre,
                q.content AS pregunta,
                substring(
                    'ABCDE'
                    FROM s.answer + 1
                    FOR 1
                ) AS alternativa,
                s.answer = q.answer AS correcta,
                s.iteration AS iteracion,
                s.comment AS comentario,
                s.confidence AS confianza,
                s.stime AS hora_respuesta
            FROM selection AS s
            INNER JOIN users AS u
            ON s.uid = u.id
            INNER JOIN questions AS q
            ON s.qid = q.id
            WHERE q.sesid = ${id}
            ORDER BY s.stime
            `,
            onEnd: (req, res, arr) => {
                res.xls("resultados.xlsx", arr);
            }
        })(req,res);
    }
    else {
        res.end("Bad Request");
    }
});


router.post("/generate-session-code", rpg.singleSQL({
    dbcon: pass.dbcon,
    sql:   `
    UPDATE sessions
    SET code = $1
    WHERE id = $2
        AND code IS NULL RETURNING code
    `,
    postReqData: ["id"],
    sesReqData:  ["uid"],
    sqlParams:   [rpg.param("calc", "code"), rpg.param("post", "id")],
    onStart:     (ses, data, calc) => {
        calc.code = generateCode(data.id);
    }
}));


router.post("/archive-session", rpg.singleSQL({
    dbcon: pass.dbcon,
    sql:   `
    UPDATE sessions
    SET archived = $1
    WHERE id = $2
    `,
    postReqData: ["sesid", "val"],
    sqlParams:   [rpg.param("post", "val"), rpg.param("post", "sesid")],
}));


router.post("/enter-session-code", rpg.singleSQL({
    dbcon: pass.dbcon,
    sql:   `
    INSERT INTO sesusers(UID, sesid, device)
    SELECT $1::int AS UID,
        id,
        $2 AS device
    FROM sessions
    WHERE code = $3
    AND NOT EXISTS (
        SELECT su.sesid
        FROM sesusers AS su,
            sessions AS s
        WHERE su.uid = $4
            AND s.code = $5
            AND su.sesid = s.id
    )
    AND NOT EXISTS (
        SELECT st.id
        FROM stages AS st,
            sessions AS ss
        WHERE st.sesid = ss.id
            AND ss.code = $6
            AND st.type = 'team'
    ) RETURNING sesid
    `,
    postReqData: ["code"],
    sesReqData:  ["uid"],
    sqlParams:   [
        rpg.param("ses", "uid"), rpg.param("post", "device"), rpg.param("post", "code"),
        rpg.param("ses", "uid"), rpg.param("post", "code"), rpg.param("post", "code")
    ],
    preventResEnd: true,
    onEnd:         (req, res, result) => {
        if(result.sesid == null){
            res.end('{"status": "end"}');
        }
        else{
            let id = result.sesid;
            rpg.singleSQL({
                dbcon: pass.dbcon,
                sql:   `
                SELECT TYPE
                FROM sessions
                WHERE id = ${id}
                `,
                onEnd: (req,res,result) => {
                    let type = result.type;
                    if(type == null){
                        res.end('{"status": "end"}');
                    }
                    else{
                        req.session.ses = id;
                        let urlr = (type == "R" || type == "J") ?
                            "role-playing" :
                            (type == "T") ? "ethics" : "select";
                        res.end(JSON.stringify({status: "ok", redirect: urlr}));
                    }
                }
            })(req,res);
        }
    }
}));


let generateCode = (id) => {
    let n = id*5 + 255 + ~~(Math.random()*5);
    let s = n.toString(16);
    return "k00000".substring(0, 6 - s.length) + s;
};


module.exports = router;
