"use strict";

let express = require("express");
let router = express.Router();
let rpg = require("../modules/rest-pg");
let pass = require("../modules/passwords");
let socket = require("../modules/socket.config");

let sesStatusCache = {};


router.get("/to-visor", (req, res) => {
    if (req.session.uid && !isNaN(req.query.sesid)) {
        req.session.ses = req.query.sesid;
        let doRedirect = (status) => {
            console.log(status);
            if(status <= 6) res.redirect("visor");
            else res.redirect("rubrica");
        };
        if(sesStatusCache[req.query.sesid] == null) {
            rpg.singleSQL({
                dbcon: pass.dbcon,
                sql:   `
                SELECT status
                FROM sessions
                WHERE id = ${req.query.sesid}
                `,
                onEnd: (req, res, result) => {
                    sesStatusCache[req.query.sesid] = result.status;
                    doRedirect(result.status);
                }
            })(req, res);
        }
        else {
            doRedirect(sesStatusCache[req.query.sesid]);
        }
    }
    else
        res.redirect(".");
});


router.get("/to-pauta", (req, res) => {
    if (req.session.uid && !isNaN(req.query.sesid) && req.session.role == "P") {
        req.session.ses = req.query.sesid;
        let doRedirect = (status) => {
            console.log(status);
            res.redirect("pauta");
        };
        if(sesStatusCache[req.query.sesid] == null) {
            rpg.singleSQL({
                dbcon: pass.dbcon,
                sql:   `
                SELECT status
                FROM sessions
                WHERE id = ${req.query.sesid}
                `,
                onEnd: (req, res, result) => {
                    sesStatusCache[req.query.sesid] = result.status;
                    doRedirect(result.status);
                }
            })(req, res);
        }
        else {
            doRedirect(sesStatusCache[req.query.sesid]);
        }
    }
    else
        res.redirect(".");
});


router.get("/to-rubrica", (req, res) => {
    if (req.session.uid && !isNaN(req.query.sesid) && req.session.role == "P") {
        req.session.ses = req.query.sesid;
        let doRedirect = (status) => {
            console.log(status);
            res.redirect("rubrica");
        };
        if(sesStatusCache[req.query.sesid] == null) {
            rpg.singleSQL({
                dbcon: pass.dbcon,
                sql:   `
                SELECT status
                FROM sessions
                WHERE id = ${req.query.sesid}
                `,
                onEnd: (req, res, result) => {
                    sesStatusCache[req.query.sesid] = result.status;
                    doRedirect(result.status);
                }
            })(req, res);
        }
        else {
            doRedirect(sesStatusCache[req.query.sesid]);
        }
    }
    else
        res.redirect(".");
});


router.get("/visor", (req, res) => {
    if (req.session.uid && req.session.ses)
        res.render("visor");
    else
        res.redirect(".");
});


router.get("/pauta", (req, res) => {
    if (req.session.uid && req.session.ses && req.session.role == "P")
        res.render("visor-pauta");
    else
        res.redirect(".");
});


router.get("/to-select", (req, res) => {
    if (req.session.uid) {
        req.session.ses = req.query.sesid;
        res.redirect("select");
    }
    else
        res.redirect(".");
});


router.get("/select", (req, res) => {
    if (req.session.uid && req.session.ses)
        res.render("select");
    else
        res.redirect(".");
});


router.get("/to-semantic", (req, res) => {
    if (req.session.uid) {
        req.session.ses = req.query.sesid;
        res.redirect("semantic");
    }
    else
        res.redirect(".");
});


router.get("/semantic", (req, res) => {
    if (req.session.uid && req.session.ses)
        res.render("semantic");
    else
        res.redirect(".");
});


router.get("/to-differential", (req, res) => {
    if (req.session.uid) {
        req.session.ses = req.query.sesid;
        res.redirect("differential");
    }
    else
        res.redirect(".");
});


router.get("/differential", (req, res) => {
    if (req.session.uid && req.session.ses)
        res.render("differential");
    else
        res.redirect(".");
});


router.get("/to-role", (req, res) => {
    if (req.session.uid) {
        req.session.ses = req.query.sesid;
        res.redirect("role-playing");
    }
    else
        res.redirect(".");
});


router.get("/role-playing", (req, res) => {
    if (req.session.uid && req.session.ses)
        res.render("roles");
    else
        res.redirect(".");
});


router.get("/to-diff", (req, res) => {
    if (req.session.uid) {
        req.session.ses = req.query.sesid;
        res.redirect("ethics");
    }
    else
        res.redirect(".");
});


router.get("/ethics", (req, res) => {
    if (req.session.uid && req.session.ses)
        res.render("ethics");
    else
        res.redirect(".");
});


router.post("/get-documents", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT id,
        title,
        PATH
    FROM documents
    WHERE sesid = $1
        AND active = TRUE
    `,
    sesReqData: ["uid", "ses"],
    sqlParams:  [rpg.param("ses", "ses")]
}));


router.post("/delete-document", rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    UPDATE documents
    SET active = FALSE
    WHERE id = $1
    `,
    postReqData: ["docid"],
    sqlParams:   [rpg.param("post", "docid")]
}));


router.post("/get-questions", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT q.id,
        q.content,
        q.options,
        qt.content AS text_content,
        q.plugin_data
    FROM questions AS q
    LEFT OUTER JOIN question_text AS qt
    ON q.textid = qt.id
    WHERE q.sesid = $1
    ORDER BY q.id ASC
    `,
    sesReqData: ["uid", "ses"],
    sqlParams:  [rpg.param("ses", "ses")]
}));


router.post("/get-anskey", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT id,
        COMMENT,
        answer
    FROM questions
    WHERE sesid = $1
    `,
    sesReqData: ["uid", "ses"],
    sqlParams:  [rpg.param("ses", "ses")]
}));


router.post("/send-answer", rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    WITH ROWS AS (
        UPDATE selection
        SET answer = $1,
            comment = $2,
            stime = now(),
            confidence = $3
        WHERE qid = $4
            AND UID = $5
            AND iteration = $6
        RETURNING 1
    )
    INSERT INTO selection(UID, qid, answer, comment, iteration, confidence, stime)
    SELECT $7,
        $8,
        $9,
        $10,
        $11,
        $12,
        now()
    WHERE 1 not in (
        SELECT *
        FROM ROWS
    )
    `,
    sesReqData:  ["uid", "ses"],
    postReqData: ["qid", "answer", "comment", "iteration"],
    sqlParams:   [
        rpg.param("post", "answer"), rpg.param("post", "comment"), rpg.param("post", "confidence"),
        rpg.param("post", "qid"), rpg.param("ses", "uid"), rpg.param("post", "iteration"),
        rpg.param("ses", "uid"), rpg.param("post", "qid"), rpg.param("post", "answer"),
        rpg.param("post", "comment"), rpg.param("post", "iteration"),
        rpg.param("post", "confidence")
    ]
}));


router.post("/get-answers", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT s.qid,
        s.answer,
        s.comment,
        s.confidence
    FROM selection AS s
    INNER JOIN questions AS q
    ON q.id = s.qid
    WHERE q.sesid = $1
        AND s.uid = $2
        AND s.iteration = $3
    `,
    sesReqData:  ["uid", "ses"],
    postReqData: ["iteration"],
    sqlParams:   [rpg.param("ses", "ses"), rpg.param("ses", "uid"), rpg.param("post","iteration")]
}));


router.post("/send-diff-selection", rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    WITH ROWS AS (
        UPDATE differential_selection
        SET sel = $1,
            comment = $2,
            stime = now()
        WHERE did = $3
            AND UID = $4
            AND iteration = $5
        RETURNING 1
    )
    INSERT INTO differential_selection(UID, did, sel, comment, iteration, stime)
    SELECT $6,
        $7,
        $8,
        $9,
        $10,
        now()
    WHERE 1 not in (
        SELECT *
        FROM ROWS
    )
    `,
    sesReqData:  ["uid", "ses"],
    postReqData: ["did", "sel", "comment", "iteration"],
    sqlParams:   [
        rpg.param("post", "sel"), rpg.param("post", "comment"), rpg.param("post", "did"),
        rpg.param("ses", "uid"), rpg.param("post", "iteration"), rpg.param("ses", "uid"),
        rpg.param("post", "did"), rpg.param("post", "sel"), rpg.param("post", "comment"),
        rpg.param("post", "iteration")
    ]
}));


router.post("/get-diff-selection", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT s.did,
        s.sel,
        s.comment
    FROM differential_selection AS s
    INNER JOIN differential AS d
    ON d.id = s.did
    WHERE d.sesid = $1
        AND s.uid = $2
        AND s.iteration = $3
    `,
    sesReqData:  ["uid", "ses"],
    postReqData: ["iteration"],
    sqlParams:   [rpg.param("ses", "ses"), rpg.param("ses", "uid"), rpg.param("post","iteration")]
}));


router.post("/get-diff-selection-stage", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT s.did,
        s.sel,
        s.comment
    FROM differential_selection AS s
    INNER JOIN differential AS d
    ON d.id = s.did
    WHERE d.stageid = $1
        AND s.uid = $2
    `,
    sesReqData:  ["uid", "ses"],
    postReqData: ["stageid"],
    sqlParams:   [rpg.param("post", "stageid"), rpg.param("ses", "uid")]
}));


router.post("/get-chat-msgs", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT s.id,
        s.did,
        s.uid,
        s.content,
        s.stime,
        s.parent_id
    FROM differential_chat AS s
    INNER JOIN differential AS d
    ON d.id = s.did
    WHERE d.sesid = $1
        AND s.uid in (
            SELECT tu.uid
            FROM teamusers AS tu
            WHERE tu.tmid = (
                SELECT t.id
                FROM teamusers AS tu,
                    teams AS t
                WHERE t.sesid = $2
                    AND tu.tmid = t.id
                    AND tu.uid = $3
            )
        )
    ORDER BY s.stime ASC
    `,
    sesReqData: ["uid", "ses"],
    sqlParams:  [rpg.param("ses", "ses"), rpg.param("ses", "ses"), rpg.param("ses","uid")]
}));


router.post("/get-chat-stage", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT s.id,
        s.uid,
        s.content,
        s.stime,
        s.parent_id,
        s.stageid
    FROM chat AS s
    WHERE s.stageid = $1
        AND s.uid in (
            SELECT tu.uid
            FROM teamusers AS tu
            WHERE tu.tmid = (
                SELECT t.id
                FROM teamusers AS tu,
                    teams AS t
                WHERE t.stageid = $2
                    AND tu.tmid = t.id
                    AND tu.uid = $3
            )
        )
    ORDER BY s.stime ASC
    `,
    sesReqData:  ["uid", "ses"],
    postReqData: ["stageid"],
    sqlParams:   [
        rpg.param("post", "stageid"), rpg.param("post","stageid"), rpg.param("ses", "uid")
    ]
}));


router.post("/get-diff-chat-stage", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT s.id,
        s.did,
        s.uid,
        s.content,
        s.stime,
        s.parent_id
    FROM differential_chat AS s
    INNER JOIN differential AS d
    ON d.id = s.did
    WHERE d.stageid = $1
        AND s.uid in (
            SELECT tu.uid
            FROM teamusers AS tu
            WHERE tu.tmid = (
                SELECT t.id
                FROM teamusers AS tu,
                    teams AS t
                WHERE t.stageid = $2
                    AND tu.tmid = t.id
                    AND tu.uid = $3
            )
        )
    ORDER BY s.stime ASC
    `,
    sesReqData:  ["uid", "ses"],
    postReqData: ["stageid"],
    sqlParams:   [
        rpg.param("post", "stageid"), rpg.param("post","stageid"), rpg.param("ses", "uid")
    ]
}));


router.post("/get-team-chat", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT s.id,
        s.did,
        s.uid,
        s.content,
        s.stime,
        s.parent_id
    FROM differential_chat AS s
    INNER JOIN differential AS d
    ON d.id = s.did
    WHERE d.sesid = $1
        AND s.uid in (
            SELECT tu.uid
            FROM teamusers AS tu
            WHERE tu.tmid = $2
        )
        AND d.orden = $3
    ORDER BY s.stime ASC
    `,
    postReqData: ["sesid", "tmid", "orden"],
    sqlParams:   [rpg.param("post", "sesid"), rpg.param("post","tmid"), rpg.param("post","orden")]
}));


router.post("/get-team-chat-stage-df", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT s.id,
        s.did,
        s.uid,
        s.content,
        s.stime,
        s.parent_id
    FROM differential_chat AS s
    INNER JOIN differential AS d
    ON d.id = s.did
    WHERE d.stageid = $1
        AND s.uid in (
            SELECT tu.uid
            FROM teamusers AS tu
            WHERE tu.tmid = $2
        )
        AND d.id = $3
    ORDER BY s.stime ASC
    `,
    postReqData: ["stageid", "tmid", "did"],
    sqlParams:   [rpg.param("post", "stageid"), rpg.param("post","tmid"), rpg.param("post","did")]
}));


router.post("/get-team-chat-stage", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT s.id,
        s.uid,
        s.content,
        s.stime,
        s.parent_id
    FROM chat AS s
    WHERE s.stageid = $1
    AND s.uid in (
        SELECT tu.uid
        FROM teamusers AS tu
        WHERE tu.tmid = $2
    )
    ORDER BY s.stime ASC
    `,
    postReqData: ["stageid", "tmid"],
    sqlParams:   [rpg.param("post", "stageid"), rpg.param("post","tmid")]
}));


router.post("/add-chat-msg", rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    INSERT INTO differential_chat(UID, did, content, parent_id)
    VALUES ($1,$2,$3,$4)
    `,
    sesReqData:  ["uid", "ses"],
    postReqData: ["did", "content", "tmid"],
    sqlParams:   [
        rpg.param("ses", "uid"), rpg.param("post", "did"), rpg.param("post","content"),
        rpg.param("post","parent_id")
    ],
    onEnd: (req) => {
        socket.chatMsg(req.session.ses, req.body.tmid);
    }
}));


router.post("/add-chat-msg-stage", rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    INSERT INTO chat(UID, stageid, content, parent_id)
    VALUES ($1,$2,$3,$4)
    `,
    sesReqData:  ["uid", "ses"],
    postReqData: ["stageid", "content", "tmid"],
    sqlParams:   [
        rpg.param("ses", "uid"), rpg.param("post", "stageid"), rpg.param("post","content"),
        rpg.param("post","parent_id")
    ],
    onEnd: (req) => {
        socket.chatMsgStage(req.body.stageid, req.body.tmid);
    }
}));


router.post("/send-idea", rpg.singleSQL({
    dbcon: pass.dbcon,
    sql:   `
    INSERT INTO ideas(content, descr,serial,docid, UID, iteration, stime)
    VALUES ($1,$2,$3,$4,$5,$6,now())
    RETURNING id
    `,
    sesReqData:  ["uid", "ses"],
    postReqData: ["docid", "text", "comment", "serial", "iteration"],
    sqlParams:   [
        rpg.param("post", "text"), rpg.param("post", "comment"), rpg.param("post", "serial"),
        rpg.param("post", "docid"), rpg.param("ses", "uid"), rpg.param("post", "iteration")
    ]
}));


router.post("/send-team-idea", rpg.singleSQL({
    dbcon: pass.dbcon,
    sql:   `
    INSERT INTO ideas(content, descr,serial,docid, UID, iteration, stime)
    VALUES ($1,$2,$3,$4,$5,$6,now())
    RETURNING id
    `,
    sesReqData:  ["uid", "ses"],
    postReqData: ["docid", "text", "comment", "serial", "iteration", "uidoriginal"],
    sqlParams:   [
        rpg.param("post", "text"), rpg.param("post", "comment"), rpg.param("post", "serial"),
        rpg.param("post", "docid"), rpg.param("post", "uidoriginal"), rpg.param("post", "iteration")
    ]
}));


router.post("/send-pauta-idea", rpg.singleSQL({
    dbcon: pass.dbcon,
    sql:   `
    INSERT INTO ideas(content, descr,serial,docid, UID, iteration, orden)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    RETURNING id
    `,
    sesReqData:  ["uid", "ses"],
    postReqData: ["docid", "text", "comment", "serial", "iteration", "order"],
    sqlParams:   [
        rpg.param("post", "text"), rpg.param("post", "comment"), rpg.param("post", "serial"),
        rpg.param("post", "docid"), rpg.param("ses", "uid"), rpg.param("post", "iteration"),
        rpg.param("post", "order")
    ]
}));


router.post("/update-idea", rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    UPDATE ideas
    SET content = $1,
        descr = $2,
        serial = $3,
        stime = now()
    WHERE id = $4
    `,
    sesReqData:  ["uid", "ses"],
    postReqData: ["docid", "text", "comment", "serial", "id"],
    sqlParams:   [
        rpg.param("post", "text"), rpg.param("post", "comment"), rpg.param("post", "serial"),
        rpg.param("post", "id")
    ]
}));


router.post("/update-pauta-idea", rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    UPDATE ideas
    SET content = $1,
        descr = $2,
        serial = $3,
        orden = $4
    WHERE id = $5
    `,
    sesReqData:  ["uid", "ses"],
    postReqData: ["docid", "text", "comment", "serial", "id", "order"],
    sqlParams:   [
        rpg.param("post", "text"), rpg.param("post", "comment"), rpg.param("post", "serial"),
        rpg.param("post", "order"), rpg.param("post", "id")
    ]
}));


router.post("/pauta-editable", rpg.singleSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT status = 1 AS editable
    FROM sessions
    WHERE id = $1
    `,
    sesReqData: ["uid", "ses"],
    sqlParams:  [rpg.param("ses","ses")]
}));


router.post("/get-ideas", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT i.id,
        i.content,
        i.descr,
        i.serial,
        i.docid,
        i.orden
    FROM ideas AS i
    INNER JOIN documents AS d
    ON i.docid = d.id
    WHERE i.uid = $1
        AND d.sesid = $2
        AND i.iteration = $3
    ORDER BY i.orden ASC
    `,
    sesReqData:  ["uid", "ses"],
    postReqData: ["iteration"],
    sqlParams:   [rpg.param("ses", "uid"), rpg.param("ses", "ses"), rpg.param("post", "iteration")]
}));


router.post("/set-ideas-orden", (req, res) => {
    res.header("Content-type", "application/json");
    let uid = req.session.uid;
    let ses = req.session.ses;
    if (uid == null || ses == null || req.body.orden == null) {
        res.end('{"status":"err"}');
        return;
    }
    req.body.orden.forEach((ideaId, i) => {
        if (!isNaN(ideaId)) {
            rpg.execSQL({
                dbcon: pass.dbcon,
                sql:   `
                UPDATE ideas
                SET orden = ${i}
                WHERE id = ${ideaId}
                `,
                onEnd: () => {}
            })(req, res);
        }
    });
    res.end('{"status":"ok"}');
});


router.post("/change-state-session", rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    WITH rows AS (
        UPDATE sessions
        SET status = status + 1
        WHERE id = $1
        RETURNING id, status
    )
    INSERT INTO status_record(sesid, status, stime)
    SELECT id,
        status,
        now()
    FROM rows
    `,
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post", "sesid")],
    onEnd:       (req,res) => {
        if (req.body.sesid != null && sesStatusCache[req.body.sesid] != null)
            sesStatusCache[req.body.sesid] += 1;
        res.send('{"status":"ok"}');
        socket.stateChange(req.body.sesid);
    }
}));


router.post("/force-state-session", rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    WITH rows AS (
        UPDATE sessions
        SET status = $1
        WHERE id = $2
        RETURNING id, status
    )
    INSERT INTO status_record(sesid, status, stime)
    SELECT id,
        status,
        now()
    FROM rows
    `,
    postReqData: ["sesid", "state"],
    sqlParams:   [rpg.param("post", "state"), rpg.param("post", "sesid")],
    onEnd:       (req,res) => {
        if (req.body.sesid != null && sesStatusCache[req.body.sesid] != null)
            sesStatusCache[req.body.sesid] = req.body.state;
        res.send('{"status":"ok"}');
        socket.stateChange(req.body.sesid);
    }
}));


router.post("/record-finish", rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    WITH rows AS (
        UPDATE finish_session
        SET stime = now()
        WHERE UID = $1
            AND sesid = $2
            AND status = $3
            RETURNING 1
    )
    INSERT INTO finish_session(UID, sesid, status, stime)
    SELECT $4,
        $5,
        $6,
        now()
    WHERE 1 not in (
        SELECT *
        FROM rows
    )
    `,
    sesReqData:  ["uid","ses"],
    postReqData: ["status"],
    sqlParams:   [
        rpg.param("ses", "uid"), rpg.param("ses", "ses"), rpg.param("post", "status"),
        rpg.param("ses", "uid"), rpg.param("ses", "ses"), rpg.param("post", "status")
    ]
}));


router.post("/get-finished", rpg.singleSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT $1 in (
        SELECT UID
        FROM finish_session
        WHERE sesid = $2
            AND status = $3
    ) AS finished
    `,
    sesReqData: ["ses","uid"],
    sqlParams:  [rpg.param("ses","uid"),rpg.param("ses","ses"),rpg.param("post","status")]
}));


router.post("/delete-idea", rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    DELETE
    FROM ideas
    WHERE UID = $1
    AND id = $2
    `,
    sesReqData:  ["uid"],
    postReqData: ["id"],
    sqlParams:   [rpg.param("ses", "uid"), rpg.param("post", "id")]
}));


router.post("/get-chat-data-csv", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT c.id,
        d.orden AS df,
        d.title,
        d.tleft AS opt_left,
        d.tright AS opt_right,
        u.id AS user_id,
        u.name,
        t.id AS team,
        c.content AS message,
        c.stime AS TIME,
        c.parent_id AS reply_to
    FROM differential AS d,
        differential_chat AS c,
        users AS u,
        teams AS t,
        teamusers AS tu
    WHERE c.did = d.id
        AND d.sesid = $1
        AND u.id = c.uid
        AND t.sesid = $2
        AND tu.tmid = t.id
        AND tu.uid = u.id
    ORDER BY t.id, c.stime
    `,
    onStart: (ses) => {
        if (ses.role != "P") {
            console.error("Sólo profesor puede ver datos de sesiones.");
            return "SELECT $1, $2";
        }
    },
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post", "sesid"), rpg.param("post", "sesid")]
}));


router.post("/get-sel-data-csv", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT s.id,
        d.orden AS df,
        d.title,
        d.tleft AS opt_left,
        d.tright AS opt_right,
        u.id AS user_id,
        u.name,
        t.id AS team,
        s.sel,
        s.comment,
        s.stime AS TIME,
        s.iteration
    FROM differential AS d,
        differential_selection AS s,
        users AS u,
        teams AS t,
        teamusers AS tu
    WHERE s.did = d.id
        AND d.sesid = $1
        AND u.id = s.uid
        AND t.sesid = $2
        AND tu.tmid = t.id
        AND tu.uid = u.id
    ORDER BY s.iteration, s.stime
    `,
    onStart: (ses) => {
        if (ses.role != "P") {
            console.error("Sólo profesor puede ver datos de sesiones.");
            return "SELECT $1, $2";
        }
    },
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post", "sesid"), rpg.param("post", "sesid")]
}));


router.post("/get-sel-data-csv-ethics", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT DISTINCT s.id,
        u.id AS user_id,
        r.tmid AS team_id,
        u."name",
        u.rut,
        u.sex AS "gender",
        a.orden AS "df",
        a.title,
        a.tleft AS "opt_left",
        a.tright AS "opt_right",
        a.num AS "max_num",
        s.sel AS "sel",
        s."comment" AS "comment",
        st."number" AS "phase",
        s.stime AS "time"
    FROM differential_selection AS s
    INNER JOIN differential AS a
    ON a.id = s.did
    INNER JOIN stages AS st
    ON st.id = a.stageid
    INNER JOIN users AS u
    ON u.id = s.uid
    INNER JOIN sessions AS ses
    ON ses.id = st.sesid
    LEFT JOIN (
        SELECT *
        FROM teams AS t
        INNER JOIN teamusers AS tu
        ON t.id = tu.tmid
    ) AS r
    ON r.stageid = st.id
        AND r.uid = u.id
    WHERE ses.id = $1
    ORDER BY st."number", s.stime
    `,
    onStart: (ses) => {
        if (ses.role != "P") {
            console.error("Sólo profesor puede ver datos de sesiones.");
            return "SELECT $1, $2";
        }
    },
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post", "sesid")]
}));


router.post("/get-chat-data-csv-ethics", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT DISTINCT s.id,
        u.id AS user_id,
        r.tmid AS team_id,
        u."name",
        u.rut,
        u.sex AS "gender",
        a.orden AS "df",
        a.title,
        a.tleft AS "opt_left",
        a.tright AS "opt_right",
        s."content" AS "message",
        st."number" AS "phase",
        s.stime AS "time",
        s.parent_id AS "reply_to"
    FROM differential_chat AS s
    INNER JOIN differential AS a
    ON a.id = s.did
    INNER JOIN stages AS st
    ON st.id = a.stageid
    INNER JOIN users AS u
    ON u.id = s.uid
    INNER JOIN sessions AS ses
    ON ses.id = st.sesid
    LEFT JOIN (
        SELECT *
        FROM teams AS t
        INNER JOIN teamusers AS tu
        ON t.id = tu.tmid
    ) AS r
    ON r.stageid = st.id
        AND r.uid = u.id
    WHERE ses.id = $1
    ORDER BY st."number", s.stime
    `,
    onStart: (ses) => {
        if (ses.role != "P") {
            console.error("Sólo profesor puede ver datos de sesiones.");
            return "SELECT $1, $2";
        }
    },
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post", "sesid")]
}));


router.post("/get-sel-data-csv-role", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT DISTINCT s.id,
        u.id AS user_id,
        r.tmid AS team_id,
        u."name",
        u.rut,
        u.sex AS "gender",
        a."name" AS action,
        s.orden AS "rank",
        s.description AS "comment",
        st."number" AS "phase",
        s.stime
    FROM actor_selection AS s
    INNER JOIN actors AS a
    ON a.id = s.actorid
    INNER JOIN stages AS st
    ON st.id = a.stageid
    INNER JOIN users AS u
    ON u.id = s.uid
    INNER JOIN sessions AS ses
    ON ses.id = st.sesid
    LEFT JOIN (
        SELECT *
        FROM teams AS t
        INNER JOIN teamusers AS tu
        ON t.id = tu.tmid
    ) AS r
    ON r.stageid = st.id
        AND r.uid = u.id
    WHERE ses.id = $1
    ORDER BY st."number", s.stime
    `,
    onStart: (ses) => {
        if (ses.role != "P") {
            console.error("Sólo profesor puede ver datos de sesiones.");
            return "SELECT $1, $2";
        }
    },
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post", "sesid")]
}));


router.post("/get-chat-data-csv-role", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT DISTINCT s.id,
        u.id AS user_id,
        r.tmid AS team_id,
        u."name",
        u.rut,
        u.sex AS "gender",
        s."content" AS "message",
        st."number" AS "phase",
        s.stime AS "time",
        s.parent_id AS "reply_to"
    FROM chat AS s
    INNER JOIN stages AS st
    ON st.id = s.stageid
    INNER JOIN users AS u
    ON u.id = s.uid
    INNER JOIN sessions AS ses
    ON ses.id = st.sesid
    LEFT JOIN (
        SELECT *
        FROM teams AS t
        INNER JOIN teamusers AS tu
        ON t.id = tu.tmid
    ) AS r
    ON r.stageid = st.id
        AND r.uid = u.id
    WHERE ses.id = $1
    ORDER BY st."number", s.stime
    `,
    onStart: (ses) => {
        if (ses.role != "P") {
            console.error("Sólo profesor puede ver datos de sesiones.");
            return "SELECT $1, $2";
        }
    },
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post", "sesid")]
}));


router.post("/get-sel-data-csv-jigsaw", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT DISTINCT s.id,
        u.id AS user_id,
        r.tmid AS team_id,
        u."name",
        u.rut,
        u.sex AS "gender",
        j."name" AS "role",
        a."name" AS action,
        s.orden AS "rank",
        s.description AS "comment",
        st."number" AS "phase",
        s.stime
    FROM actor_selection AS s
    INNER JOIN actors AS a
    ON a.id = s.actorid
    INNER JOIN stages AS st
    ON st.id = a.stageid
    INNER JOIN users AS u
    ON u.id = s.uid
    INNER JOIN sessions AS ses
    ON ses.id = st.sesid
    INNER JOIN jigsaw_users AS ju
    ON u.id = ju.userid
    INNER JOIN jigsaw_role AS j
    ON j.id = ju.roleid
    LEFT JOIN (
        SELECT *
        FROM teams AS t
        INNER JOIN teamusers AS tu
        ON t.id = tu.tmid
    ) AS r
    ON r.stageid = st.id
        AND r.uid = u.id
    WHERE ses.id = $1
    ORDER BY st."number", s.stime
    `,
    onStart: (ses) => {
        if (ses.role != "P") {
            console.error("Sólo profesor puede ver datos de sesiones.");
            return "SELECT $1, $2";
        }
    },
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post", "sesid")]
}));


router.post("/get-chat-data-csv-jigsaw", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT DISTINCT s.id,
        u.id AS user_id,
        r.tmid AS team_id,
        u."name",
        u.rut,
        u.sex AS "gender",
        j."name" AS "role",
        s."content" AS "message",
        st."number" AS "phase",
        s.stime AS "time",
        s.parent_id AS "reply_to"
    FROM chat AS s
    INNER JOIN stages AS st
    ON st.id=s.stageid
    INNER JOIN users AS u
    ON u.id=s.uid
    INNER JOIN sessions AS ses
    ON ses.id=st.sesid
    INNER JOIN jigsaw_users AS ju
    ON u.id=ju.userid
    INNER JOIN jigsaw_role AS j
    ON j.id=ju.roleid
    LEFT JOIN (
        SELECT *
        FROM teams AS t
        INNER JOIN teamusers AS tu
        ON t.id = tu.tmid
    ) AS r
    ON r.stageid = st.id
        AND r.uid = u.id
    WHERE ses.id = $1
    ORDER BY st."number", s.stime
    `,
    onStart: (ses) => {
        if (ses.role != "P") {
            console.error("Sólo profesor puede ver datos de sesiones.");
            return "select $1, $2";
        }
    },
    postReqData: ["sesid"],
    sqlParams:   [rpg.param("post", "sesid")]
}));


module.exports = router;
