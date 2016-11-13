"use strict";

let express = require('express');
let router = express.Router();
let rpg = require("../modules/rest-pg");
let pass = require("../modules/passwords");

router.get("/seslist", (req, res) => {
    res.render("seslist");
});

router.post("/get-session-list",rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select s.id, s.name, s.descr from sessions as s, sesusers as su where su.uid = $1 and su.sesid = s.id",
    sqlParams: [rpg.param("ses","uid")]
}));

module.exports = router;