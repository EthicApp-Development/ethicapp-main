"use strict";

let express = require('express');
let router = express.Router();
let rpg = require("../modules/rest-pg");
let pass = require("../modules/passwords");

router.post("/get-team-selection",rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select distinct s.answer, s.uid, s.qid, s.comment from selection as s, questions as q where q.sesid = $1 and " +
        "s.uid in (select tu.uid from teamusers as tu where tu.tmid = (select t.id from teamusers as tu, teams as t where " +
        "t.sesid = $1 and tu.tmid = t.id and tu.uid = $3)) and s.iteration = $4",
    sesReqData: ["ses","uid"],
    postReqData: ["iteration"],
    sqlParams: [rpg.param("ses","ses"),rpg.param("ses","ses"),rpg.param("ses","uid"),rpg.param("post","iteration")]
}));

router.post("/get-team-iteration",rpg.singleSQL({
    dbcon: pass.dbcon,
    sql: "select greatest(1,least(3,status-2)) as iteration from sessions where id = $1",
    sqsReqData: ["ses"],
    sqlParams: [rpg.param("ses","ses")]
}));

module.exports = router;