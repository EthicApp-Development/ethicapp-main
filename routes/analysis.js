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

router.post("/group-proposal", (req, res) => {
    if (req.session.role != "P") {
        res.end("[]");
        return;
    }
    rpg.multiSQL({
        dbcon: pass.dbcon,
        sql: "select uid, sum(correct) as score from (select s.uid, (s.answer = q.answer)::int as correct from selection" +
        " as s inner join questions as q on s.qid = q.id where q.sesid = "+req.body.sesid+") as r group by uid",
        onEnd: (req,res,arr) => {
            let groups = generateTeams(arr, (s) => s.score, req.body.gnum);
            console.log(groups);
            res.end(JSON.stringify(groups));
        }
    })(req,res);
});


let generateTeams = (alumArr, scFun, n) => {
    let arr = alumArr;
    arr.sort((a,b) => scFun(b) - scFun(a));
    let selected = Array.from(new Array(5)).map(x => false);
    let groups = [];
    let numGroups = alumArr.length / n;
    for(let i = 0 ; i < numGroups; i++){
        let rnd = [];
        let offset = arr.length / n;
        for(let j = 0; j < n; j++)
            rnd.push(Math.floor(Math.random()*offset) + offset*j);
        groups.push(arr.filter((a,i) => rnd.includes(Math.floor(i))));
        arr = arr.filter((a,i) => !rnd.includes(Math.floor(i)));
    }
    return groups;
};

module.exports = router;