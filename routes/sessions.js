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
    sql: "select * from (select distinct s.id, s.name, s.descr, s.status, s.type, s.time, (s.id in (select sesid from teams)) as grouped, (s.id in (select sesid from report_pair)) as paired, sr.stime from sessions as s left outer join status_record as sr on sr.sesid = s.id and s.status = sr.status, " +
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
    if (req.session.uid != null && req.body.title != null && req.body.title != "" && req.files.pdf != null && req.files.pdf.mimetype == "application/pdf") {
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
    }
    res.end('{"status":"ok"}');
});

router.post("/documents-session", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select id, title, path from documents where sesid = $1 and active = true",
    postReqData: ["sesid"],
    sqlParams: [rpg.param("post", "sesid")]
}));

router.post("/questions-session", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select id, content, options, answer, comment, other from questions where sesid = $1",
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

router.post("/add-question", rpg.execSQL({
    dbcon: pass.dbcon,
    sql: "insert into questions(content,options,answer,comment,other,sesid,textid) values ($1,$2,$3,$4,$5,$6,$7)",
    sesReqData: ["uid"],
    postReqData: ["content","options","answer","comment","sesid"],
    sqlParams: [rpg.param("post", "content"),rpg.param("post", "options"),rpg.param("post", "answer"),
        rpg.param("post", "comment"),rpg.param("post", "other"),rpg.param("post", "sesid"),rpg.param("post", "textid")],
    onStart: (ses,data,calc) => {
        if (ses.role != "P") {
            console.log("ERR: Solo profesor puede crear sesiones.");
            return "select $1, $2, $3, $4, $5, $6"
        }
    }
}));

router.post("/add-question-text", rpg.execSQL({
    dbcon: pass.dbcon,
    sql: "insert into question_text(title,content,sesid) values ($1,$2,$3)",
    postReqData: ["sesid", "title", "content"],
    sqlParams: [rpg.param("post", "title"), rpg.param("post", "content"), rpg.param("post", "sesid")]
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
    sql: "select answer, comment from selection where uid = $1 and qid = $2 and iteration = $3",
    postReqData: ["qid", "uid", "iteration"],
    sqlParams: [rpg.param("post", "uid"), rpg.param("post", "qid"), rpg.param("post", "iteration")]
}));

/*router.post("/duplicate-session", (req, res) => {
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
                            " as sesid, uid from sesusers where sesid = " + oldsesid
                     });
                 }
                 else{
                     rpg.execSQL({
                         dbcon: pass.dbcon,
                         sql: "insert into sesusers(sesid,uid) values (" + sesid + "," + req.session.uid + ")"
                     });
                 }
                 if(req.body.copyDocuments){
                     rpg.execSQL({
                         dbcon: pass.dbcon,
                         sql: "insert into documents(sesid,title,path,uploader,active) select " + sesid +
                            " as sesid, title, path, uploader, active from documents where sesid = " + oldsesid
                     });
                 }
                 if(req.body.copyQuestions){
                     rpg.execSQL({
                         dbcon: pass.dbcon,
                         sql: "insert into questions(sesid,content,options,answer,comment,other,textid) select " + sesid +
                         " as sesid, content,options,answer,comment,other,textid from questions where sesid = " + oldsesid
                     });
                     rpg.execSQL({
                         dbcon: pass.dbcon,
                         sql: "insert into question_text(sesid,content,title) select " + sesid +
                         " as sesid, content, title from question_text where sesid = " + oldsesid
                     });
                 }
                 if(req.body.copyIdeas){

                 }
                 if(req.body.copyRubrica){

                 }
             }
         });
         res.end('{"status":"ok"}');
     }
     else{
         res.end('{"status":"err"}');
     }
});*/

module.exports = router;