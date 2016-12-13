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

/*
router.post("/send-answers", (req, res) => {
    if(isNaN(req.body.qid) || req.session.uid == null || req.session.ses == null)
        res.end("{'result':'err'}");
    let sql = "insert into selection(uid,qid,answer,comment) values ";
    let params = [];
    req.body.answers.forEach((ans,i) => {
        if ("ABCDE".includes(ans.answer)) {
            sql += "(" + req.session.uid + "," + req.body.qid + "," + ans.answer + ", $"+ i + ") ";
            params.push(rpg.param("calc",))
        }
    });
    sql += "on conflict do update";
    rpg.execSQL({
        dbcon: pass.dbcon,
        sql: sql
    })(req, res);
});
*/

router.post("/send-answer", rpg.execSQL({
    dbcon: pass.dbcon,
    sql: "insert into selection(uid,qid,answer,comment) values ($1,$2,$3,$4) on conflict (uid,qid) do update " +
            "set answer = excluded.answer, comment = excluded.comment",
    sesReqData: ["uid","ses"],
    postReqData: ["qid","answer","comment"],
    sqlParams: [rpg.param("ses","uid"),rpg.param("post","qid"),rpg.param("post","answer"),rpg.param("post","comment")]
}));

router.post("/get-answers", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select s.qid, s.answer, s.comment from selection as s inner join questions as q on q.id = s.qid " +
            "where q.sesid = $1 and s.uid = $2",
    sesReqData: ["uid","ses"],
    sqlParams: [rpg.param("ses","ses"),rpg.param("ses","uid")]
}));

module.exports = router;