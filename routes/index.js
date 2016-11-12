"use strict";

let express = require('express');
let router = express.Router();

router.get('/', (req, res) => {
    if(req.session.uid){
        if(req.session.ses)
            res.redirect("");
        else
            res.redirect("seslist");
    }
    else
        res.redirect("login");
});

router.get("/seslist", (req, res) => {
    res.end("Registrado con el usuario " + req.session.uid);
});

module.exports = router;
