"use strict";

let express = require('express');
let router = express.Router();
let rpg = require("../modules/rest-pg");
let pass = require("../modules/passwords");

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
    sesReqData: ["uid"],
    postReqData: ["sesid"],
    sqlParams: [rpg.param("post","sesid")]
}));

module.exports = router;