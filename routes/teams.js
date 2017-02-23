"use strict";

let express = require('express');
let router = express.Router();
let rpg = require("../modules/rest-pg");
let pass = require("../modules/passwords");

router.post("/get-team-selection",rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select distinct s.answer, s.uid, s.qid, s.comment from selection as s, questions as q where q.sesid = $1 and " +
        "s.uid in (select tu.uid from teamusers as tu where tu.tmid = (select t.id from teamusers as tu, teams as t where " +
        "t.sesid = $2 and tu.tmid = t.id and tu.uid = $3)) and s.iteration = $4",
    sesReqData: ["ses","uid"],
    postReqData: ["iteration"],
    sqlParams: [rpg.param("ses","ses"),rpg.param("ses","ses"),rpg.param("ses","uid"),rpg.param("post","iteration")]
}));

router.post("/get-team-ideas",rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select i.id, i.uid, i.content, i.descr, i.serial, i.docid from ideas as i inner join documents as d on i.docid = d.id where " +
        "d.sesid = $1 and i.uid in (select tu.uid from teamusers as tu where tu.tmid = (select t.id from teamusers as tu, teams as t where " +
        "t.sesid = $2 and tu.tmid = t.id and tu.uid = $3)) and i.iteration = $4 order by i.orden asc",
    sesReqData: ["ses","uid"],
    postReqData: ["iteration"],
    sqlParams: [rpg.param("ses","ses"),rpg.param("ses","ses"),rpg.param("ses","uid"),rpg.param("post","iteration")]
}));

router.post("/get-ses-info",rpg.singleSQL({
    dbcon: pass.dbcon,
    sql: "select greatest(1,least(5,status-2)) as iteration, $1::int as uid, name from sessions where id = $2",
    sesReqData: ["ses","uid"],
    sqlParams: [rpg.param("ses","uid"),rpg.param("ses","ses")]
}));

router.post("/check-team-answer",rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select t.uid, s.answer from (select uid from teamusers where tmid in (select tmid from teams inner join teamusers " +
        "on id = tmid where uid = $1 and sesid = $2)) as t left outer join (select uid, answer from selection where iteration = 3 " +
        "and qid = $3) as s on s.uid = t.uid",
    sesReqData: ["ses","uid"],
    postReqData: ["qid"],
    sqlParams: [rpg.param("ses","uid"),rpg.param("ses","ses"),rpg.param("post","qid")],
    onEnd: (req,res,arr) => {
        let answered = true;
        let option = null;
        let sameOption = true;
        arr.forEach((row) => {
            answered = answered && row.answer != null;
            option = (option == null)? row.answer : option;
            sameOption = sameOption && row.answer == option;
        });
        if(!answered){
            res.end('{"status":"incomplete"}');
        }
        else if(!sameOption){
            res.end('{"status":"different"}');
        }
        else{
            res.end('{"status":"ok"}');
        }
    }
}));



module.exports = router;