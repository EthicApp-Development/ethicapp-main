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
                    sql: "select uid, sum(correct) as score, count(correct) as answered from (select s.uid, (s.answer = q.answer)::int " +
                        "as correct from selection as s inner join questions as q on s.qid = q.id where q.sesid = $1 and s.iteration = $2) as r group by uid",
                    onStart: (ses, data, calc) => {
                        if (ses.role != "P") {
                            console.log("ERR: Solo profesor puede ver estado de alumnos.");
                            return "select $1"
                        }
                    },
                    preventResEnd: true,
                    sqlParams: [rpg.param("post", "sesid")],
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
    sql: "select distinct a.uid, a.orden, a.serial, a.content, a.docid, p.serial as serial_ans, p.content as content_ans, p.docid as docid_ans" +
            " from ideas as a, ideas as p, sessions as s where s.creator = p.uid and a.uid != s.creator and a.orden = p.orden and " +
            "s.id = $1 and a.docid in (select id from documents where sesid = s.id) and p.docid in (select id from documents where " +
            "sesid = s.id) and a.iteration = $2 order by uid, a.orden asc",
    postReqData: ["sesid","iteration"],
    onStart: (ses, data, calc) => {
        if (ses.role != "P") {
            console.log("ERR: Solo profesor puede ver estado de alumnos.");
            return "select $1, $2"
        }
    },
    preventResEnd: true,
    sqlParams: [rpg.param("post", "sesid"), rpg.param("post", "iteration")],
    onEnd: (req,res,arr) => {
        rpg.singleSQL({
            dbcon: pass.dbcon,
            sql: "select max(orden) as total from ideas as p, sessions as s, documents as d where p.docid = d.id and " +
                "d.sesid = s.id and s.creator = p.uid and s.id = " + req.body.sesid,
            onEnd: (reqin,res,rowin) => {
                let scores = [];
                let last_uid = -1;
                let i = -1;
                let total = rowin.total + 1;
                let allAns = [];
                arr.forEach((row) => {
                     allAns.push(row.content_ans.trim().toLowerCase());
                });
                var scoresUsed = {};
                arr.forEach((row) => {
                    if(row.uid != last_uid) {
                        if(i >= 0)
                            scores[i].score /= total;
                        i++;
                        last_uid = row.uid;
                        scores.push({uid: last_uid, score:0});
                        scoresUsed = {};
                    }
                    console.log(row.orden, "|", row.content, "|", row.content_ans);
                    if(ideasMatch(row)){
                        if(!scoresUsed[row.orden]){
                            scores[i].score += 1;
                        }
                        else {
                            scores[i].score += 0.3;
                        }
                        scoresUsed[row.orden] = true;
                    }
                    else if(!scoresUsed[row.orden] && allAns.includes(row.content.trim().toLowerCase())){
                        scores[i].score += 0.7;
                        scoresUsed[row.orden] = true;
                    }
                });
                if (i>=0)
                    scores[i].score /= total;
                res.end(JSON.stringify(scores));
            }
        })(req,res);
    }
}));

router.post("/get-alum-state-semantic", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select a.uid, a.sentences, a.docs, a.uid = s.creator as is_ans from semantic_unit as a, sessions as s where " +
        "s.id = $1 and a.sesid = s.id and (a.iteration = $2 or a.uid = s.creator) order by is_ans desc, a.uid, a.sentences",
    postReqData: ["sesid","iteration"],
    onStart: (ses, data, calc) => {
        if (ses.role != "P") {
            console.log("ERR: Solo profesor puede ver estado de alumnos.");
            return "select $1, $2"
        }
    },
    preventResEnd: true,
    sqlParams: [rpg.param("post", "sesid"), rpg.param("post", "iteration")],
    onEnd: (req,res,arr) => {
        let scores = [];
        let i = 0;
        let pauta = [];
        let total = 0;
        // PAUTA
        while(i < arr.length && arr[i].is_ans){
            pauta.push(arr[i]);
            total++;
            i++;
        }
        // ALUMNOS
        let sc = 0;
        let last_uid = -1;
        if(arr[i] != null)
            last_uid = arr[i].uid;
        for(; i < arr.length; i++){
            let alum = arr[i];
            if(alum.uid != last_uid){
                console.log(sc);
                scores.push({uid: last_uid, score: sc/total});
                last_uid = alum.uid;
                sc = 0;
            }
            let m = 0;
            pauta.forEach(p => {
                m = Math.max(m, getSemanticScore(p,alum));
            });
            sc += m;
        }
        if(total > 0 && last_uid != -1)
            scores.push({uid: last_uid, score: sc/total});
        res.end(JSON.stringify(scores));
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
                    sql: "select distinct a.uid, a.orden, a.serial, a.content, a.docid, p.serial as serial_ans, p.content as content_ans, p.docid as docid_ans" +
                    " from ideas as a, ideas as p, sessions as s where s.creator = p.uid and a.uid != s.creator and a.orden = p.orden and " +
                    "s.id = $1 and a.docid in (select id from documents where sesid = s.id) and p.docid in (select id from documents where " +
                    "sesid = s.id) and a.iteration = 1 order by uid, a.orden asc",
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
                            sql: "select max(orden) as total from ideas as p, sessions as s, documents as d where p.docid = d.id and d.sesid = s.id and s.creator = p.uid and s.id = " + req.body.sesid,
                            onEnd: (reqin,res,rowin) => {
                                let scores = [];
                                let last_uid = -1;
                                let i = -1;
                                let total = rowin.total + 1;
                                let allAns = [];
                                arr.forEach((row) => {
                                    allAns.push(row.content_ans.trim().toLowerCase());
                                });
                                var scoresUsed = {};
                                arr.forEach((row) => {
                                    if(row.uid != last_uid) {
                                        if(i >= 0)
                                            scores[i].score /= total;
                                        i++;
                                        last_uid = row.uid;
                                        scores.push({uid: last_uid, score:0});
                                        scoresUsed = {};
                                    }
                                    console.log(row.orden, "|", row.content, "|", row.content_ans);
                                    if(ideasMatch(row)){
                                        if(!scoresUsed[row.orden]){
                                            scores[i].score += 1;
                                        }
                                        else {
                                            scores[i].score += 0.3;
                                        }
                                        scoresUsed[row.orden] = true;
                                    }
                                    else if(!scoresUsed[row.orden] && allAns.includes(row.content.trim().toLowerCase())){
                                        scores[i].score += 0.7;
                                        scoresUsed[row.orden] = true;
                                    }
                                });
                                if (i>=0)
                                    scores[i].score /= total;
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
    return row.docid == row.docid_ans && row.content.toLowerCase().trim() == row.content_ans.toLowerCase().trim();
};

let isDifferent = (type) => {
    switch (type){
        case "Rendimiento Homogeneo":
            return false;
        case "Rendimiento Heterogeneo":
            return true;
        case "Tipo Aprendizaje Homogeneo":
            return false;
        case "Tipo Aprendizaje Heterogeoneo":
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

router.post("/set-groups", (req, res) => {
    if (req.session.role != "P" || req.body.sesid == null || req.body.groups == null) {
        res.end('{"status":"err"}');
        return;
    }
    let sql = "delete from teamusers as tu using teams as t where tu.tmid = t.id and t.sesid = " + req.body.sesid+"; "
            + "delete from teams where sesid = " + req.body.sesid + "; ";
    let grupos = JSON.parse(req.body.groups);
    grupos.forEach((team) => {
        sql += "with rows as (insert into teams(sesid,leader,original_leader) values (" + req.body.sesid + "," + team[0] + "," + team[0] + ") returning id) " +
            "insert into teamusers(tmid,uid) select id, unnest('{" + team.join(",") + "}'::int[]) from rows; ";
    });
    console.log(sql);
    rpg.execSQL({
        dbcon: pass.dbcon,
        sql: sql,
        onEnd: () => {
            res.end('{"status":"ok"}');
        }
    })(req,res);
    /*rpg.execSQL({
     dbcon: pass.dbcon,
     sql: sql,
     preventResEnd: true,
     onEnd: () => { console.log("Team generation ok"); }
     })(req,res);
     res.end('{"status":"ok"}');
     /*rpg.multiSQL({
     dbcon: pass.dbcon,
     sql: "select " + req.body.sesid + " in (select sesid from teams) as ans",
     onEnd: (req,res,arr) => {
     if(arr == null || arr.length == 0 || !arr[0]) {
     res.end('{"status":"unchanged"}');
     }
     else{
     console.log(req.body);
     console.log(req.body.groups);
     console.log(req.body.sesid);
     let sql = "";
     req.body.groups.forEach((team) => {
     sql += "with rows as (insert into teams(sesid,leader) values (" + req.body.sesid + "," + team[0] + ") returning id) " +
     "insert into teamusers(tmid,uid) select id, unnest('{" + team.join(",") + "}'::int[]) from rows; ";
     });
     console.log(sql);
     /*rpg.execSQL({
     dbcon: pass.dbcon,
     sql: sql,
     preventResEnd: true,
     onEnd: () => { console.log("Team generation ok"); }
     })(req,res);
     res.end('{"status":"ok"}');
     }
     }
     })(req,res);*/
});

let generateTeams = (alumArr, scFun, n, different) => {
    if(n == null || n == 0) return [];
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

router.post("/assign-pairs", (req, res) => {
    res.header("Content-type", "application/json");
    if (req.session.role != "P" || req.body.sesid == null || req.body.rnum == null) {
        console.log("Data not provided");
        res.end('{"status":"err", "msg":"No hay datos suficientes"}');
        return;
    }
    let ses = req.body.sesid;
    let m = req.body.rnum;
    rpg.multiSQL({
        dbcon: pass.dbcon,
        sql: "select r.id, r.uid from reports as r inner join rubricas as k on r.rid = k.id where r.example = false and k.sesid = " + ses,
        onEnd: (req, res, arr) => {
            let n = arr.length;
            if (m >= n) {
                console.log("More pairs than reports");
                res.end('{"status":"err", "msg":"No hay suficientes reportes completos para asignar pares"}');
                return;
            }

            let uids = arr.map(e => e.uid);
            let rids = arr.map(e => e.id);

            let counter = {};
            uids.forEach(u => {
                counter[u] = m;
            });

            let pairs = [];
            rids.forEach((ri,i) => {
                let k = m;
                while(k > 0){
                    let sel = Object.keys(counter);
                    console.log("Seleccionable son: " + sel);
                    if(sel.length == 0 || sel.length == 1 && sel[0] == uids[i]){
                        console.log("Infinite loop");
                        res.end('{"status":"err", "msg":"Error de consistencia de los pares formados. Intente nuevamente"}');
                        return;
                    }
                    let r = ~~(Math.random()*sel.length);
                    console.log("Indice random es: " + r + ", rid es: " + ri);
                    if (sel[r] != uids[i]){
                        k -= 1;
                        pairs.push({uid: sel[r], rid: ri});
                        counter[sel[r]] -= 1;
                        if(counter[sel[r]] <= 0){
                            delete counter[sel[r]];
                        }
                    }
                }
            });

            let pairstr = pairs.map(e => "("+e.uid+","+e.rid+")");
            if(pairs.length != n*m){
                res.end('{"status":"err", "msg":"Error de consistencia de los pares formados. Intente nuevamente"}');
                return;
            }
            if(hasDuplicates(pairstr)){
                console.log("Se encontraron duplicados");
                res.end('{"status":"err", "msg":"Error de duplicación de pares asignados. Intente nuevamente"}');
                return;
            }
            console.log("Pairs formed: " + pairstr.join(" "));

            let sql = "insert into report_pair(sesid,uid,repid) values ";
            sql += pairs.map(e => "("+ses+","+e.uid+","+e.rid+")").join(",");
            rpg.execSQL({
                dbcon: pass.dbcon,
                sql: sql,
                onEnd: () => {},
                preventResEnd: true
            })(req,res);

            res.end('{"status":"ok"}');
        }
    })(req,res);
});

router.post("/get-ideas-progress", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select i.uid, count(*) as count from ideas as i inner join users as u on i.uid = u.id where iteration = $1 and u.role = 'A' " +
        "and i.docid in (select id from documents where sesid = $2) group by uid",
    postReqData: ["iteration", "sesid"],
    sqlParams: [rpg.param("post", "iteration"), rpg.param("post", "sesid")]
}));

router.post("/get-alum-done-time", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select f.uid, extract(epoch from f.stime - s.stime) as dtime from finish_session as f, status_record as s where s.status = f.status and " +
        "s.sesid = f.sesid and f.status = ($1 + 2) and f.sesid = $2",
    postReqData: ["iteration", "sesid"],
    sqlParams: [rpg.param("post", "iteration"), rpg.param("post", "sesid")]
}));

router.post("/get-alum-confidence", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select s.confidence as conf, q.id as qid, count(*) as freq from selection as s inner join questions as q on s.qid = q.id " +
        "where q.sesid = $1 and s.iteration = $2 and s.confidence is not null group by s.confidence, q.id",
    postReqData: ["sesid","iteration"],
    onStart: (ses, data, calc) => {
        if (ses.role != "P") {
            console.log("ERR: Solo profesor puede ver estado de alumnos.");
            return "select $1, $2"
        }
    },
    sqlParams: [rpg.param("post", "sesid"),rpg.param("post", "iteration")]
}));

let hasDuplicates = (arr) => {
    let dict = {};
    for (var i = 0; i < arr.length; i++) {
        if(dict[arr[i]] != null)
            return true;
        dict[arr[i]] = true;
    }
    return false;
};

let getSemanticScore = (pauta, alum) => {
    let r = 0;
    alum.sentences.forEach((s,i) => {
        let k = pauta.sentences.indexOf(s);
        if(k != -1 && pauta.docs[k] == alum.docs[i])
            r++;
    });
    return r/Math.max(pauta.sentences.length, alum.sentences.length);
};

module.exports = router;
