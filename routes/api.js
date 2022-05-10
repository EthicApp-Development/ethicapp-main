"use strict";

let express = require('express');
let router = express.Router();
let rpg = require("../modules/rest-pg");
let pass = require("../modules/passwords");


let sesStatusCache = {};



router.get("/selection", (req, res) => { 
    rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select * from differential_selection where did = " + req.query.did ,
    onEnd: (req,res, result) => {
        console.log(req.query);
        res.send(result);
    }
})(req, res)});

router.get("/chat", (req, res) => { 
    rpg.multiSQL({
    dbcon: pass.dbcon,
    sql: "select * from differential_chat where did = " + req.query.did ,
    onEnd: (req,res, result) => {
        console.log(req.query);
        res.send(result);
    }
})(req, res)});







module.exports = router;