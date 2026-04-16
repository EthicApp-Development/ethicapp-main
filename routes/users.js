"use strict";

let express = require("express");
let router = express.Router();
let rpg = require("../modules/rest-pg");
let pass = require("../modules/passwords");

router.post("/get-my-name", rpg.singleSQL({
    dbcon:      pass.dbcon,
    sql:        "select name, role, lang from users where id = $1",
    sesReqData: ["uid"],
    sqlParams:  [rpg.param("ses", "uid")]
}));

router.post("/update-lang", rpg.singleSQL({
    dbcon:       pass.dbcon,
    sql:         "update users set lang = $1 where id = $2",
    sesReqData:  ["uid"],
    postReqData: ["lang"],
    sqlParams:   [rpg.param("post", "lang"), rpg.param("ses", "uid")]
}));

router.post("/super-login-as", (req, res) => {
    if(req.session.role != "S" || req.body.uid == null){
        res.send({status: "error"});
    }
    else {
        req.session.prevUid = req.session.uid;
        req.session.uid = req.body.uid;
        req.session.role = "P";
        req.session.ses = null;
        res.send({status: "ok"});
    }
});

router.get("/super-logout", (req, res) => {
    if(req.session.prevUid == null){
        res.end();
    }
    else {
        req.session.uid = req.session.prevUid;
        req.session.role = "S";
        req.session.ses = null;
        req.session.prevUid = null;
        res.redirect("/");
    }
});

router.get("/is-super", (req, res) => {
    if(req.session.role == "S" || req.session.prevUid != null){
        res.send({status: "ok"});
    }
    else {
        res.send({status: "error"});
    }
});

module.exports = router;
