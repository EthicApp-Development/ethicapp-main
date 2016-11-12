"use strict";

let express = require('express');
let router = express.Router();

router.get('/login', (req, res) => {
    res.render('login');
});

router.post("/login", (req, res) => {
    console.log(req.body);
    res.redirect(".");
});

router.get("/register", (req, res) => {
    res.render("register");
});

module.exports = router;
