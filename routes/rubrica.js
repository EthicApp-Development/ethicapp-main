"use strict";

let express = require('express');
let router = express.Router();
let rpg = require("../modules/rest-pg");
let pass = require("../modules/passwords");

router.get("/rubrica", (req, res) => {
    if (req.session.uid && req.session.ses)
        res.render("rubrica");
    else
        res.redirect(".");
});

router.post("/send-rubrica",rpg.singleSQL({
    //TODO Auth
    dbcon: pass.dbcon,
    sql: "insert into rubricas (sesid) values ($1) returning id",
    sesReqData: ["uid"],
    postReqData: ["sesid"],
    sqlParams: [rpg.param("post","sesid")]
}));

router.post("/send-criteria",rpg.execSQL({
    //TODO Auth
    dbcon: pass.dbcon,
    sql: "insert into criteria (name,pond,inicio,proceso,competente,avanzado,rid) values ($1,$2,$3,$4,$5,$6,$7)",
    sesReqData: ["uid"],
    postReqData: ["name","pond","inicio","proceso","competente","avanzado","rid"],
    sqlParams: [rpg.param("post","name"),rpg.param("post","pond"),rpg.param("post","inicio"),rpg.param("post","proceso"),
        rpg.param("post","competente"),rpg.param("post","avanzado"),rpg.param("post","rid")]
}));

router.post("/get-rubrica",rpg.multiSQL({
    //TODO Auth
    dbcon: pass.dbcon,
    sql: "select c.name, c.pond, c.inicio, c.proceso, c.competente, c.avanzado from criteria as c, rubricas as r " +
            "where c.rid = r.id and r.sesid = $1",
    sesReqData: ["uid","ses"],
    sqlParams: [rpg.param("ses","ses")]
}));

router.post("/send-example-report",rpg.execSQL({
    //TODO Auth
    dbcon: pass.dbcon,
    sql: "insert into reports (content,example,rid,uid) select $1, true, r.id, $2 from rubricas as r where r.sesid = $3 limit 1",
    sesReqData: ["uid"],
    postReqData: ["sesid","content"],
    sqlParams: [rpg.param("post","content"),rpg.param("ses","uid"),rpg.param("post","sesid")]
}));

router.post("/get-example-reports", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select r.id, r.content, r.uid from reports as r, rubricas as b where r.rid = b.id and b.sesid = $1 and r.example = true",
    sesReqData: ["uid"],
    postReqData: ["sesid"],
    sqlParams: [rpg.param("post","sesid")]
}));

router.post("/get-report", rpg.singleSQL({
    dbcon: pass.dbcon,
    sql: "select r.id, r.content, r.uid from reports as r where r.id = $1",
    sesReqData: ["uid"],
    sqlParams: [rpg.param("post","rid")]
}));

module.exports = router;