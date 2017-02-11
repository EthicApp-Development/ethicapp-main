"use strict";

let express = require('express');
let router = express.Router();
let rpg = require("../modules/rest-pg");
let pass = require("../modules/passwords");

router.post("/get-alum-state-sel", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select uid, sum(correct) as score, count(correct) as answered from (select s.uid, (s.answer = q.answer)::int " +
    "as correct from selection as s inner join questions as q on s.qid = q.id where q.sesid = $1 and s.iteration = $2) as r group by uid",
    postReqData: ["sesid","iteration"],
    onStart: (ses, data, calc) => {
        if (ses.role != "P") {
            console.log("ERR: Solo profesor puede ver estado de alumnos.");
            return "select $1"
        }
    },
    sqlParams: [rpg.param("post", "sesid"),rpg.param("post", "iteration")]
}));

router.post("/get-alum-full-state-sel", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select s.uid, q.id as qid, (s.answer = q.answer)::int as correct from selection as s inner join questions as q on " +
    "s.qid = q.id where q.sesid = $1 and s.iteration = $2",
    postReqData: ["sesid","iteration"],
    onStart: (ses, data, calc) => {
        if (ses.role != "P") {
            console.log("ERR: Solo profesor puede ver estado de alumnos.");
            return "select $1"
        }
    },
    sqlParams: [rpg.param("post", "sesid"),rpg.param("post", "iteration")]
}));

router.post("/group-proposal-sel", (req, res) => {
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
                    sql: "select uid sum(correct) as score from (select s.uid, (s.answer = q.answer)::int as correct from selection" +
                    " as s inner join questions as q on s.qid = q.id where q.sesid = " + req.body.sesid + " and s.iteration = 1) as r group by uid",
                    onEnd: (req, res, arr) => {
                        let groups = generateTeams(arr, (s) => s.score, req.body.gnum, isDifferent(req.body.method));
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

router.post("/get-alum-state-lect", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select a.uid, a.orden, a.serial, a.content, a.docid, p.serial as serial_ans, p.content as content_ans, p.docid as docid_ans" +
            " from ideas as a, ideas as p, sessions as s where s.creator = p.uid and a.uid != s.creator and a.orden = p.orden and " +
            "s.id = $1 and a.docid in (select id from documents where sesid = s.id) and p.docid in (select id from documents where " +
            "sesid = s.id) and p.iteration = $2 order by uid, a.orden asc",
    postReqData: ["sesid","iteration"],
    onStart: (ses, data, calc) => {
        if (ses.role != "P") {
            console.log("ERR: Solo profesor puede ver estado de alumnos.");
            return "select $1"
        }
    },
    preventResEnd: true,
    sqlParams: [rpg.param("post", "sesid"), rpg.param("post", "iteration")],
    onEnd: (req,res,arr) => {
        rpg.singleSQL({
            dbcon: pass.dbcon,
            sql: "select count(*) as total from ideas as p, sessions as s where s.creator = p.uid and s.id = " + req.body.sesid,
            onEnd: (reqin,res,rowin) => {
                let scores = [];
                let last_uid = -1;
                let i = -1;
                let total = rowin.total;
                arr.forEach((row) => {
                    if(row.uid != last_uid) {
                        if(i >= 0)
                            scores[i].score /= Math.pow(2,total) - 1;
                        i++;
                        last_uid = row.uid;
                        scores.push({uid: last_uid, score:0});
                    }
                    if(ideasMatch(row)){
                        scores[i].score += Math.pow(2, total - row.orden - 1);
                    }
                });
                if (i>=0)
                    scores[i].score /= Math.pow(2,total) - 1;
                res.end(JSON.stringify(scores));
            }
        })(req,res);
    }
}));

router.post("/group-proposal-lect", (req,res) => {
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
                    sql: "select a.uid, a.orden, a.serial, a.content, a.docid, p.serial as serial_ans, p.content as content_ans, p.docid as docid_ans" +
                    " from ideas as a, ideas as p, sessions as s where s.creator = p.uid and a.uid != s.creator and a.orden = p.orden and " +
                    "s.id = $1 and a.docid in (select id from documents where sesid = s.id) and p.docid in (select id from documents where " +
                    "sesid = s.id) and p.iteration = 1 order by uid, a.orden asc",
                    postReqData: ["sesid"],
                    onStart: (ses, data, calc) => {
                        if (ses.role != "P") {
                            console.log("ERR: Solo profesor puede ver estado de alumnos.");
                            return "select $1"
                        }
                    },
                    preventResEnd: true,
                    sqlParams: [rpg.param("post", "sesid")],
                    onEnd: (req,res,arr) => {
                        rpg.singleSQL({
                            dbcon: pass.dbcon,
                            sql: "select count(*) as total from ideas as p, sessions as s where s.creator = p.uid and s.id = " + req.body.sesid,
                            onEnd: (reqin,res,rowin) => {
                                let scores = [];
                                let last_uid = -1;
                                let i = -1;
                                let total = rowin.total;
                                arr.forEach((row) => {
                                    if(row.uid != last_uid) {
                                        if(i >= 0)
                                            scores[i].score /= Math.pow(2,total) - 1;
                                        i++;
                                        last_uid = row.uid;
                                        scores.push({uid: last_uid, score:0});
                                    }
                                    if(ideasMatch(row)){
                                        scores[i].score += Math.pow(2, total - row.orden - 1);
                                    }
                                });
                                if (i >= 0)
                                    scores[i].score /= Math.pow(2,total) - 1;
                                let groups = generateTeams(scores, (s) => s.score, req.body.gnum, isDifferent(req.body.method));
                                res.end(JSON.stringify(groups));
                            }
                        })(req,res);
                    }
                })(req,res);
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

router.post("/group-proposal-hab", (req, res) => {
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
                    sql: "select u.id as uid, u.aprendizaje from users as u inner join sesusers as su on su.uid = u.id where su.sesid = "
                        + req.body.sesid + " and u.role='A'",
                    onEnd: (req, res, arr) => {
                        let groups = generateTeams(arr, habMetric, req.body.gnum, isDifferent(req.body.method));
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

router.post("/group-proposal-rand", (req, res) => {
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
                    sql: "select u.id as uid, random() as rnd from users as u inner join sesusers as su on su.uid = u.id where su.sesid = "
                    + req.body.sesid + " and u.role='A'",
                    onEnd: (req, res, arr) => {
                        let groups = generateTeams(arr, (s) => s.rnd, req.body.gnum, false);
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

let ideasMatch = (row) => {
    return row.docid == row.docid_ans && row.serial == row.serial_ans;
};

let isDifferent = (type) => {
    switch (type){
        case "Puntaje Homogeneo":
            return false;
        case "Puntaje Heterogeneo":
            return true;
        case "Habilidad Homogeneo":
            return false;
        case "Habilidad Heterogeoneo":
            return true;
    }
    return false;
};

let habMetric = (u) => {
    switch (u.aprendizaje){
        case "Teorico":
            return -2;
        case "Reflexivo":
            return -1;
        case "Activo":
            return 1;
        case "Pragmatico":
            return 2;
    }
    return 0;
};

let generateTeams = (alumArr, scFun, n, different) => {
    let arr = alumArr;
    arr.sort((a, b) => scFun(b) - scFun(a));
    let groups = [];
    let numGroups = alumArr.length / n;
    for (let i = 0; i < numGroups; i++) {
        if (different) {
            let rnd = [];
            let offset = arr.length / n;
            for (let j = 0; j < n; j++)
                rnd.push(Math.floor(Math.random() * offset) + offset * j);
            groups.push(arr.filter((a, i) => rnd.includes(Math.floor(i))));
            arr = arr.filter((a, i) => !rnd.includes(Math.floor(i)));
        }
        else{
            groups.push(arr.filter((a, i) => i < n));
            arr = arr.filter((a, i) => i >= n);
        }
    }
    return groups;
};

router.post("/send-groups", (req, res) => {
    // TODO cambiar porque tiene problemas de performance
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
            if(result.ans) {
                res.end('{"status":"unchanged"}');
            }
            else{
                groups.forEach((team, i) => {
                    rpg.singleSQL({
                        dbcon: pass.dbcon,
                        sql: "insert into teams(sesid) values (" + ses + ") returning id",
                        onEnd: (req,res,result) => {
                            let insertSql = "insert into teamusers(tmid,uid) values ";
                            team.forEach((uid) => {
                                insertSql += "("+result.id+","+uid+"), ";
                            });
                            rpg.execSQL({
                                dbcon: pass.dbcon,
                                sql: insertSql.substring(0,insertSql.length-2),
                                onEnd: () => { console.log("Team " + i + " ok") }
                            })(req,res);
                        }
                    })(req, res);
                });
                res.end('{"status":"ok"}');
            }
        }
    })(req,res);
});

module.exports = router;