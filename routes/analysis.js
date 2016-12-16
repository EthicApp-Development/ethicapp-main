"use strict";

let express = require('express');
let router = express.Router();
let rpg = require("../modules/rest-pg");
let pass = require("../modules/passwords");

router.post("/get-alum-state", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select uid, sum(correct) as score, count(correct) as answered from (select s.uid, (s.answer = q.answer)::int " +
    "as correct from selection as s inner join questions as q on s.qid = q.id where q.sesid = $1) as r group by uid",
    postReqData: ["sesid"],
    onStart: (ses,data,calc) => {
        if (ses.role != "P") {
            console.log("ERR: Solo profesor puede ver estado de alumnos.");
            return "select $1"
        }
    },
    sqlParams: [rpg.param("post","sesid")]
}));

router.post("/get-alum-full-state", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select s.uid, q.id as qid, (s.answer = q.answer)::int as correct from selection as s inner join questions as q on " +
                "s.qid = q.id where q.sesid = $1",
    postReqData: ["sesid"],
    onStart: (ses,data,calc) => {
        if (ses.role != "P") {
            console.log("ERR: Solo profesor puede ver estado de alumnos.");
            return "select $1"
        }
    },
    sqlParams: [rpg.param("post","sesid")]
}));

module.exports = router;