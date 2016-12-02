"use strict";

let express = require('express');
let router = express.Router();
let rpg = require("../modules/rest-pg");
let pass = require("../modules/passwords");

router.get("/to-visor", (req, res) => {
    if (req.session.uid) {
        req.session.ses = req.query.sesid;
        res.redirect("visor");
    }
    else
        res.redirect(".");
});

router.get("/visor", (req,res) => {
    if(req.session.uid && req.session.ses)
        res.render("visor");
    else
        res.redirect(".");
});

module.exports = router;