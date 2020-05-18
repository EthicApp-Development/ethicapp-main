"use strict";

let express = require('express');
let router = express.Router();
let rpg = require("../modules/rest-pg");
let pass = require("../modules/passwords");
let crypto = require("crypto");
let mailer = require("nodemailer");

let mailserv = mailer.createTransport({
    sendmail: true,
    newline: 'unix'
});

router.get('/login', (req, res) => {
    res.render('login', {rc: req.query.rc});
});

router.get("/forgot-pass", function(req,res){
    res.render("forgot-pass");
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
        if (ses.role != "S" || data.pass.length < 5) return "select $1, $2, $3, $4, $5";
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

router.post("/resetpassword", rpg.execSQL({
    dbcon: pass.dbcon,
    sql: "insert into pass_reset(mail, token, ctime) values ($1,$2,now())",
    postReqData: ["mail"],
    onStart: (ses, data, calc) => {
        let n = ~~(Math.random()*32768);
        calc.token = "" + n + crypto.createHash('md5').update(data.user).digest('hex');
        let mailopts = {
            from: "noreply@saduewa.dcc.uchile.cl",
            to: data.user,
            subject: "Readings: Recuperación de Contraseña",
            text: "Puedes recuperar y cambiar la contraseña de tu cuenta en Readings en el siguiente link: \n " +
                "https://saduewa.dcc.uchile.cl:8888/readings/new-pass/" + calc.token + "\n\nReadings."
        };
        mailserv.sendMail(mailopts, function(err,info){
            if(!err){
                console.log("Mail sent");
            }
        });
    },
    sqlParams: [rpg.param("post", "user"), rpg.param("calc", "token")],
    onEnd: (req, res) => {
        res.redirect("login?rc=3");
    }
}));

router.get("/new-pass/:token", (req, res) => {
    res.render("newpass", {token: req.params.token});
});

router.post("/newpassword", rpg.execSQL({
    dbcon: pass.dbcon,
    sql: "update users as u set pass = $1 from pass_reset as r where r.token = $2 and r.mail = u.mail",
    postReqData: ["token", "pass"],
    onStart: (ses, data, calc) => {
        if (data.pass.length < 5) return "select 1";
        calc.passcr = crypto.createHash('md5').update(data.pass).digest('hex');
    },
    sqlParams: [rpg.param("calc", "passcr"), rpg.param("post", "token")],
    onEnd: (req, res) => {
        res.redirect("login?rc=4");
    }
}));

module.exports = router;
