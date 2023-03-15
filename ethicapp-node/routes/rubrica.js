"use strict";

let express = require("express");
let router = express.Router();
let rpg = require("../modules/rest-pg");
let pass = require("../modules/passwords");
let socket = require("../modules/socket.config");

let exampleReports = {};

router.get("/rubrica", (req, res) => {
    if (req.session.uid && req.session.ses)
        res.render("rubrica");
    else
        res.redirect(".");
});


router.post("/send-rubrica", rpg.singleSQL({
    //TODO Auth
    dbcon: pass.dbcon,
    sql:   `
    INSERT INTO rubricas (sesid)
    VALUES ($1) RETURNING id
    `,
    sesReqData:  ["uid"],
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post", "sesid")]
}));


router.post("/send-criteria", rpg.execSQL({
    //TODO Auth
    dbcon: pass.dbcon,
    sql:   `
    INSERT INTO criteria (name, pond, inicio, proceso, competente, avanzado, rid)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    `,
    sesReqData:  ["uid"],
    postReqData: ["name", "pond", "inicio", "proceso", "competente", "avanzado", "rid"],
    sqlParams:   [
        rpg.param("post", "name"), rpg.param("post", "pond"), rpg.param("post", "inicio"),
        rpg.param("post", "proceso"), rpg.param("post", "competente"),
        rpg.param("post", "avanzado"), rpg.param("post", "rid")
    ]
}));


router.post("/delete-criterias", rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    DELETE
    FROM criteria
    WHERE rid = $1
    `,
    sesReqData:  ["uid"],
    postReqData: ["rid"],
    sqlParams:   [rpg.param("post","rid")]
}));


router.post("/get-admin-rubrica", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT c.id,
        c.name,
        c.pond,
        c.inicio,
        c.proceso,
        c.competente,
        c.avanzado,
        c.rid
    FROM criteria AS c,
        rubricas AS r
    WHERE c.rid = r.id
        AND r.sesid = $1
    `,
    sesReqData:  ["uid"],
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post", "sesid")]
}));


router.post("/get-rubrica", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT c.id,
        c.name,
        c.pond,
        c.inicio,
        c.proceso,
        c.competente,
        c.avanzado
    FROM criteria AS c,
        rubricas AS r
    WHERE c.rid = r.id
        AND r.sesid = $1
    `,
    sesReqData: ["ses"],
    sqlParams:  [rpg.param("ses", "ses")]
}));


router.post("/get-criteria-selection", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT id,
        cid,
        selection
    FROM criteria_selection
    WHERE UID = $1
        AND repid = $2
    `,
    sesReqData:  ["uid"],
    postReqData: ["rid"],
    sqlParams:   [rpg.param("ses", "uid"), rpg.param("post", "rid")]
}));


router.post("/get-report-comment", rpg.singleSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT comment
    FROM report_comment
    WHERE UID = $1
        AND repid = $2
    `,
    sesReqData:  ["uid"],
    postReqData: ["rid"],
    sqlParams:   [rpg.param("ses","uid"), rpg.param("post","rid")]
}));


router.post("/get-criteria-selection-by-report", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT UID,
        cid,
        selection
    FROM criteria_selection
    WHERE repid = $1
    `,
    sesReqData:  ["uid"],
    postReqData: ["repid"],
    sqlParams:   [rpg.param("post","repid")]
}));


router.post("/get-criteria-answer", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT id,
        cid,
        selection
    FROM criteria_selection
    WHERE UID in (
        SELECT id
        FROM users
        INNER JOIN sesusers
        ON id = UID
        WHERE ROLE = 'P'
            AND sesid = $1
    ) AND repid = $2
    `,
    sesReqData:  ["uid", "ses"],
    postReqData: ["rid"],
    sqlParams:   [rpg.param("ses","ses"), rpg.param("post","rid")]
}));


router.post("/send-example-report", rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    INSERT INTO reports (content, example, rid, UID, title)
    SELECT $1,
        TRUE,
        r.id,
        $2,
        $3
    FROM rubricas AS r
    WHERE r.sesid = $4
    LIMIT 1
    `,
    sesReqData:  ["uid"],
    postReqData: ["sesid","content","title"],
    sqlParams:   [
        rpg.param("post","content"), rpg.param("ses","uid"), rpg.param("post","title"),
        rpg.param("post","sesid")
    ]
}));


router.post("/get-example-reports", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT r.id,
        r.title,
        r.content,
        r.uid
    FROM reports AS r,
        rubricas AS b
    WHERE r.rid = b.id
        AND b.sesid = $1
        AND r.example = TRUE
    `,
    sesReqData:  ["uid"],
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post","sesid")]
}));


router.post("/get-report", rpg.singleSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT r.id,
        r.content,
        r.uid
    FROM reports AS r
    WHERE r.id = $1
    `,
    sesReqData: ["uid"],
    sqlParams:  [rpg.param("post","rid")]
}));


router.post("/get-report-uid", rpg.singleSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT r.id,
        r.content,
        r.uid
    FROM reports AS r
    INNER JOIN rubricas AS ru
    ON r.rid = ru.id
    WHERE ru.sesid = $1
        AND r.uid = $2
    `,
    postReqData: ["uid","sesid"],
    sqlParams:   [rpg.param("post","sesid"), rpg.param("post","uid")]
}));


router.post("/get-active-example-report", rpg.singleSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT r.id,
        r.content,
        r.uid
    FROM reports AS r
    WHERE r.id = $1
    `,
    sesReqData: ["uid","ses"],
    onStart:    (ses, data, calc) => {
        calc.rid = exampleReports[ses.ses];
    },
    sqlParams: [rpg.param("calc","rid")]
}));


router.post("/get-paired-report", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT rp.repid AS id,
        r.content,
        r.uid
    FROM report_pair AS rp
    INNER JOIN reports AS r
    ON rp.repid = r.id
    INNER JOIN rubricas AS k
    ON r.rid = k.id
    WHERE k.sesid = $1
        AND rp.uid = $2
    `,
    sesReqData: ["uid","ses"],
    sqlParams:  [rpg.param("ses","ses"),rpg.param("ses","uid")]
}));


router.post("/send-criteria-selection", rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    WITH ROWS AS (
        UPDATE criteria_selection
        SET selection = $1
        WHERE cid = $2
            AND UID = $3
            AND repid = $4 RETURNING 1
    )
    INSERT INTO criteria_selection(selection, cid, UID, repid)
    SELECT $5,
        $6,
        $7,
        $8
    WHERE 1 not in (
        SELECT *
        FROM ROWS
    )
    `,
    sesReqData:  ["uid"],
    postReqData: ["sel", "rid", "cid"],
    sqlParams:   [
        rpg.param("post","sel"), rpg.param("post","cid"), rpg.param("ses","uid"),
        rpg.param("post","rid"), rpg.param("post","sel"), rpg.param("post","cid"),
        rpg.param("ses","uid"), rpg.param("post","rid")
    ]
}));


router.post("/set-active-example-report", (req,res) => {
    if (
        req.session.uid == null || req.body.rid == null || req.body.sesid == null
        || req.session.role == null || req.session.role != "P"
    ) {
        res.end('{"status":"err"}');
        return;
    }
    exampleReports[req.body.sesid] = req.body.rid;
    socket.reportChange(req.body.sesid);
    res.end('{"status":"ok"}');
});


router.post("/set-eval-report", (req,res) => {
    if (
        req.session.uid == null || req.body.rid == null || req.body.sesid == null
        || req.session.role == null || req.session.role != "P"
    ) {
        res.end('{"status":"err"}');
        return;
    }
    socket.reportBroadcast(req.body.sesid, req.body.rid);
    res.end('{"status":"ok"}');
});


router.post("/broadcast-diff", (req,res) => {
    if (
        req.session.uid == null || req.body.sesid == null || req.body.content == null
        || req.session.role == null || req.session.role != "P"
    ) {
        res.end('{"status":"err"}');
        return;
    }
    socket.diffBroadcast(req.body.sesid, req.body.content);
    res.end('{"status":"ok"}');
});


router.post("/send-report", rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    WITH ROWS AS (
        UPDATE reports AS r
        SET content = $1
        FROM rubricas AS b
        WHERE r.uid = $2
            AND r.rid = b.id
            AND b.sesid = $3
        RETURNING 1
    )
    INSERT INTO reports(content, UID, example, rid)
    SELECT $4,
        $5,
        FALSE,
        id
    FROM rubricas AS t
    WHERE t.sesid = $6
        AND 1 not in (
            SELECT *
            FROM ROWS
        )
    `,
    sesReqData:  ["uid","ses"],
    postReqData: ["content"],
    sqlParams:   [
        rpg.param("post","content"), rpg.param("ses","uid"), rpg.param("ses","ses"),
        rpg.param("post","content"), rpg.param("ses","uid"), rpg.param("ses","ses")
    ]
}));


router.post("/send-report-comment", rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    WITH ROWS AS (
        UPDATE report_comment AS r
        SET COMMENT = $1
        WHERE r.uid = $2
            AND r.repid = $3
            RETURNING 1
    )
    INSERT INTO report_comment(COMMENT, UID, repid)
    SELECT $4,
        $5,
        $6
    WHERE 1 not in (
        SELECT *
        FROM ROWS
    )
    `,
    sesReqData:  ["uid","ses"],
    postReqData: ["rid","text"],
    sqlParams:   [
        rpg.param("post","text"), rpg.param("ses","uid"), rpg.param("post","rid"),
        rpg.param("post","text"), rpg.param("ses","uid"), rpg.param("post","rid")
    ]
}));


router.post("/get-my-report", rpg.singleSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT r.id,
        r.content
    FROM reports AS r,
        rubricas AS b
    WHERE r.uid = $1
        AND b.id = r.rid
        AND b.sesid = $2
    `,
    sesReqData: ["uid","ses"],
    sqlParams:  [rpg.param("ses","uid"), rpg.param("ses","ses")]
}));


router.post("/get-report-list", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT r.id,
        r.title,
        r.example,
        r.uid
    FROM reports AS r
    INNER JOIN rubricas AS ru
    ON ru.id = r.rid
        AND ru.sesid = $1
    `,
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post","sesid")]
}));


router.post("/get-report-result", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT cs.id,
        cs.selection,
        cs.uid,
        c.pond,
        rc.comment
    FROM criteria_selection AS cs
    INNER JOIN criteria AS c
    ON cs.cid = c.id
    LEFT OUTER JOIN report_comment AS rc
    ON cs.uid = rc.uid
        AND cs.repid = rc.repid
    WHERE cs.repid = $1
    `,
    postReqData: ["repid"],
    sqlParams:   [rpg.param("post","repid")],
    onEnd:       (req,res,arr) => {
        let d = {};
        let c = {};
        arr.forEach((row) => {
            if(d[row.uid] == null) {
                d[row.uid] = row.selection * row.pond * 0.01;
                c[row.uid] = row.comment;
            }
            else
                d[row.uid] += row.selection * row.pond * 0.01;
        });
        let resArr = Object.keys(d).map(u => {return {uid: u, val: d[u], com: c[u]};});
        res.end(JSON.stringify(resArr));
    }
}));


router.post("/get-report-result-all", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT r.id AS repid,
        cs.id,
        cs.selection,
        cs.uid,
        c.pond
    FROM criteria_selection AS cs
    INNER JOIN criteria AS c
    ON cs.cid = c.id
    INNER JOIN reports AS r
    ON r.id = cs.repid
    INNER JOIN rubricas AS rb
    ON r.rid = rb.id
    WHERE rb.sesid = $1
        AND r.example = FALSE
    `,
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post","sesid")],
    onEnd:       (req,res,arr) => {
        let d = {};
        arr.forEach((row) => {
            if(d[row.repid] == null)
                d[row.repid] = {};
            if(d[row.repid][row.uid] == null)
                d[row.repid][row.uid] = row.selection * row.pond * 0.01;
            else
                d[row.repid][row.uid] += row.selection * row.pond * 0.01;
        });
        let resArr = Object.keys(d).map(repObj => {
            return Object.keys(d[repObj]).map(u => {
                return {uid: u, val: d[repObj][u], rid: repObj};
            });
        });
        console.log(d);
        res.end(JSON.stringify(resArr));
    }
}));


router.post("/get-report-ideas", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT idea_id AS ideaid
    FROM report_ideas
    WHERE rid = $1
    `,
    postReqData: ["repid"],
    sqlParams:   [rpg.param("post","repid")]
}));


router.post("/clear-report-ideas", rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    DELETE
    FROM report_ideas
    WHERE rid = $1
    `,
    postReqData: ["repid"],
    sqlParams:   [rpg.param("post","repid")]
}));


router.post("/send-report-idea", rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    INSERT INTO report_ideas(rid, idea_id)
    VALUES ($1,$2)
    `,
    postReqData: ["repid", "iid"],
    sqlParams:   [rpg.param("post","repid"), rpg.param("post","iid")]
}));


router.post("/get-report-evaluators", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT UID
    FROM report_pair
    WHERE repid = $1
    `,
    postReqData: ["repid"],
    sqlParams:   [rpg.param("post","repid")]
}));


module.exports = router;
