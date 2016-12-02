"use strict";

let express = require('express');
let router = express.Router();
let rpg = require("../modules/rest-pg");
let pass = require("../modules/passwords");

router.get("/seslist", (req, res) => {
    if (req.session.uid) {
        if(req.session.role == "P")
            res.redirect("admin");
        else
            res.render("seslist");
    }
    else
        res.redirect(".");
});

router.post("/get-session-list", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select s.id, s.name, s.descr, s.status from sessions as s, sesusers as su where su.uid = $1 and su.sesid = s.id",
    sesReqData: ["uid"],
    sqlParams: [rpg.param("ses", "uid")]
}));

router.post("/add-session", rpg.execSQL({
    dbcon: pass.dbcon,
    sql: "with rows as (insert into sessions(name,descr,creator,time) values ($1,$2,$3,now()) returning id)" +
    " insert into sesusers(sesid,uid) select id, $4 from rows",
    sesReqData: ["uid"],
    postReqData: ["name", "descr"],
    sqlParams: [rpg.param("post", "name"), rpg.param("post", "descr"), rpg.param("ses", "uid"), rpg.param("ses", "uid")],
    onStart: (ses, data, calc) => {
        if (ses.role != "P") {
            console.log("ERR: Solo profesor puede crear sesiones.");
            console.log(ses);
            return "select $1, $2, $3, $4"
        }
    },
    onEnd: (req, res) => {
        res.redirect("seslist");
    }
}));

router.get("/session", (req, res) => {
    if (req.session.uid) {
        req.session.ses = req.body.sesid;
        res.render("session", {role: req.session.role});
    }
    else
        res.redirect(".");
});

router.get("/admin", (req, res) => {
    if(req.session.role == "P")
        res.render("admin");
    else
        res.redirect(".");
});

router.post("/update-session", rpg.execSQL({
    dbcon: pass.dbcon,
    sql: "update sessions set name = $1, descr = $2 where id = $3",
    sesReqData: ["name","descr","id"],
    sqlParams: [rpg.param("post","name"),rpg.param("post","descr"),rpg.param("post","id")]
}));

router.post("/upload-file", (req, res) => {
    if(req.session.uid!=null && req.body.title!=null && req.files.pdf != null && req.files.pdf.mimetype == "application/pdf") {
        console.log(req.body);
        rpg.execSQL({
            dbcon: pass.dbcon,
            sql: "insert into documents(title,path,sesid,uploader) values ($1,$2,$3,$4)",
            sqlParams: [rpg.param("post","title"), rpg.param("calc","path"), rpg.param("post","sesid"), rpg.param("ses","uid")],
            onStart: (ses, data, calc) => {
                calc.path = req.files.pdf.file
            },
            onEnd: () => {}
        })(req,res);
    }
    res.redirect("admin");
});

module.exports = router;