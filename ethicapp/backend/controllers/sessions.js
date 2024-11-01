"use strict";

import express from "express";
import pass from "../helpers/compat-helper.js"
import { getDBInstance } from "../db/rest-pg-2.js"; 
import * as rpg from "../db/rest-pg.js";
let router = express.Router();

router.get("/seslist", (req, res) => {
    if (req.session.uid) {
        if (req.session.role == "P") {
            console.debug("will redirect to /home");
            res.redirect("home");
        }
        else {
            console.debug("rendering seslist");
            res.render("seslist", {
                title: "EthicApp",
                ngApp: "SesList",
                controller:  "SesListController",
                extraScripts : `
                <script src="assets/libs/socket.min.js" defer></script>
                <script src="assets/libs/intro.min.js" defer></script>
                <script src="assets/libs/ui-bootstrap-tpls-1.1.2.min.js" defer></script>
                <script src="assets/libs/angular-intro.min.js" defer></script>
                <script src="assets/libs/ua-parser.min.js" defer></script>
                <script type="module" src="assets/js/controllers/student/sessions.mjs" defer></script>
                `
            });
        }
    }
    else {
        console.warn("No user id in session.");
        res.redirect(".");
    }
});

router.post("/get-session-list", await rpg.multiSQL({
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
            s.additional_config,
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
    FROM ROWS;

    SELECT UpdateOrInsertActivityRecord($3)
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

router.post("/add-session-activity", async (req, res) => {
    const uid = req.session.uid;
    const { name, descr, type, additionalConfig } = req.body;
    const config = additionalConfig || {};
    
    const db = getDBInstance(pass.dbcon);
    
    try {
        // Step 1: Insert into the `sessions` table and get the id returned.
        const sessionInsertSQL = `
            INSERT INTO sessions(name, descr, creator, time, status, type, additional_config)
            VALUES ($1, $2, $3, now(), 1, $4, $5)
            RETURNING id;
        `;
        const sessionValues = [name, descr, uid, type, config];
        const sessionResult = await db.query(sessionInsertSQL, sessionValues);
        const sessionId = sessionResult.rows[0].id;

        // Step 2: Insert into the `sesusers` using the obtained id.
        const sesusersInsertSQL = `
            INSERT INTO sesusers(sesid, uid)
            VALUES ($1, $2);
        `;
        const sesusersValues = [sessionId, uid];
        await db.query(sesusersInsertSQL, sesusersValues);

        // Step 3: Get the highest id for the current creator.
        const maxIdSQL = `
            SELECT max(id) FROM sessions WHERE creator = $1;
        `;
        const maxIdResult = await db.query(maxIdSQL, [uid]);
        const maxId = maxIdResult.rows[0].max;

        // Step 4: Execute stored procedure.
        const updateSQL = `
            SELECT UpdateOrInsertActivityRecord($1);
        `;
        await db.query(updateSQL, [uid]);

        // Generate response.
        res.json({ status: 200, id: maxId });

    } catch (err) {
        console.error("Error in SQL query while creating a session:", err);
        res.status(400).json({ status: 400, message: "Error creating session" });
    }
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
                if(res.rows[0].design.type == "semantic_differential"){
                    var questions = phase.questions;
                    for(let j=0; j<questions.length; j++){
                        var question = questions[j];
        
                        question.q_text = (
                            question.q_text === "" || question.q_text === "-->>N/A<<--"
                        ) ? result = false : result;
                        question.ans_format.l_pole = (
                            question.ans_format.l_pole === "" |
                            question.ans_format.l_pole === "-->>N/A<<--"
                        ) ? result = false : result;
                        question.ans_format.r_pole = (
                            question.ans_format.r_pole === "" |
                            question.ans_format.l_pole === "-->>N/A<<--"
                        ) ? result = false : result;
                    }
                }
                else if(res.rows[0].design.type == "ranking"){
                    phase.q_text = (
                        phase.q_text === "" || phase.q_text === "-->>N/A<<--"
                    ) ? result = false : result;
                    var roles = phase.roles;
                    for(let j=0; j<roles.length; j++){
                        var role = roles[j];      
                        role.name = (
                            role.name === "" || role.name === "-->>N/A<<--"
                        ) ? result = false : result;

                    }
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


router.post("/get-activities", await rpg.singleSQL({
    dbcon: pass.dbcon,
    sql: `
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
        WHERE sessions.creator = $1;
    `,
    sesReqData: ["uid"],
    sqlParams: [rpg.param("ses", "uid")],
    onEnd: async (req, res, result) => {
        res.json({ status: 200, activities: result });
    },
    onError: async (err, req, res) => {
        console.error("Error in /get-activities query:", err);
        res.status(400).json({ status: 400, error: "Error retrieving activities." });
    }
}));

router.get("/admin", (req, res) => {
    if (req.session.role == "P")
        res.render("admin");
    else
        res.redirect(".");
});

router.get("/home", function(req,res) {
    if (req.session.role == "P")
        try {
            res.render("home", {
                layout: "./layouts/teacher-app",
                ngApp: "TeacherApp",
                controller: "ManagementController"      
            });        
        } catch (error) {
            return res.status(500);
        }
    else {
        res.redirect(".");
    }
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
                calc.path = "assets/uploads" + req.files.pdf.file.split("uploads")[1];
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

router.get("/get-user-designs", await rpg.singleSQL({
    dbcon: pass.dbcon,
    sql: `
        SELECT id, design, public, locked
        FROM DESIGNS
        WHERE creator = $1
        ORDER BY id DESC;
    `,
    sesReqData: ["uid"],
    sqlParams: [rpg.param("ses", "uid")],
    onEnd: (req, res, result) => {
        // Ensure result is an array
        const rows = Array.isArray(result) ? result : [result];

        const designs = rows.map(row => ({
            ...row.design,
            id: row.id,
            public: row.public,
            locked: row.locked
        }));

        res.json({ status: "ok", result: designs });
    },
    onError: (err, req, res) => {
        console.error("Error in /get-user-designs query:", err);
        res.status(400).json({ status: "err", error: "Error retrieving user designs." });
    }
}));

router.get("/get-public-designs", await rpg.singleSQL({
    dbcon: pass.dbcon,
    sql: `
        SELECT id, design
        FROM DESIGNS
        WHERE public = true
            AND creator != $1
        ORDER BY id DESC;
    `,
    sesReqData: ["uid"],
    sqlParams: [rpg.param("ses", "uid")],
    onEnd: (req, res, result) => {
        // Ensure result is an array
        const rows = Array.isArray(result) ? result : [result];

        const designs = rows.map(row => ({
            ...row.design,
            id: row.id
        }));

        res.json({ status: "ok", result: designs });
    },
    onError: (err, req, res) => {
        console.error("Error in /get-public-designs query:", err);
        res.status(400).json({ status: "err", error: "Error retrieving public designs." });
    }
}));


router.post("/design-public", await rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    UPDATE DESIGNS
    SET PUBLIC = NOT PUBLIC
    WHERE id = $1;
    `,
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post", "dsgnid")]
}));

router.post("/design-lock", await rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    UPDATE DESIGNS
    SET locked = NOT locked
    WHERE id = $1;
    `,
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post", "dsgnid")]
}));

router.post("/update-design", await rpg.singleSQL({
    dbcon: pass.dbcon,
    sql: `
        UPDATE DESIGNS
        SET design = $1
        WHERE creator = $2
            AND id = $3
    `,
    sesReqData: ["uid"],
    postReqData: ["id", "design"],
    sqlParams: [
        rpg.param("post", "design", JSON.stringify), // Serializamos `design` como JSON
        rpg.param("ses", "uid"),
        rpg.param("post", "id")
    ],
    onEnd: (req, res) => {
        res.json({ status: "ok" });
    },
    onError: (err, req, res) => {
        console.error("Error in /update-design query:", err);
        res.status(400).json({ status: "err", error: "Error updating design." });
    }
}));

router.post("/delete-design", await rpg.singleSQL({
    dbcon: pass.dbcon,
    sql: `
        DELETE FROM DESIGNS
        WHERE creator = $1
            AND id = $2
    `,
    sesReqData: ["uid"],
    postReqData: ["id"],
    sqlParams: [
        rpg.param("ses", "uid"),
        rpg.param("post", "id")
    ],
    onEnd: (req, res) => {
        res.json({ status: "ok" });
    },
    onError: (err, req, res) => {
        console.error("Error in /delete-design query:", err);
        res.status(400).json({ status: "err", error: "Error deleting design." });
    }
}));

router.post("/designs-documents", await rpg.multiSQL({
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
router.post("/documents-session", await rpg.multiSQL({
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

router.post("/questions-session", await rpg.multiSQL({
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


router.post("/get-new-users", await rpg.multiSQL({
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

router.post("/get-ses-users", await rpg.multiSQL({
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

router.post("/add-ses-users", async (req, res) => {
    let sql = `
    INSERT INTO sesusers(UID, sesid)
    VALUES
    `;
    req.body.users.forEach((uid) => {
        if (!isNaN(uid))
            sql += `(${uid},${req.body.sesid}), `;
    });
    sql = sql.substring(0, sql.length - 2); // removing trailing comma
    await rpg.execSQL({
        dbcon: pass.dbcon,
        sql:   sql
    })(req, res);
});

router.post("/get-all-users", await rpg.multiSQL({
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

router.post("/convert-prof", await rpg.execSQL({
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

router.post("/remove-prof", await rpg.execSQL({
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

router.post("/get-question-text", await rpg.multiSQL({
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

router.post("/delete-ses-user", await rpg.execSQL({
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


router.post("/get-selection-comment", await rpg.singleSQL({
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


router.post("/get-selection-team-comment", await rpg.multiSQL({
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

router.post("/semantic-documents", await rpg.multiSQL({
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

router.post("/get-semantic-documents", await rpg.multiSQL({
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


router.post("/add-semantic-unit", await rpg.singleSQL({
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

router.post("/add-sync-semantic-unit", await rpg.singleSQL({
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


router.post("/update-semantic-unit", await rpg.execSQL({
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


router.post("/get-semantic-units", await rpg.multiSQL({
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


router.post("/get-team-sync-units", await rpg.multiSQL({
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


router.post("/delete-semantic-unit", await rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    DELETE
    FROM semantic_unit
    WHERE id = $1
    `,
    postReqData: ["id"],
    sqlParams:   [rpg.param("post", "id")]
}));


router.post("/update-ses-options", await rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    UPDATE sessions
    SET OPTIONS = $1
    WHERE id = $2
    `,
    postReqData: ["sesid", "options"],
    sqlParams:   [rpg.param("post", "options"), rpg.param("post", "sesid")]
}));


router.post("/differentials", await rpg.multiSQL({
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


router.post("/get-differentials", await rpg.multiSQL({
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


router.post("/get-differentials-stage", await rpg.multiSQL({
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


router.post("/add-differential", await rpg.execSQL({
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

router.post("/add-differential-stage", await rpg.execSQL({
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


router.post("/update-differential", await rpg.execSQL({
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


router.post("/duplicate-session", async (req, res) => {
    if (
        req.session.uid != null && req.session.role == "P" && req.body.name != null
        && req.body.name != "" && req.body.tipo != null && req.body.descr != null
        && req.body.originalSesid != null
    ) {
            await rpg.singleSQL({
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
            onEnd: async (req, res, result) => {
                let sesid = result.id;
                let oldsesid = req.body.originalSesid;
                if (req.body.copyUsers) {
                    await rpg.execSQL({
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
                    await rpg.execSQL({
                        dbcon: pass.dbcon,
                        sql:   `
                        INSERT INTO sesusers(sesid, UID)
                        VALUES (${sesid}, ${req.session.uid})
                        `,
                        preventResEnd: true,
                        onEnd:         () => {}
                    })(req,res);
                }
                if (req.body.copyDocuments) {
                    await rpg.execSQL({
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
                    await rpg.execSQL({
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
                    await rpg.execSQL({
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
                    await rpg.execSQL({
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
            }
        })(req,res);
    }
    else {
        res.end('{"status":"err"}');
    }
});

router.post("/generate-session-code", await rpg.singleSQL({
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


router.post("/archive-session", await rpg.singleSQL({
    dbcon: pass.dbcon,
    sql:   `
    UPDATE sessions
    SET archived = $1
    WHERE id = $2
    `,
    postReqData: ["sesid", "val"],
    sqlParams:   [rpg.param("post", "val"), rpg.param("post", "sesid")],
}));


router.post("/enter-session-code", await rpg.singleSQL({
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
    onEnd:         async (req, res, result) => {
        if(result.sesid == null){
            res.end('{"status": "end"}');
        }
        else{
            let id = result.sesid;
            await rpg.singleSQL({
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

router.post("/stage-state-df", await rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT COUNT(*), query1.stage_id1 as id FROM (SELECT 
        stages.id AS stage_id1, 
        differential_selection.uid as uid,
        COUNT(differential_selection.uid) AS num_answers
      FROM 
        stages 
        JOIN differential ON stages.id = differential.stageid 
        JOIN differential_selection ON differential.id = differential_selection.did 
      WHERE 
        stages.sesid = $1
      GROUP BY 
        stages.id, differential_selection.uid
      ) as query1 JOIN (
      SELECT 
        stages.id AS stage_id2, 
        COUNT(differential.id) AS questions
      FROM 
        stages 
        JOIN differential ON stages.id = differential.stageid 
      WHERE 
        stages.sesid = $1
      GROUP BY 
        stages.id
        ) as query2 ON query1.stage_id1= query2.stage_id2
      
        WHERE query1.num_answers = query2.questions GROUP BY query1.stage_id1;
    `,
    postReqData: ["sesid"], //differential_selection uid
    onStart:     (ses) => {  //Session -> Stage -> Differential -> Differential_Selection {id:stage, counter: respuestas completas}
        if (ses.role != "P") { //sesusers role != P
            console.error("Sólo el profesor puede ver el estado de los alumnos");
            return "SELECT $1";
        }
    },
    sqlParams: [rpg.param("post", "sesid")]
}));

router.post("/stage-state-r", await rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT COUNT(act.id), s.id FROM actor_selection act 
    INNER JOIN stages s ON act.stageid = s.id AND s.sesid = $1 GROUP BY s.id;
    `,
    postReqData: ["sesid"],
    onStart:     (ses) => {
        if (ses.role != "P") {
            console.error("Sólo el profesor puede ver el estado de los alumnos");
            return "SELECT $1";
        }
    },
    sqlParams: [rpg.param("post", "sesid")]
}));


function generateCode(id) {
    let n = id*5 + 255 + ~~(Math.random()*5);
    let s = n.toString(16);
    return "k00000".substring(0, 6 - s.length) + s;
}

export default router;
