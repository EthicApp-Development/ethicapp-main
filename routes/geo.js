"use strict";

let express = require('express');
let router = express.Router();
let rpg = require("../modules/rest-pg");
let pass = require("../modules/passwords");
let socket = require("../modules/socket.config");

router.post("/list-default-overlay", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select id, name, description, iteration, geom, type, uid from overlays where qid = $1 and iteration = 0",
    postReqData: ["qid"],
    sesReqData: ["uid"],
    sqlParams: [rpg.param("post", "qid")]
}));

router.post("/list-overlay", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select id, name, description, iteration, geom, type, uid from overlays where qid = $1 and uid = $2 and iteration <= $3",
    postReqData: ["qid", "iteration"],
    sesReqData: ["uid"],
    sqlParams: [rpg.param("post", "qid"), rpg.param("ses","uid"), rpg.param("post","iteration")]
}));

router.post("/list-team-overlay", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select id, name, description, iteration, geom, type, uid from overlays where qid = $1 and uid = $2 and iteration <= $3",
    postReqData: ["qid", "iteration", "uid"],
    sesReqData: ["uid"],
    sqlParams: [rpg.param("post", "qid"), rpg.param("post","uid"), rpg.param("post","iteration")]
}));

router.post("/add-overlay", rpg.singleSQL({
    dbcon: pass.dbcon,
    sql: "insert into overlays(name, iteration, geom, type, description, qid, uid) values " +
        "($1, $2, $3, $4, $5, $6, $7) returning id",
    postReqData: ["name", "iteration", "geom", "type", "qid"],
    sesReqData: ["uid"],
    sqlParams: rpg.paramsOfType("post", ["name", "iteration", "geom", "type", "description", "qid"]).concat(
        rpg.paramsOfType("ses", ["uid"])),
    onEnd: (req, res, resp) => {
        if(req.body.iteration == 3)
            socket.updateOverlay(req.body.qid);
        resp["status"] = "ok";
        res.send(JSON.stringify(resp));
    }
}));

module.exports = router;
