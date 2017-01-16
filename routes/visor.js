"use strict";

let express = require('express');
let router = express.Router();
let rpg = require("../modules/rest-pg");
let pass = require("../modules/passwords");

router.get("/to-visor", (req, res) => {
    if (req.session.uid) {
        req.session.ses = req.query.sesid;
        res.redirect("visor");
    }
    else
        res.redirect(".");
});

router.get("/visor", (req, res) => {
    if (req.session.uid && req.session.ses)
        res.render("visor");
    else
        res.redirect(".");
});

router.get("/to-select", (req, res) => {
    if (req.session.uid) {
        req.session.ses = req.query.sesid;
        res.redirect("select");
    }
    else
        res.redirect(".");
});

router.get("/select", (req, res) => {
    if (req.session.uid && req.session.ses)
        res.render("select");
    else
        res.redirect(".");
});

router.post("/get-documents", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select id, title, path from documents where sesid = $1",
    sesReqData: ["uid", "ses"],
    sqlParams: [rpg.param("ses", "ses")]
}));

router.post("/get-questions", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select id, content, options from questions where sesid = $1",
    sesReqData: ["uid", "ses"],
    sqlParams: [rpg.param("ses", "ses")]
}));


router.post("/send-answer", rpg.execSQL({
    dbcon: pass.dbcon,
    sql: "with rows as (update selection set answer = $1, comment = $2 where qid = $3 and uid = $4 and iteration = $5 returning 1) " +
    "insert into selection(uid,qid,answer,comment,iteration) select $6,$7,$8,$9,$10 where 1 not in (select * from rows)",
    /*sql: "insert into selection(uid,qid,answer,comment) values ($1,$2,$3,$4) on conflict (uid,qid) do update " +
     "set answer = excluded.answer, comment = excluded.comment",*/
    sesReqData: ["uid", "ses"],
    postReqData: ["qid", "answer", "comment", "iteration"],
    sqlParams: [rpg.param("post", "answer"), rpg.param("post", "comment"), rpg.param("post", "qid"), rpg.param("ses", "uid"), rpg.param("post", "iteration"),
        rpg.param("ses", "uid"), rpg.param("post", "qid"), rpg.param("post", "answer"), rpg.param("post", "comment"), rpg.param("post", "iteration")]
}));

router.post("/get-answers", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select s.qid, s.answer, s.comment from selection as s inner join questions as q on q.id = s.qid " +
    "where q.sesid = $1 and s.uid = $2 and s.iteration = $3",
    sesReqData: ["uid", "ses"],
    postReqData: ["iteration"],
    sqlParams: [rpg.param("ses", "ses"), rpg.param("ses", "uid"), rpg.param("post","iteration")]
}));

router.post("/send-idea", rpg.singleSQL({
    dbcon: pass.dbcon,
    sql: "insert into ideas(content,descr,serial,docid,uid) values ($1,$2,$3,$4,$5) returning id",
    sesReqData: ["uid", "ses"],
    postReqData: ["docid", "text", "comment", "serial"],
    sqlParams: [rpg.param("post", "text"), rpg.param("post", "comment"), rpg.param("post", "serial"), rpg.param("post", "docid"), rpg.param("ses", "uid")]
}));

router.post("/update-idea", rpg.execSQL({
    dbcon: pass.dbcon,
    sql: "update ideas set content = $1, descr = $2, serial = $3 where id = $4",
    sesReqData: ["uid", "ses"],
    postReqData: ["docid", "text", "comment", "serial", "id"],
    sqlParams: [rpg.param("post", "text"), rpg.param("post", "comment"), rpg.param("post", "serial"), rpg.param("post", "id")]
}));

router.post("/get-ideas", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select i.id, i.content, i.descr, i.serial, i.docid from ideas as i inner join documents as d on i.docid = d.id where " +
    "i.uid = $1 and d.sesid = $2 order by i.orden asc",
    sesReqData: ["uid", "ses"],
    sqlParams: [rpg.param("ses", "uid"), rpg.param("ses", "ses")]
}));

router.post("/set-ideas-orden", (req, res) => {
    res.header("Content-type", "application/json");
    let uid = req.session.uid;
    let ses = req.session.ses;
    if (uid == null || ses == null || req.body.orden == null) {
        res.end('{"status":"err"}');
        return;
    }
    req.body.orden.forEach((ideaId, i) => {
        if (!isNaN(ideaId)) {
            rpg.execSQL({
                dbcon: pass.dbcon,
                sql: "update ideas set orden = " + i + " where id = " + ideaId,
                onEnd: () => {}
            })(req, res);
        }
    });
    res.end('{"status":"ok"}');
});

module.exports = router;