"use strict";

let express = require('express');
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
                sql: "select status from sessions where id = " + req.query.sesid,
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
                sql: "select status from sessions where id = " + req.query.sesid,
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
                sql: "select status from sessions where id = " + req.query.sesid,
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
    sql: "select id, title, path from documents where sesid = $1 and active = true",
    sesReqData: ["uid", "ses"],
    sqlParams: [rpg.param("ses", "ses")]
}));

router.post("/delete-document", rpg.execSQL({
    dbcon: pass.dbcon,
    sql: "update documents set active = false where id = $1",
    postReqData: ["docid"],
    sqlParams: [rpg.param("post", "docid")]
}));

router.post("/get-questions", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select q.id, q.content, q.options, qt.content as text_content, q.plugin_data from questions as q left outer join question_text as qt on " +
        "q.textid = qt.id where q.sesid = $1 order by q.id asc",
    sesReqData: ["uid", "ses"],
    sqlParams: [rpg.param("ses", "ses")]
}));

router.post("/get-anskey", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select id, comment, answer from questions where sesid = $1",
    sesReqData: ["uid", "ses"],
    sqlParams: [rpg.param("ses", "ses")]
}));

router.post("/send-answer", rpg.execSQL({
    dbcon: pass.dbcon,
    sql: "with rows as (update selection set answer = $1, comment = $2, stime = now(), confidence = $3 where qid = $4 and uid = $5 and iteration = $6 returning 1) " +
    "insert into selection(uid,qid,answer,comment,iteration,confidence,stime) select $7,$8,$9,$10,$11,$12, now() where 1 not in (select * from rows)",
    /*sql: "insert into selection(uid,qid,answer,comment) values ($1,$2,$3,$4) on conflict (uid,qid) do update " +
     "set answer = excluded.answer, comment = excluded.comment",*/
    sesReqData: ["uid", "ses"],
    postReqData: ["qid", "answer", "comment", "iteration"],
    sqlParams: [rpg.param("post", "answer"), rpg.param("post", "comment"), rpg.param("post", "confidence"), rpg.param("post", "qid"), rpg.param("ses", "uid"), rpg.param("post", "iteration"),
        rpg.param("ses", "uid"), rpg.param("post", "qid"), rpg.param("post", "answer"), rpg.param("post", "comment"), rpg.param("post", "iteration"), rpg.param("post", "confidence")]
}));

router.post("/get-answers", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select s.qid, s.answer, s.comment, s.confidence from selection as s inner join questions as q on q.id = s.qid " +
    "where q.sesid = $1 and s.uid = $2 and s.iteration = $3",
    sesReqData: ["uid", "ses"],
    postReqData: ["iteration"],
    sqlParams: [rpg.param("ses", "ses"), rpg.param("ses", "uid"), rpg.param("post","iteration")]
}));

router.post("/send-diff-selection", rpg.execSQL({
    dbcon: pass.dbcon,
    sql: "with rows as (update differential_selection set sel = $1, comment = $2, stime = now() where did = $3 and uid = $4 and iteration = $5 returning 1) " +
        "insert into differential_selection(uid,did,sel,comment,iteration,stime) select $6,$7,$8,$9,$10, now() where 1 not in (select * from rows)",
    /*sql: "insert into selection(uid,qid,answer,comment) values ($1,$2,$3,$4) on conflict (uid,qid) do update " +
     "set answer = excluded.answer, comment = excluded.comment",*/
    sesReqData: ["uid", "ses"],
    postReqData: ["did", "sel", "comment", "iteration"],
    sqlParams: [rpg.param("post", "sel"), rpg.param("post", "comment"), rpg.param("post", "did"), rpg.param("ses", "uid"), rpg.param("post", "iteration"),
        rpg.param("ses", "uid"), rpg.param("post", "did"), rpg.param("post", "sel"), rpg.param("post", "comment"), rpg.param("post", "iteration")]
}));

router.post("/get-diff-selection", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select s.did, s.sel, s.comment from differential_selection as s inner join differential as d on d.id = s.did " +
        "where d.sesid = $1 and s.uid = $2 and s.iteration = $3",
    sesReqData: ["uid", "ses"],
    postReqData: ["iteration"],
    sqlParams: [rpg.param("ses", "ses"), rpg.param("ses", "uid"), rpg.param("post","iteration")]
}));

router.post("/get-diff-selection-stage", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select s.did, s.sel, s.comment from differential_selection as s inner join differential as d on d.id = s.did " +
        "where d.stageid = $1 and s.uid = $2",
    sesReqData: ["uid", "ses"],
    postReqData: ["stageid"],
    sqlParams: [rpg.param("post", "stageid"), rpg.param("ses", "uid")]
}));

router.post("/get-chat-msgs", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select s.id, s.did, s.uid, s.content, s.stime, s.parent_id from differential_chat as s inner join differential as d on d.id = s.did " +
        "where d.sesid = $1 and s.uid in (select tu.uid from teamusers as tu where tu.tmid = (select t.id from teamusers " +
        "as tu, teams as t where t.sesid = $2 and tu.tmid = t.id and tu.uid = $3)) order by s.stime asc",
    sesReqData: ["uid", "ses"],
    sqlParams: [rpg.param("ses", "ses"), rpg.param("ses", "ses"), rpg.param("ses","uid")]
}));

router.post("/get-chat-stage", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select s.id, s.uid, s.content, s.stime, s.parent_id, s.stageid from chat as s where " +
        "s.stageid = $1 and s.uid in (select tu.uid from teamusers as tu where tu.tmid = (select t.id from teamusers " +
        "as tu, teams as t where t.stageid = $2 and tu.tmid = t.id and tu.uid = $3)) order by s.stime asc",
    sesReqData: ["uid", "ses"],
    postReqData: ["stageid"],
    sqlParams: [rpg.param("post", "stageid"), rpg.param("post","stageid"), rpg.param("ses", "uid")]
}));

router.post("/get-diff-chat-stage", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select s.id, s.did, s.uid, s.content, s.stime, s.parent_id from differential_chat as s inner join differential as d on d.id = s.did " +
        "where d.stageid = $1 and s.uid in (select tu.uid from teamusers as tu where tu.tmid = (select t.id from teamusers " +
        "as tu, teams as t where t.stageid = $2 and tu.tmid = t.id and tu.uid = $3)) order by s.stime asc",
    sesReqData: ["uid", "ses"],
    postReqData: ["stageid"],
    sqlParams: [rpg.param("post", "stageid"), rpg.param("post","stageid"), rpg.param("ses", "uid")]
}));

router.post("/get-team-chat", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select s.id, s.did, s.uid, s.content, s.stime, s.parent_id from differential_chat as s inner join differential as d on d.id = s.did " +
        "where d.sesid = $1 and s.uid in (select tu.uid from teamusers as tu where tu.tmid = $2) and d.orden = $3 order by s.stime asc",
    postReqData: ["sesid", "tmid", "orden"],
    sqlParams: [rpg.param("post", "sesid"), rpg.param("post","tmid"), rpg.param("post","orden")]
}));

router.post("/get-team-chat-stage-df", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select s.id, s.did, s.uid, s.content, s.stime, s.parent_id from differential_chat as s inner join differential as d on d.id = s.did " +
        "where d.stageid = $1 and s.uid in (select tu.uid from teamusers as tu where tu.tmid = $2) and d.id = $3 order by s.stime asc",
    postReqData: ["stageid", "tmid", "did"],
    sqlParams: [rpg.param("post", "stageid"), rpg.param("post","tmid"), rpg.param("post","did")]
}));

router.post("/get-team-chat-stage", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select s.id, s.uid, s.content, s.stime, s.parent_id from chat as s " +
        "where s.stageid = $1 and s.uid in (select tu.uid from teamusers as tu where tu.tmid = $2) order by s.stime asc",
    postReqData: ["stageid", "tmid"],
    sqlParams: [rpg.param("post", "stageid"), rpg.param("post","tmid")]
}));

router.post("/add-chat-msg", rpg.execSQL({
    dbcon: pass.dbcon,
    sql: "insert into differential_chat(uid,did,content,parent_id) values ($1,$2,$3,$4)",
    sesReqData: ["uid", "ses"],
    postReqData: ["did", "content", "tmid"],
    sqlParams: [rpg.param("ses", "uid"), rpg.param("post", "did"), rpg.param("post","content"), rpg.param("post","parent_id")],
    onEnd: (req,res) => {
        socket.chatMsg(req.session.ses, req.body.tmid);
    }
}));

router.post("/add-chat-msg-stage", rpg.execSQL({
    dbcon: pass.dbcon,
    sql: "insert into chat(uid, stageid, content, parent_id) values ($1,$2,$3,$4)",
    sesReqData: ["uid", "ses"],
    postReqData: ["stageid", "content", "tmid"],
    sqlParams: [rpg.param("ses", "uid"), rpg.param("post", "stageid"), rpg.param("post","content"), rpg.param("post","parent_id")],
    onEnd: (req,res) => {
        socket.chatMsgStage(req.body.stageid, req.body.tmid);
    }
}));

router.post("/send-idea", rpg.singleSQL({
    dbcon: pass.dbcon,
    sql: "insert into ideas(content,descr,serial,docid,uid,iteration,stime) values ($1,$2,$3,$4,$5,$6,now()) returning id",
    sesReqData: ["uid", "ses"],
    postReqData: ["docid", "text", "comment", "serial", "iteration"],
    sqlParams: [rpg.param("post", "text"), rpg.param("post", "comment"), rpg.param("post", "serial"), rpg.param("post", "docid"), rpg.param("ses", "uid"), rpg.param("post", "iteration")]
}));

router.post("/send-team-idea", rpg.singleSQL({
    dbcon: pass.dbcon,
    sql: "insert into ideas(content,descr,serial,docid,uid,iteration,stime) values ($1,$2,$3,$4,$5,$6,now()) returning id",
    sesReqData: ["uid", "ses"],
    postReqData: ["docid", "text", "comment", "serial", "iteration", "uidoriginal"],
    sqlParams: [rpg.param("post", "text"), rpg.param("post", "comment"), rpg.param("post", "serial"), rpg.param("post", "docid"), rpg.param("post", "uidoriginal"), rpg.param("post", "iteration")]
}));

router.post("/send-pauta-idea", rpg.singleSQL({
    dbcon: pass.dbcon,
    sql: "insert into ideas(content,descr,serial,docid,uid,iteration,orden) values ($1,$2,$3,$4,$5,$6,$7) returning id",
    sesReqData: ["uid", "ses"],
    postReqData: ["docid", "text", "comment", "serial", "iteration", "order"],
    sqlParams: [rpg.param("post", "text"), rpg.param("post", "comment"), rpg.param("post", "serial"), rpg.param("post", "docid"), rpg.param("ses", "uid"), rpg.param("post", "iteration"), rpg.param("post", "order")]
}));

router.post("/update-idea", rpg.execSQL({
    dbcon: pass.dbcon,
    sql: "update ideas set content = $1, descr = $2, serial = $3, stime = now() where id = $4",
    sesReqData: ["uid", "ses"],
    postReqData: ["docid", "text", "comment", "serial", "id"],
    sqlParams: [rpg.param("post", "text"), rpg.param("post", "comment"), rpg.param("post", "serial"), rpg.param("post", "id")]
}));

router.post("/update-pauta-idea", rpg.execSQL({
    dbcon: pass.dbcon,
    sql: "update ideas set content = $1, descr = $2, serial = $3, orden = $4 where id = $5",
    sesReqData: ["uid", "ses"],
    postReqData: ["docid", "text", "comment", "serial", "id", "order"],
    sqlParams: [rpg.param("post", "text"), rpg.param("post", "comment"), rpg.param("post", "serial"), rpg.param("post", "order"), rpg.param("post", "id")]
}));

router.post("/pauta-editable", rpg.singleSQL({
    dbcon: pass.dbcon,
    sql: "select status = 1 as editable from sessions where id = $1",
    sesReqData: ["uid", "ses"],
    sqlParams: [rpg.param("ses","ses")]
}));

router.post("/get-ideas", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select i.id, i.content, i.descr, i.serial, i.docid, i.orden from ideas as i inner join documents as d on i.docid = d.id where " +
    "i.uid = $1 and d.sesid = $2 and i.iteration = $3 order by i.orden asc",
    sesReqData: ["uid", "ses"],
    postReqData: ["iteration"],
    sqlParams: [rpg.param("ses", "uid"), rpg.param("ses", "ses"), rpg.param("post", "iteration")]
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
                sql: "update ideas set orden = " + i + " where id = " + ideaId,
                onEnd: () => {}
            })(req, res);
        }
    });
    res.end('{"status":"ok"}');
});

router.post("/change-state-session", rpg.execSQL({
    dbcon: pass.dbcon,
    sql: "with rows as (update sessions set status = status + 1 where id = $1 returning id, status) insert into " +
            "status_record(sesid,status,stime) select id, status, now() from rows",
    postReqData: ["sesid"],
    sqlParams: [rpg.param("post", "sesid")],
    onEnd: (req,res) => {
        if(req.body.sesid != null && sesStatusCache[req.body.sesid] != null)
            sesStatusCache[req.body.sesid] += 1;
        res.send('{"status":"ok"}');
        socket.stateChange(req.body.sesid);
    }
}));

router.post("/force-state-session", rpg.execSQL({
    dbcon: pass.dbcon,
    sql: "with rows as (update sessions set status = $1 where id = $2 returning id, status) insert into " +
    "status_record(sesid,status,stime) select id, status, now() from rows",
    postReqData: ["sesid", "state"],
    sqlParams: [rpg.param("post", "state"), rpg.param("post", "sesid")],
    onEnd: (req,res) => {
        if(req.body.sesid != null && sesStatusCache[req.body.sesid] != null)
            sesStatusCache[req.body.sesid] = req.body.state;
        res.send('{"status":"ok"}');
        socket.stateChange(req.body.sesid);
    }
}));

router.post("/record-finish", rpg.execSQL({
    dbcon: pass.dbcon,
    sql: "with rows as (update finish_session set stime = now() where uid = $1 and sesid = $2 and status = $3 returning 1) " +
        "insert into finish_session(uid,sesid,status,stime) select $4,$5,$6,now() where 1 not in (select * from rows)",
    sesReqData: ["uid","ses"],
    postReqData: ["status"],
    sqlParams: [rpg.param("ses", "uid"),rpg.param("ses", "ses"),rpg.param("post", "status"),rpg.param("ses", "uid"),rpg.param("ses", "ses"),rpg.param("post", "status")]
}));

router.post("/get-finished", rpg.singleSQL({
    dbcon: pass.dbcon,
    sql: "select $1 in (select uid from finish_session where sesid = $2 and status = $3) as finished",
    sesReqData: ["ses","uid"],
    sqlParams: [rpg.param("ses","uid"),rpg.param("ses","ses"),rpg.param("post","status")]
}));

router.post("/delete-idea", rpg.execSQL({
    dbcon: pass.dbcon,
    sql: "delete from ideas where uid = $1 and id = $2",
    sesReqData: ["uid"],
    postReqData: ["id"],
    sqlParams: [rpg.param("ses", "uid"), rpg.param("post", "id")]
}));

router.post("/get-chat-data-csv", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select c.id, d.orden as df, d.title, d.tleft as opt_left, d.tright as opt_right, u.id as user_id, u.name, " +
        "t.id as team, c.content as message, c.stime as time, c.parent_id as reply_to from differential as d, " +
        "differential_chat as c, users as u, teams as t, teamusers as tu where c.did = d.id and d.sesid = $1 and " +
        "u.id = c.uid and t.sesid = $2 and tu.tmid = t.id and tu.uid = u.id order by t.id, c.stime",
    onStart: (ses, data, calc) => {
        if (ses.role != "P") {
            console.log("ERR: Solo profesor puede ver datos de sesiones.");
            return "select $1, $2";
        }
    },
    postReqData: ["sesid"],
    sqlParams: [rpg.param("post", "sesid"), rpg.param("post", "sesid")]
}));

router.post("/get-sel-data-csv", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select s.id, d.orden as df, d.title, d.tleft as opt_left, d.tright as opt_right, u.id as user_id, u.name, " +
        "t.id as team, s.sel, s.comment, s.stime as time, s.iteration from differential as d, differential_selection " +
        "as s, users as u, teams as t, teamusers as tu where s.did = d.id and d.sesid = $1 and u.id = s.uid and " +
        "t.sesid = $2 and tu.tmid = t.id and tu.uid = u.id order by s.iteration, s.stime",
    onStart: (ses, data, calc) => {
        if (ses.role != "P") {
            console.log("ERR: Solo profesor puede ver datos de sesiones.");
            return "select $1, $2";
        }
    },
    postReqData: ["sesid"],
    sqlParams: [rpg.param("post", "sesid"), rpg.param("post", "sesid")]
}));

module.exports = router;
