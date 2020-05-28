"use strict";

let express = require('express');
let router = express.Router();
let rpg = require("../modules/rest-pg");
let pass = require("../modules/passwords");
let socket = require("../modules/socket.config");


router.post("/get-stages", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select id, number, type, anon, chat from stages where sesid = $1",
    sesReqData: ["uid", "ses"],
    sqlParams: [rpg.param("ses", "ses")]
}));

router.post("/get-admin-stages", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select id, number, type, anon, chat, prev_ans from stages where sesid = $1",
    postReqData: ["sesid"],
    sqlParams: [rpg.param("post", "sesid")]
}));

// router.post("/get-admin-stages", rpg.multiSQL({
//     dbcon: pass.dbcon,
//     sql: "select id, number, type, anon, chat, prev_ans from stages where sesid = $1",
//     postReqData: ["sesid"],
//     sqlParams: [rpg.param("post", "sesid")]
// }));

router.post("/add-stage", rpg.singleSQL({
    dbcon: pass.dbcon,
    sql: "insert into stages (number, type, anon, chat, sesid, prev_ans) values ($1, $2, $3, $4, $5, $6) returning id",
    postReqData: ["number", "type", "anon", "chat", "sesid"],
    sqlParams: [rpg.param("post", "number"), rpg.param("post", "type"), rpg.param("post", "anon"),
        rpg.param("post", "chat"), rpg.param("post", "sesid"), rpg.param("post", "prev_ans")]
}));

router.post("/add-actor", rpg.execSQL({
    dbcon: pass.dbcon,
    sql: "insert into actors (name, jorder, stageid) values ($1, $2, $3)",
    postReqData: ["name", "jorder", "stageid"],
    sqlParams: [rpg.param("post", "name"), rpg.param("post", "jorder"), rpg.param("post", "stageid")]
}));

router.post("/get-actors", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select id, name, jorder from actors where stageid = $1",
    postReqData: ["stageid"],
    sqlParams: [rpg.param("post", "stageid")]
}));

router.post("/get-my-actor-sel", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select id, description, orden, actorid from actor_selection where stageid = $1 and uid = $2",
    sesReqData: ["ses","uid"],
    postReqData: ["stageid"],
    sqlParams: [rpg.param("post", "stageid"), rpg.param("ses", "uid")]
}));

router.post("/get-my-actor-sel", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select id, description, orden, actorid from actor_selection where stageid = $1 and uid = $2",
    sesReqData: ["ses","uid"],
    postReqData: ["stageid"],
    sqlParams: [rpg.param("post", "stageid"), rpg.param("ses", "uid")]
}));

router.post("/session-start-stage", rpg.execSQL({
    dbcon: pass.dbcon,
    sql: "update sessions set status = 2, current_stage = $1 where id = $2",
    sesReqData: ["uid"],
    postReqData: ["stageid", "sesid"],
    sqlParams: [rpg.param("post", "stageid"), rpg.param("post", "sesid")],
    onEnd: (req,res) => {
        res.send('{"status":"ok"}');
        socket.stateChange(req.body.sesid);
    }
}));

router.post("/session-finish-stages", rpg.execSQL({
    dbcon: pass.dbcon,
    sql: "update sessions set status = 3, current_stage = null where id = $1",
    sesReqData: ["uid"],
    postReqData: ["sesid"],
    sqlParams: [rpg.param("post", "sesid")],
    onEnd: (req,res) => {
        res.send('{"status":"ok"}');
        socket.stateChange(req.body.sesid);
    }
}));

// router.post("/get-team-actor-sel",rpg.multiSQL({
//     dbcon: pass.dbcon,
//     sql: "select distinct s.sel, s.uid, s.did, s.comment from differential_selection as s, differential as d where d.sesid = $1 and s.did = d.id and " +
//         "s.uid in (select tu.uid from teamusers as tu where tu.tmid = (select t.id from teamusers as tu, teams as t where " +
//         "t.sesid = $2 and tu.tmid = t.id and tu.uid = $3)) and s.iteration = $4",
//     sesReqData: ["ses","uid"],
//     postReqData: ["iteration"],
//     sqlParams: [rpg.param("ses","ses"),rpg.param("ses","ses"),rpg.param("ses","uid"),rpg.param("post","iteration")]
// }));

module.exports = router;











