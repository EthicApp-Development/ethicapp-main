"use strict";

let express = require('express');
let router = express.Router();
let rpg = require("../modules/rest-pg");
let pass = require("../modules/passwords");

router.get("/seslist", (req, res) => {
    if (req.session.uid) {
        if (req.session.role == "P")
            res.redirect("admin");
        else
            res.render("seslist");
    }
    else
        res.redirect(".");
});

router.post("/get-session-list", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select * from (select distinct s.id, s.name, s.descr, s.status, s.type, s.time, s.options, (s.id in (select sesid from teams)) as grouped, (s.id in (select sesid from report_pair)) as paired, sr.stime from sessions as s left outer join status_record as sr on sr.sesid = s.id and s.status = sr.status, " +
        "sesusers as su, users as u where su.uid = $1 and u.id = su.uid and su.sesid = s.id and (u.role='P' or s.status > 1)) as v order by v.time desc",
    sesReqData: ["uid"],
    sqlParams: [rpg.param("ses", "uid")]
}));

router.post("/add-session", rpg.execSQL({
    dbcon: pass.dbcon,
    sql: "with rows as (insert into sessions(name,descr,creator,time,status,type) values ($1,$2,$3,now(),1,$4) returning id)" +
        " insert into sesusers(sesid,uid) select id, $5 from rows",
    sesReqData: ["uid"],
    postReqData: ["name", "descr","type"],
    sqlParams: [rpg.param("post", "name"), rpg.param("post", "descr"), rpg.param("ses", "uid"), rpg.param("post","type"), rpg.param("ses", "uid")],
    onStart: (ses, data, calc) => {
        if (ses.role != "P") {
            console.log("ERR: Solo profesor puede crear sesiones.");
            console.log(ses);
            return "select $1, $2, $3, $4, $5"
        }
    },
    onEnd: (req, res) => {
        res.redirect("admin");
    }
}));

router.get("/admin", (req, res) => {
    if (req.session.role == "P")
        res.render("admin");
    else
        res.redirect(".");
});

router.post("/update-session", rpg.execSQL({
    dbcon: pass.dbcon,
    sql: "update sessions set name = $1, descr = $2 where id = $3",
    sesReqData: ["name", "descr", "id"],
    sqlParams: [rpg.param("post", "name"), rpg.param("post", "descr"), rpg.param("post", "id")]
}));

router.post("/upload-file", (req, res) => {
    if (req.session.uid != null && req.body.title != null && req.body.title != "" && req.files.pdf != null && req.files.pdf.mimetype == "application/pdf" && req.body.sesid != null) {
        // console.log(req.body);
        rpg.execSQL({
            dbcon: pass.dbcon,
            sql: "insert into documents(title,path,sesid,uploader) values ($1,$2,$3,$4)",
            sqlParams: [rpg.param("post", "title"), rpg.param("calc", "path"), rpg.param("post", "sesid"), rpg.param("ses", "uid")],
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

router.post("/documents-session", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select id, title, path from documents where sesid = $1 and active = true",
    postReqData: ["sesid"],
    sqlParams: [rpg.param("post", "sesid")]
}));

router.post("/questions-session", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select id, content, options, answer, comment, other, textid from questions where sesid = $1 order by id asc",
    postReqData: ["sesid"],
    sqlParams: [rpg.param("post", "sesid")]
}));

router.post("/get-new-users", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select id, name, mail from users where id not in (select u.id from users as u, sesusers as su where u.id = su.uid and su.sesid = $1)",
    postReqData: ["sesid"],
    sqlParams: [rpg.param("post", "sesid")]
}));

router.post("/get-ses-users", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select u.id, u.name, u.mail, u.aprendizaje, u.role from users as u, sesusers as su where u.id = su.uid and su.sesid = $1 order by u.role desc",
    postReqData: ["sesid"],
    sqlParams: [rpg.param("post", "sesid")]
}));

router.post("/add-ses-users", (req, res) => {
    let sql = "insert into sesusers(uid,sesid) values ";
    req.body.users.forEach((uid) => {
        if (!isNaN(uid))
            sql += "(" + uid + "," + req.body.sesid + "), ";
    });
    sql = sql.substring(0,sql.length-2);
    rpg.execSQL({
        dbcon: pass.dbcon,
        sql: sql
    })(req, res);
});

router.post("/add-question", rpg.singleSQL({
    dbcon: pass.dbcon,
    sql: "insert into questions(content,options,answer,comment,other,sesid,textid) values ($1,$2,$3,$4,$5,$6,$7) returning id",
    sesReqData: ["uid"],
    postReqData: ["content","options","answer","comment","sesid"],
    sqlParams: [rpg.param("post", "content"),rpg.param("post", "options"),rpg.param("post", "answer"),
        rpg.param("post", "comment"),rpg.param("post", "other"),rpg.param("post", "sesid"),rpg.param("post", "textid")],
    onStart: (ses,data,calc) => {
        if (ses.role != "P") {
            return "select $1, $2, $3, $4, $5, $6, $7"
        }
    }
}));

router.post("/update-question", rpg.execSQL({
    dbcon: pass.dbcon,
    sql: "update questions set (content,options,answer,comment,other,textid) = ($1,$2,$3,$4,$5,$6) where id = $7",
    sesReqData: ["uid"],
    postReqData: ["content","options","answer","comment","id"],
    sqlParams: [rpg.param("post", "content"),rpg.param("post", "options"),rpg.param("post", "answer"),
        rpg.param("post", "comment"),rpg.param("post", "other"),rpg.param("post", "textid"),rpg.param("post", "id")],
    onStart: (ses,data,calc) => {
        if (ses.role != "P") {
            return "select $1, $2, $3, $4, $5, $6, $7"
        }
    }
}));

router.post("/delete-question", rpg.execSQL({
    dbcon: pass.dbcon,
    sql: "delete from questions where id = $1",
    sesReqData: ["uid"],
    postReqData: ["id"],
    sqlParams: [rpg.param("post", "id")],
    onStart: (ses,data,calc) => {
        if (ses.role != "P") {
            return "select $1"
        }
    }
}));

router.post("/add-question-text", rpg.execSQL({
    dbcon: pass.dbcon,
    sql: "insert into question_text(title,content,sesid) values ($1,$2,$3)",
    postReqData: ["sesid", "title", "content"],
    sqlParams: [rpg.param("post", "title"), rpg.param("post", "content"), rpg.param("post", "sesid")]
}));

router.post("/update-question-text", rpg.execSQL({
    dbcon: pass.dbcon,
    sql: "update question_text set (title,content) = ($1,$2) where id = $3",
    postReqData: ["id", "title", "content"],
    sqlParams: [rpg.param("post", "title"), rpg.param("post", "content"), rpg.param("post", "id")]
}));

router.post("/delete-question-text", rpg.execSQL({
    dbcon: pass.dbcon,
    sql: "delete from question_texts where id = $1",
    sesReqData: ["uid"],
    postReqData: ["id"],
    sqlParams: [rpg.param("post", "id")],
    onStart: (ses,data,calc) => {
        if (ses.role != "P") {
            return "select $1"
        }
    }
}));

router.post("/get-question-text", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select id, title, content from question_text where sesid = $1",
    postReqData: ["sesid"],
    sqlParams: [rpg.param("post", "sesid")]
}));

router.post("/delete-ses-user", rpg.execSQL({
    dbcon: pass.dbcon,
    sql: "delete from sesusers where sesid = $1 and uid = $2",
    postReqData: ["sesid", "uid"],
    sqlParams: [rpg.param("post", "sesid"), rpg.param("post", "uid")]
}));


router.post("/get-selection-comment", rpg.singleSQL({
    dbcon: pass.dbcon,
    sql: "select answer, comment, confidence from selection where uid = $1 and qid = $2 and iteration = $3",
    postReqData: ["qid", "uid", "iteration"],
    sqlParams: [rpg.param("post", "uid"), rpg.param("post", "qid"), rpg.param("post", "iteration")]
}));


router.post("/add-semantic-document", rpg.execSQL({
    dbcon: pass.dbcon,
    sql: "insert into semantic_document(title,content,sesid,orden) values ($1,$2,$3,$4)",
    postReqData: ["sesid", "title", "content", "orden"],
    sqlParams: [rpg.param("post", "title"), rpg.param("post", "content"), rpg.param("post", "sesid"), rpg.param("post", "orden")]
}));

router.post("/update-semantic-document", rpg.execSQL({
    dbcon: pass.dbcon,
    sql: "update semantic_document set (title,content) = ($1,$2) where id = $3",
    sesReqData: ["uid"],
    postReqData: ["title", "content", "id"],
    sqlParams: [rpg.param("post", "title"), rpg.param("post", "content"), rpg.param("post", "id")],
    onStart: (ses,data,calc) => {
        if (ses.role != "P") {
            return "select $1, $2, $3"
        }
    }
}));

router.post("/delete-semantic-document", rpg.execSQL({
    dbcon: pass.dbcon,
    sql: "delete from semantic_document where id = $1",
    sesReqData: ["uid"],
    postReqData: ["id"],
    sqlParams: [rpg.param("post", "id")],
    onStart: (ses,data,calc) => {
        if (ses.role != "P") {
            return "select $1"
        }
    }
}));

router.post("/semantic-documents", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select id, title, content from semantic_document where sesid = $1 order by orden asc",
    postReqData: ["sesid"],
    sqlParams: [rpg.param("post", "sesid")]
}));

router.post("/get-semantic-documents", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select id, title, content from semantic_document where sesid = $1 order by orden asc",
    sesReqData: ["ses"],
    sqlParams: [rpg.param("ses", "ses")]
}));


router.post("/add-semantic-unit", rpg.singleSQL({
    dbcon: pass.dbcon,
    sql: "insert into semantic_unit(sentences,docs,comment,uid,sesid,iteration) values ($1,$2,$3,$4,$5,$6) returning id",
    postReqData: ["comment","sentences","docs","iteration"],
    sesReqData: ["uid","ses"],
    sqlParams: [rpg.param("post", "sentences"), rpg.param("post", "docs"), rpg.param("post", "comment"),
        rpg.param("ses", "uid"), rpg.param("ses","ses"), rpg.param("post","iteration")]
}));

router.post("/add-sync-semantic-unit", rpg.singleSQL({
    dbcon: pass.dbcon,
    sql: "insert into semantic_unit(sentences,docs,comment,uid,sesid,iteration) values ($1,$2,$3,$4,$5,$6) returning id",
    postReqData: ["comment","sentences","docs","iteration","uidoriginal"],
    sesReqData: ["uid","ses"],
    sqlParams: [rpg.param("post", "sentences"), rpg.param("post", "docs"), rpg.param("post", "comment"),
        rpg.param("post", "uidoriginal"), rpg.param("ses","ses"), rpg.param("post","iteration")]
}));


router.post("/update-semantic-unit", rpg.execSQL({
    dbcon: pass.dbcon,
    sql: "update semantic_unit set (sentences,comment,docs) = ($1,$2,$3) where id = $4",
    postReqData: ["comment","sentences","docs","id"],
    sesReqData: ["uid"],
    sqlParams: [rpg.param("post", "sentences"), rpg.param("post", "comment"), rpg.param("post","docs"), rpg.param("post","id")]
}));


router.post("/get-semantic-units", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select u.id, u.sentences, u.comment, u.docs, u.iteration from semantic_unit as u " +
        "where u.uid = $1 and u.sesid = $2 and (u.iteration = $3 or u.iteration = 0)",
    sesReqData: ["uid","ses"],
    postReqData: ["iteration"],
    sqlParams: [rpg.param("ses", "uid"), rpg.param("ses","ses"), rpg.param("post","iteration")]
}));

router.post("/get-team-sync-units", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select u.id, u.sentences, u.comment, u.docs, u.iteration from semantic_unit as u where " +
        "u.uid in (select original_leader from teams inner join teamusers on tmid = id where uid = $1 and sesid = $2) and u.sesid = $3 and " +
        "u.iteration = 3 order by u.id asc",
    sesReqData: ["uid", "ses"],
    sqlParams: [rpg.param("ses", "uid"), rpg.param("ses", "ses"), rpg.param("ses", "ses")]
}));

router.post("/delete-semantic-unit", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "delete from semantic_unit where id = $1",
    postReqData: ["id"],
    sqlParams: [rpg.param("post", "id")]
}));

router.post("/update-ses-options", rpg.execSQL({
    dbcon: pass.dbcon,
    sql: "update sessions set options = $1 where id = $2",
    postReqData: ["sesid", "options"],
    sqlParams: [rpg.param("post", "options"), rpg.param("post", "sesid")]
}));

router.post("/duplicate-session", (req, res) => {
     if(req.session.uid != null && req.session.role == "P" && req.body.name != null && req.body.name != ""
         && req.body.tipo != null && req.body.descr != null && req.body.originalSesid != null){
         rpg.singleSQL({
             dbcon: pass.dbcon,
             sql: "insert into sessions(name,descr,creator,time,status,type) values ($1,$2,$3,now(),1,$4) returning id",
             postReqData: ["sesid", "uid"],
             sqlParams: [rpg.param("post", "name"), rpg.param("post", "descr"), rpg.param("ses", "uid"), rpg.param("post", "tipo")],
             onEnd: (req, res, result) => {
                 let sesid = result.id;
                 let oldsesid = req.body.originalSesid;
                 if(req.body.copyUsers) {
                     rpg.execSQL({
                         dbcon: pass.dbcon,
                         sql: "insert into sesusers(sesid,uid) select " + sesid +
                            " as sesid, uid from sesusers where sesid = " + oldsesid,
                         preventResEnd: true,
                         onEnd: () => {}
                     })(req,res);
                 }
                 else{
                     rpg.execSQL({
                         dbcon: pass.dbcon,
                         sql: "insert into sesusers(sesid,uid) values (" + sesid + "," + req.session.uid + ")",
                         preventResEnd: true,
                         onEnd: () => {}
                     })(req,res);
                 }
                 if(req.body.copySemDocs){
                     rpg.execSQL({
                         dbcon: pass.dbcon,
                         sql: "insert into semantic_document(sesid,title,content,orden) select " + sesid +
                         " as sesid, title, content, orden from semantic_document where sesid = " + oldsesid,
                         preventResEnd: true,
                         onEnd: () => {}
                     })(req,res);
                 }
                 if(req.body.copySemUnits){
                     rpg.execSQL({
                         dbcon: pass.dbcon,
                         sql: "insert into semantic_unit(sesid,sentences,comment,uid,iteration,docs) select " + sesid +
                             " as sesid, sentences, comment, uid, 0 as iteration, docs from semantic_unit where sesid = "
                             + oldsesid + " and iteration = 0",
                         preventResEnd: true,
                         onEnd: () => {}
                     })(req,res);
                 }
                 if(req.body.copyDocuments){
                     rpg.execSQL({
                         dbcon: pass.dbcon,
                         sql: "insert into documents(sesid,title,path,uploader,active) select " + sesid +
                         " as sesid, title, path, uploader, active from documents where sesid = " + oldsesid,
                         preventResEnd: true,
                         onEnd: () => {}
                     })(req,res);
                 }
                 if(req.body.copyQuestions){
                     rpg.execSQL({
                         dbcon: pass.dbcon,
                         sql: "insert into questions(sesid,content,options,answer,comment,other,textid) select " + sesid +
                         " as sesid, content,options,answer,comment,other,textid from questions where sesid = " + oldsesid,
                         preventResEnd: true,
                         onEnd: () => {}
                     })(req,res);
                     rpg.execSQL({
                         dbcon: pass.dbcon,
                         sql: "insert into question_text(sesid,content,title) select " + sesid +
                         " as sesid, content, title from question_text where sesid = " + oldsesid,
                         preventResEnd: true,
                         onEnd: () => {}
                     })(req,res);
                 }
                 if(req.body.copyIdeas){
                    console.log("Copy Ideas is not implemented yet");
                 }
                 if(req.body.copyRubrica){
                    rpg.singleSQL({
                        dbcon: pass.dbcon,
                        sql: "insert into rubricas(sesid) values (" + sesid + ") returning id",
                        onEnd: (req, res, result) => {
                            rpg.execSQL({
                                dbcon: pass.dbcon,
                                sql: "insert into criteria(name,pond,inicio,proceso,competente,avanzado,rid) select " +
                                    "c.name, c.pond, c.inicio, c.proceso, c.competente, c.avanzado, " + result.id + " as rid " +
                                    "from criteria as c inner join rubricas as r on r.id = c.rid where r.sesid = " + oldsesid,
                                onEnd: () => {},
                                preventResEnd: true
                            })(req,res);
                        },
                        preventResEnd: true
                    })(req,res);
                 }
             }
         })(req,res);
         //res.end('{"status":"ok"}');
     }
     else{
         res.end('{"status":"err"}');
     }
});

router.get("/export-session-data-sel", (req,res) => {
    let id = req.query.id;
    if(!isNaN(id)) {
        rpg.multiSQL({
            dbcon: pass.dbcon,
            sql: "select u.name as nombre, q.content as pregunta, substring('ABCDE' from s.answer + 1 for 1) as alternativa, s.answer = q.answer as " +
            "correcta, s.iteration as iteracion, s.comment as comentario, s.confidence as confianza, s.stime as hora_respuesta from selection as s inner " +
            "join users as u on s.uid = u.id inner join questions as q on s.qid = q.id where q.sesid = " + id + " order by s.stime",
            onEnd: (req, res, arr) => {
                res.xls("resultados.xlsx", arr);
            }
        })(req,res);
    }
    else {
        res.end("Bad Request");
    }
});

module.exports = router;