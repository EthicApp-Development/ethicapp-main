"use strict";

let express = require('express');
let router = express.Router();
let rpg = require("../modules/rest-pg");
let pass = require("../modules/passwords");
let crypto = require("crypto");

router.get('/login', (req, res) => {
    res.render('login', {rc: req.query.rc});
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
        calc.user = data.user.trim();
        calc.passcr = crypto.createHash('md5').update(data.pass).digest('hex');
        //console.log(calc.passcr);
    },
    sqlParams: [rpg.param("calc","user"),rpg.param("calc","passcr"),rpg.param("calc","user"),rpg.param("calc","passcr")],
    onEnd: (req, res, result) => {
        if(result.id != null) {
            req.session.uid = result.id;
            req.session.role = result.role;
            req.session.ses = null;
            res.redirect(".");
        }
        else{
            res.redirect("login?rc=2");
        }
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
        res.redirect("login?rc=1");
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
        res.redirect("login?rc=1");
    }
}));

router.post("/get-my-name", rpg.singleSQL({
    dbcon: pass.dbcon,
    sql: "select name, role, lang from users where id = $1",
    sesReqData: ["uid"],
    sqlParams: [rpg.param("ses", "uid")]
}));

router.post("/update-lang", rpg.singleSQL({
    dbcon: pass.dbcon,
    sql: "update users set lang = $1 where id = $2",
    sesReqData: ["uid"],
    postReqData: ["lang"],
    sqlParams: [rpg.param("post", "lang"), rpg.param("ses", "uid")]
}));

module.exports = router;
