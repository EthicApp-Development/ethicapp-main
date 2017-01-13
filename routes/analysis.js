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
    onStart: (ses, data, calc) => {
        if (ses.role != "P") {
            console.log("ERR: Solo profesor puede ver estado de alumnos.");
            return "select $1"
        }
    },
    sqlParams: [rpg.param("post", "sesid")]
}));

router.post("/get-alum-full-state", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select s.uid, q.id as qid, (s.answer = q.answer)::int as correct from selection as s inner join questions as q on " +
    "s.qid = q.id where q.sesid = $1",
    postReqData: ["sesid"],
    onStart: (ses, data, calc) => {
        if (ses.role != "P") {
            console.log("ERR: Solo profesor puede ver estado de alumnos.");
            return "select $1"
        }
    },
    sqlParams: [rpg.param("post", "sesid")]
}));

router.post("/group-proposal", (req, res) => {
    if (req.session.role != "P") {
        res.end("[]");
        return;
    }
    rpg.multiSQL({
        dbcon: pass.dbcon,
        sql: "select t.id as team, u.id as uid from teams as t, users as u, teamusers as tu where t.id = tu.tmid and " +
        "u.id = tu.uid and t.sesid = " + req.body.sesid,
        preventResEnd: true,
        onEnd: (req,res,arr) => {
            if(arr.length == 0) {
                rpg.multiSQL({
                    dbcon: pass.dbcon,
                    sql: "select uid, sum(correct) as score from (select s.uid, (s.answer = q.answer)::int as correct from selection" +
                    " as s inner join questions as q on s.qid = q.id where q.sesid = " + req.body.sesid + ") as r group by uid",
                    onEnd: (req, res, arr) => {
                        let groups = generateTeams(arr, (s) => s.score, req.body.gnum);
                        res.end(JSON.stringify(groups));
                    }
                })(req, res);
            }
            else{
                let t = {};
                let groups = [];
                arr.forEach((row) => {
                    if(t[row.team] == null) {
                        t[row.team] = groups.length;
                        groups.push([{uid: row.uid}]);
                    }
                    else
                        groups[t[row.team]].push({uid: row.uid});
                });
                res.end(JSON.stringify(groups));
            }
        }
    })(req,res);
});

let generateTeams = (alumArr, scFun, n) => {
    let arr = alumArr;
    arr.sort((a, b) => scFun(b) - scFun(a));
    let groups = [];
    let numGroups = alumArr.length / n;
    for (let i = 0; i < numGroups; i++) {
        let rnd = [];
        let offset = arr.length / n;
        for (let j = 0; j < n; j++)
            rnd.push(Math.floor(Math.random() * offset) + offset * j);
        groups.push(arr.filter((a, i) => rnd.includes(Math.floor(i))));
        arr = arr.filter((a, i) => !rnd.includes(Math.floor(i)));
    }
    return groups;
};

router.post("/send-groups", (req, res) => {
    res.header("Content-type", "application/json");
    if (req.session.role != "P" || req.body.sesid == null || req.body.groups == null) {
        res.end('{"status":"err"}');
        return;
    }
    let ses = req.body.sesid;
    let groups = req.body.groups;
    rpg.singleSQL({
        dbcon: pass.dbcon,
        sql: "select " + ses + " in (select sesid from teams) as ans",
        onEnd: (req,res,result) => {
            if(result) {
                res.end('{"status":"unchanged"}');
            }
            else{
                groups.forEach((team, i) => {
                    rpg.singleSQL({
                        dbcon: pass.dbcon,
                        sql: "insert into teams(sesid) values (" + ses + ") returning id",
                        onEnd: (req,res,result) => {
                            team.forEach((uid) => {
                                rpg.execSQL({
                                    dbcon: pass.dbcon,
                                    sql: "insert into teamusers(tmid,uid) values ("+result.id+","+uid+")",
                                    onEnd: () => {}
                                })(req,res);
                            });
                        }
                    })(req, res);
                });
                res.end('{"status":"ok"}');
            }
        }
    })(req,res);
});

module.exports = router;