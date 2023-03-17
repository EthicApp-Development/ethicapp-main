"use strict";

let express = require("express");
let router = express.Router();
let rpg = require("../modules/rest-pg");
let pass = require("../modules/passwords");
let middleware = require("../midleware/validate-session");

router.post("/get-alum-state-sel", middleware.verifySession, rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT uid, SUM(correct) AS score, COUNT(correct) AS answered
    FROM (
        SELECT s.uid, (s.answer = q.answer)::int AS correct
        FROM SELECTION AS s
        INNER JOIN questions AS q
        ON s.qid = q.id
        WHERE q.sesid = $1 AND s.iteration = $2
    ) AS r group by uid
    `,
    postReqData: ["sesid", "iteration"],
    onStart:     (ses, data, calc) => {
        if (ses.role != "P") {
            console.error("Sólo el profesor puede ver el estado de los alumnos");
            return "SELECT $1";
        }
    },
    sqlParams: [rpg.param("post", "sesid"),rpg.param("post", "iteration")]
}));

router.post("/get-alum-full-state-sel", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT s.uid, q.id AS qid, (s.answer = q.answer)::int AS correct
    FROM selection AS s
    INNER JOIN questions AS q
    ON s.qid = q.id
    WHERE q.sesid = $1 AND s.iteration = $2
    `,
    postReqData: ["sesid", "iteration"],
    onStart:     (ses, data, calc) => {
        if (ses.role != "P") {
            console.error("Sólo el profesor puede ver el estado de los alumnos");
            return "SELECT $1";
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
        sql:   `
        SELECT t.id AS team, u.id AS uid
        FROM teams AS t, users AS u, teamusers AS tu
        WHERE t.id = tu.tmid AND u.id = tu.uid AND t.sesid = ${req.body.sesid}
        `,
        preventResEnd: true,
        onEnd:         (req,res,arr) => {
            if (arr.length == 0) {
                rpg.multiSQL({
                    dbcon: pass.dbcon,
                    sql:   `
                    SELECT uid, SUM(correct) AS score, COUNT(correct) AS answered
                    FROM (
                        SELECT s.uid, (s.answer = q.answer)::int AS correct
                        FROM selection AS s
                        INNER JOIN questions AS q
                        ON s.qid = q.id
                        WHERE q.sesid = $1 AND s.iteration = $2
                    ) AS r GROUP BY uid
                    `,
                    onStart: (ses, data, calc) => {
                        if (ses.role != "P") {
                            console.error("Sólo el profesor puede ver el estado de los alumnos");
                            return "SELECT $1";
                        }
                    },
                    preventResEnd: true,
                    sqlParams:     [rpg.param("post", "sesid")],
                    onEnd:         (req, res, arr) => {
                        let groups = generateTeams(
                            arr, (s) => s.score, req.body.gnum, isDifferent(req.body.method)
                        );
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

router.post("/group-proposal-stage", (req, res) => {
    if (req.session.role != "P") {
        res.end("[]");
        return;
    }
    rpg.multiSQL({
        dbcon: pass.dbcon,
        sql:   `
        SELECT t.id AS team, u.id AS uid
        FROM teams AS t, users AS u, teamusers AS tu
        WHERE t.id = tu.tmid AND u.id = tu.uid AND t.stageid = ${req.body.stageid}
        `,
        preventResEnd: true,
        onEnd:         (req,res,arr) => {
            let t = {};
            let groups = [];
            arr.forEach((row) => {
                if(t[row.team] == null) {
                    t[row.team] = groups.length;
                    groups.push([{uid: row.uid, tmid: row.team}]);
                }
                else
                    groups[t[row.team]].push({uid: row.uid, tmid: row.team});
            });
            res.end(JSON.stringify(groups));
        }
    })(req,res);
});

router.post("/get-alum-state-lect", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT DISTINCT a.uid, a.orden, a.serial, a.content, a.docid, p.serial AS serial_ans,
        p.content AS content_ans, p.docid AS docid_ans
    FROM ideas AS a, ideas AS p, sessions AS s
    WHERE s.creator = p.uid AND a.uid != s.creator AND a.orden = p.orden AND s.id = $1
        AND a.docid IN (
            SELECT id
            FROM documents
            WHERE sesid = s.id
        ) AND p.docid IN (
            SELECT id FROM documents WHERE sesid = s.id
        ) AND a.iteration = $2
    ORDER BY uid, a.orden ASC
    `,
    postReqData: ["sesid", "iteration"],
    onStart:     (ses, data, calc) => {
        if (ses.role != "P") {
            console.error("Sólo el profesor puede ver el estado de los alumnos");
            return "SELECT $1, $2";
        }
    },
    preventResEnd: true,
    sqlParams:     [rpg.param("post", "sesid"), rpg.param("post", "iteration")],
    onEnd:         (req,res,arr) => {
        rpg.singleSQL({
            dbcon: pass.dbcon,
            sql:   `
            SELECT Max(orden) AS total
            FROM   ideas      AS p,
                sessions   AS s,
                documents  AS d
            WHERE  p.docid = d.id
            AND    d.sesid = s.id
            AND    s.creator = p.uid
            AND    s.id = ${req.body.sesid}
            `,
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
                        scores.push({uid: last_uid, score: 0});
                        scoresUsed = {};
                    }
                    if(ideasMatch(row)){
                        if(!scoresUsed[row.orden]){
                            scores[i].score += 1;
                        }
                        else {
                            scores[i].score += 0.3;
                        }
                        scoresUsed[row.orden] = true;
                    }
                    else if (
                        !scoresUsed[row.orden] && allAns.includes(row.content.trim().toLowerCase())
                    ) {
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
    sql:   `
    SELECT
        a.uid,
        a.sentences,
        a.docs,
        a.uid = s.creator AS is_ans 
    FROM
        semantic_unit AS a,
        sessions AS s 
    WHERE
        s.id = $1 
        AND a.sesid = s.id 
        AND 
        (
            a.iteration = $2 
            OR a.uid = s.creator
        )
    ORDER BY
        is_ans DESC,
        a.uid,
        a.sentences
    `,
    postReqData: ["sesid","iteration"],
    onStart:     (ses, data, calc) => {
        if (ses.role != "P") {
            console.error("Sólo el profesor puede ver el estado de los alumnos");
            return "select $1, $2";
        }
    },
    preventResEnd: true,
    sqlParams:     [rpg.param("post", "sesid"), rpg.param("post", "iteration")],
    onEnd:         (req,res,arr) => {
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
        total = (total >= 3) ? 3 : total;
        // ALUMNOS
        let sc = 0;
        let last_uid = -1;
        if(arr[i] != null)
            last_uid = arr[i].uid;
        for(; i < arr.length; i++){
            let alum = arr[i];
            if(alum.uid != last_uid){
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
        sql:   `
        SELECT
            t.id AS team,
            u.id AS uid 
        FROM
            teams AS t,
            users AS u,
            teamusers AS tu 
        WHERE
            t.id = tu.tmid 
            AND u.id = tu.uid 
            AND t.sesid = ${req.body.sesid}
        `,
        preventResEnd: true,
        onEnd:         (req,res,arr) => {
            if(arr.length == 0) {
                rpg.multiSQL({
                    dbcon: pass.dbcon,
                    sql:   `
                    SELECT DISTINCT a.uid,
                        a.orden,
                        a.serial,
                        a.content,
                        a.docid,
                        p.serial AS serial_ans,
                        p.content AS content_ans,
                        p.docid AS docid_ans
                    FROM ideas AS a,
                        ideas AS p,
                        sessions AS s
                    WHERE s.creator = p.uid
                        AND a.uid != s.creator
                        AND a.orden = p.orden
                        AND s.id = $1
                        AND a.docid in (
                            SELECT id
                            FROM documents
                            WHERE sesid = s.id
                        )
                        AND p.docid in (
                            SELECT id
                            FROM documents
                            WHERE sesid = s.id
                        )
                        AND a.iteration = 1
                    ORDER BY UID,
                        a.orden ASC
                    `,
                    postReqData: ["sesid"],
                    onStart:     (ses, data, calc) => {
                        if (ses.role != "P") {
                            console.error("Sólo el profesor puede ver el estado de los alumnos");
                            return "SELECT $1";
                        }
                    },
                    preventResEnd: true,
                    sqlParams:     [rpg.param("post", "sesid")],
                    onEnd:         (req,res,arr) => {
                        rpg.singleSQL({
                            dbcon: pass.dbcon,
                            sql:   `
                            SELECT max(orden) AS total
                            FROM ideas AS p,
                                sessions AS s,
                                documents AS d
                            WHERE p.docid = d.id
                                AND d.sesid = s.id
                                AND s.creator = p.uid
                                AND s.id = ${req.body.sesid}
                            `,
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
                                        scores.push({uid: last_uid, score: 0});
                                        scoresUsed = {};
                                    }
                                    if(ideasMatch(row)){
                                        if(!scoresUsed[row.orden]){
                                            scores[i].score += 1;
                                        }
                                        else {
                                            scores[i].score += 0.3;
                                        }
                                        scoresUsed[row.orden] = true;
                                    }
                                    else if (
                                        !scoresUsed[row.orden] &&
                                        allAns.includes(row.content.trim().toLowerCase())
                                    ){
                                        scores[i].score += 0.7;
                                        scoresUsed[row.orden] = true;
                                    }
                                });
                                if (i>=0)
                                    scores[i].score /= total;
                                let groups = generateTeams(
                                    scores,
                                    (s) => s.score, req.body.gnum,
                                    isDifferent(req.body.method)
                                );
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
        sql:   `
        SELECT t.id AS team,
            u.id AS UID
        FROM teams AS t,
            users AS u,
            teamusers AS tu
        WHERE t.id = tu.tmid
        AND u.id = tu.uid
        AND t.sesid = ${req.body.sesid}
        `,
        preventResEnd: true,
        onEnd:         (req,res,arr) => {
            if(arr.length == 0) {
                rpg.multiSQL({
                    dbcon: pass.dbcon,
                    sql:   `
                    SELECT u.id AS UID,
                        u.aprendizaje
                    FROM users AS u
                    INNER JOIN sesusers AS su
                    ON su.uid = u.id
                    WHERE su.sesid = ${req.body.sesid}
                    AND u.role='A'
                    `,
                    onEnd: (req, res, arr) => {
                        let groups = generateTeams(
                            arr, habMetric, req.body.gnum, isDifferent(req.body.method)
                        );
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
        sql:   `
        SELECT t.id AS team,
            u.id AS UID
        FROM teams AS t,
            users AS u,
            teamusers AS tu
        WHERE t.id = tu.tmid
        AND u.id = tu.uid
        AND t.sesid = ${req.body.sesid}
        `,
        preventResEnd: true,
        onEnd:         (req,res,arr) => {
            if(arr.length == 0) {
                rpg.multiSQL({
                    dbcon: pass.dbcon,
                    sql:   `
                    SELECT u.id AS UID,
                        random() AS rnd
                    FROM users AS u
                    INNER JOIN sesusers AS su
                    ON su.uid = u.id
                    WHERE su.sesid = ${req.body.sesid}
                    AND u.role='A'
                    `,
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
    return row.docid == row.docid_ans &&
        row.content.toLowerCase().trim() == row.content_ans.toLowerCase().trim();
};

let isDifferent = (type) => {
    switch (type){
    case "Rendimiento Homogéneo":
        return false;
    case "Rendimiento Heterogéneo":
        return true;
    case "Tipo Aprendizaje Homogéneo":
        return false;
    case "Tipo Aprendizaje Heterogéneo":
        return true;
    }
    return false;
};

let habMetric = (u) => {
    switch (u.aprendizaje){
    case "Teórico":
        return -2;
    case "Reflexivo":
        return -1;
    case "Activo":
        return 1;
    case "Pragmático":
        return 2;
    }
    return 0;
};

router.post("/set-groups", (req, res) => {
    if (req.session.role != "P" || req.body.sesid == null || req.body.groups == null) {
        res.end('{"status":"err"}');
        return;
    }
    let sql = `
    DELETE
    FROM teamusers AS tu USING teams AS t
    WHERE tu.tmid = t.id
    AND t.sesid = ${req.body.sesid};

    DELETE
    FROM teams
    WHERE sesid = ${req.body.sesid}:
    `;
    let grupos = JSON.parse(req.body.groups);
    grupos.forEach((team) => {
        sql += `
        WITH ROWS AS (
            INSERT INTO teams(sesid, leader, original_leader)
            VALUES (
                ${req.body.sesid}, ${team[0]}, ${team[0]}
            ) RETURNING id
        )
            INSERT INTO teamusers(tmid, UID)
            SELECT id,
                unnest(
                    '{${team.join(",")}}'::int[]
                )
            FROM ROWS;
        `;
    });
    rpg.execSQL({
        dbcon: pass.dbcon,
        sql:   sql,
        onEnd: () => {
            res.end('{"status":"ok"}');
        }
    })(req,res);
});

router.post("/set-groups-stage", (req, res) => {
    if (req.session.role != "P" || req.body.stageid == null || req.body.groups == null) {
        res.end('{"status":"err"}');
        return;
    }
    let sql = `
    DELETE
    FROM teamusers AS tu USING teams AS t
    WHERE tu.tmid = t.id
    AND t.stageid = ${req.body.stageid};

    DELETE
    FROM teams
    WHERE stageid = ${req.body.stageid};
    `;
    let grupos = JSON.parse(req.body.groups);
    grupos.forEach((team) => {
        sql += `
        WITH ROWS AS (
            INSERT INTO teams(stageid, leader, original_leader)
            VALUES (
                ${req.body.stageid}, ${team[0]}, ${team[0]}
            )
            RETURNING id
        )
        INSERT INTO teamusers(tmid, UID)
        SELECT id,
            unnest(
                '{${team.join(",")}}'::int[]
            )
        FROM ROWS;
        `;
    });
    rpg.execSQL({
        dbcon: pass.dbcon,
        sql:   sql,
        onEnd: () => {
            res.end('{"status":"ok"}');
        }
    })(req, res);
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
        console.error("Data not provided");
        res.end('{"status":"err", "msg":"No hay datos suficientes"}');
        return;
    }
    let ses = req.body.sesid;
    let m = req.body.rnum;
    rpg.multiSQL({
        dbcon: pass.dbcon,
        sql:   `
        SELECT r.id,
            r.uid
        FROM reports AS r
        INNER JOIN rubricas AS k
        ON r.rid = k.id
        WHERE r.example = FALSE
        AND k.sesid = ${ses}
        `,
        onEnd: (req, res, arr) => {
            let n = arr.length;
            if (m >= n) {
                console.error("More pairs than reports");
                res.end(
                    '{"status":"err", "msg":"No hay suficientes reportes completos para asignar pares"}'
                );
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
                    // console.log("Seleccionable son: " + sel);
                    if(sel.length == 0 || sel.length == 1 && sel[0] == uids[i]){
                        console.error("Infinite loop");
                        res.end(
                            '{"status":"err", "msg":"Error de consistencia de los pares formados. Intente nuevamente"}'
                        );
                        return;
                    }
                    let r = ~~(Math.random()*sel.length);
                    // console.log("Indice random es: " + r + ", rid es: " + ri);
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
                res.end(
                    '{"status":"err", "msg":"Error de consistencia de los pares formados. Intente nuevamente"}'
                );
                return;
            }
            if(hasDuplicates(pairstr)){
                console.error("Se encontraron duplicados");
                res.end(
                    '{"status":"err", "msg":"Error de duplicación de pares asignados. Intente nuevamente"}'
                );
                return;
            }
            console.log("Pairs formed: " + pairstr.join(" "));

            let sql = `
            INSERT INTO report_pair(sesid, uid, repid) VALUES
            `;
            sql += pairs.map(e => `(${ses}, ${e.uid}, ${e.rid})`).join(",");
            rpg.execSQL({
                dbcon:         pass.dbcon,
                sql:           sql,
                onEnd:         () => {},
                preventResEnd: true
            })(req,res);

            res.end('{"status":"ok"}');
        }
    })(req,res);
});

router.post("/get-ideas-progress", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT i.uid,
        count(*) AS COUNT
    FROM ideas AS i
    INNER JOIN users AS u
    ON i.uid = u.id
    WHERE iteration = $1
    AND u.role = 'A'
    AND i.docid in (
        SELECT id
        FROM documents
        WHERE sesid = $2
    )
    GROUP BY UID
    `,
    postReqData: ["iteration", "sesid"],
    sqlParams:   [rpg.param("post", "iteration"), rpg.param("post", "sesid")]
}));

router.post("/get-alum-done-time", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT f.uid, extract(epoch FROM f.stime - s.stime) AS dtime
    FROM finish_session AS f,
        status_record AS s
    WHERE s.status = f.status
    AND s.sesid = f.sesid
    AND f.status = ($1 + 2)
    AND f.sesid = $2
    `,
    postReqData: ["iteration", "sesid"],
    sqlParams:   [rpg.param("post", "iteration"), rpg.param("post", "sesid")]
}));

router.post("/get-alum-confidence", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT s.confidence AS conf,
        q.id AS qid,
        count(*) AS freq
    FROM selection AS s
    INNER JOIN questions AS q
    ON s.qid = q.id
    WHERE q.sesid = $1
    AND s.iteration = $2
    AND s.confidence IS NOT NULL
    GROUP BY s.confidence, q.id
    `,
    postReqData: ["sesid","iteration"],
    onStart:     (ses, data, calc) => {
        if (ses.role != "P") {
            console.error("Sólo el profesor puede ver el estado de los alumnos");
            return "SELECT $1, $2";
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
