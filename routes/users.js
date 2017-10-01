"use strict";

let express = require('express');
let router = express.Router();
let rpg = require("../modules/rest-pg");
let pass = require("../modules/passwords");
let crypto = require("crypto");

router.get('/login', (req, res) => {
    res.render('login');
});

router.get("/logout", (req, res) => {
    req.session.uid = null;
    req.session.role = null;
    req.session.ses = null;
    res.redirect("login");
});

router.post("/login", rpg.singleSQL({
    dbcon: pass.dbcon,
    sql: "select id, role from users where (rut = $1 and pass = $2) or (mail = $3 and pass=$4)",
    postReqData: ["user", "pass"],
    onStart: (ses, data, calc) => {
        calc.passcr = crypto.createHash('md5').update(data.pass).digest('hex');
        //console.log(calc.passcr);
    },
    sqlParams: [rpg.param("post","user"),rpg.param("calc","passcr"),rpg.param("post","user"),rpg.param("calc","passcr")],
    onEnd: (req, res, result) => {
        if(result.id != null) {
            req.session.uid = result.id;
            req.session.role = result.role;
            req.session.ses = null;
        }
        res.redirect(".");
    }
}));

router.get("/register", (req, res) => {
    res.render("register");
});

router.post("/register", rpg.execSQL({
    dbcon: pass.dbcon,
    sql: "insert into users(rut, pass, name, mail, sex, role) values ($1,$2,$3,$4,$5,'A')",
    postReqData: ["name", "rut", "pass", "mail", "sex"],
    onStart: (ses, data, calc) => {
        if (data.pass.length < 5) return "select $1, $2, $3, $4, $5";
        calc.passcr = crypto.createHash('md5').update(data.pass).digest('hex');
        calc.fullname = (data.name + " " + data.lastname);
    },
    sqlParams: [rpg.param("post", "rut"), rpg.param("calc", "passcr"), rpg.param("calc", "fullname"),
        rpg.param("post", "mail"), rpg.param("post", "sex")],
    onEnd: (req, res) => {
        res.redirect(".");
    }
}));

router.post("/register-prof", rpg.execSQL({
    dbcon: pass.dbcon,
    sql: "insert into users(rut, pass, name, mail, sex, role) values ($1,$2,$3,$4,$5,'P')",
    postReqData: ["name", "rut", "pass", "mail", "sex"],
    onStart: (ses, data, calc) => {
        if (ses.role == "S" || data.pass.length < 5) return "select $1, $2, $3, $4, $5";
        calc.passcr = crypto.createHash('md5').update(data.pass).digest('hex');
        calc.fullname = (data.name + " " + data.lastname);
    },
    sqlParams: [rpg.param("post", "rut"), rpg.param("calc", "passcr"), rpg.param("calc", "fullname"),
        rpg.param("post", "mail"), rpg.param("post", "sex")],
    onEnd: (req, res) => {
        res.redirect(".");
    }
}));

module.exports = router;
