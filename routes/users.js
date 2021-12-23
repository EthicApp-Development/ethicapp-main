"use strict";
const fetch = require('node-fetch')
let express = require('express');
let router = express.Router();
let rpg = require("../modules/rest-pg");
let pass = require("../modules/passwords");
let crypto = require("crypto");
let mailer = require("nodemailer");
const passport = require('passport');
require('./passport-setup');

var pg = require('pg');
const app = require('../app');
router.use(passport.initialize())
router.use(passport.session())


let mailserv = mailer.createTransport({
    sendmail: true,
    newline: 'unix'
});

router.get('/login', (req, res) => {
    res.render('login', {rc: req.query.rc});
});

router.get('/passreset', (req, res) => {
    res.render('passreset', {rc: req.query.rc});
});

router.get("/forgot-pass", function(req,res){
    res.render("forgot-pass");
});

router.get("/logout", (req, res) => {
    req.session.uid = null;
    req.session.role = null;
    req.session.ses = null;
    req.session.prevUid = null;
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

router.get('/google',
  passport.authenticate('google', { scope:
      [ 'email', 'profile' ] }
));

router.get( '/google/callback',
        passport.authenticate( 'google', {
            failureRedirect: '/register'}),
            function(req, res) {
                var db = getDBInstance(pass.dbcon);
                var sql = "SELECT * FROM users WHERE mail ='"+req.user.email +"' LIMIT 1";
                console.log(sql)
                var qry;
                qry = db.query(sql,(err,res) =>{
                    if(res.rows[0] != null){
                        console.log(res.rows[0])
                        req.session.uid = res.rows[0].id;
                        req.session.role = 'A';
                        req.session.ses = null;
                        }
                }).then(t => res.redirect("/seslist") )
                

              }


     );

/* 
router.post("/register2", rpg.execSQL({
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
}));*/
var DB = null;
function getDBInstance(dbcon){
    if(DB == null) {
        DB = new pg.Client(dbcon);
        DB.connect();
        DB.on("error", function(err){
            console.error(err);
            DB = null;
        });
        return DB;
    }
    return DB;
}

function smartArrayConvert(sqlParams) {
    var arr = [];
    for (var i = 0; i < sqlParams.length; i++) {
        var p = sqlParams[i];
        console.log(p)
        arr.push(p)
    }
    return arr;
}


router.post("/register", (req, res) => {
    const response_key = req.body["g-recaptcha-response"];
    const secret_key = pass.Captcha_Secret;
    console.log(req.body)
fetch("https://www.google.com/recaptcha/api/siteverify?secret="+secret_key+"&response="+response_key)
  .then(response => response.json())
  .then(data => {
      console.log(data)
      if(data.success == true){
          console.log(req.body.pass)
          console.log(req.body["conf-pass"])
          if (req.body.pass == req.body["conf-pass"]){
            var db = getDBInstance(pass.dbcon);
            var sql = "insert into users(rut, pass, name, mail, sex, role) values ($1,$2,$3,$4,$5,'A')";
            var qry;
            var passcr = crypto.createHash('md5').update(req.body.pass).digest('hex');
            var fullname = (req.body.name + " " + req.body.lastname);
            var sqlParams = [req.body.rut, passcr, fullname, req.body.mail, req.body.sex]
            var sqlarr = smartArrayConvert(sqlParams);
            //console.log("sql")
            //console.log(sql)
            //console.log("sqlarr")
            //console.log(sqlarr)
            qry = db.query(sql, sqlarr);
            console.log("entro al success")
            qry.on("end", function () {
                res.redirect("login?rc=1");
                // db.end();
            });
            qry.on("error", function(err){
                console.error("[DB Error]: ", err);
                res.end('{"status":"err"}');
            });
          }else{
            console.log("redirigido a register")
            res.redirect("register");
          }

      }
      else{
          console.log("redirigido a register")
        res.redirect("register");
      }
}).catch(function(e) {
    console.log(e); 
  });



    
});



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


var AWS = require('@aws-sdk/client-ses');
router.post("/resetpassword", (req, res) => {

    async function mail() {
        const params ={
            Source:'no-reply@iccuandes.org',
            Destination:{
                'ToAddresses': [
                    req.body.user,
                ]},
            Message:{
                'Subject': {
                    'Data': 'Test'},
                'Body': {
                    'Text': {
                        'Data': 'Mail de prueba'},
                    'Html': {
                        'Data': '<div>Hola<br>¿Has perdido tu contraseña? Puedes restablecerla a continuación:<br><a href="http://localhost:8501/passreset"> <button class="btn-primary"> Restablecer contraseña</button> </a> <br>Recibe un cordial saludo,<br>Creadores de EthicApp</div>'} }
                } 
        };
        
        var sendPromise = new AWS.SES({apiVersion: '2010-12-01'}).sendEmail(params);
        console.log("paso aca")
        // Handle promise's fulfilled/rejected states
        sendPromise.then(
          function(data) {
            console.log(data.MessageId);
            res.redirect("login?rc=3");
          }).catch(
            function(err) {
            console.error(err, err.stack);
          });
        
          console.log("paso aca2")
        }
        mail()

    
});



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


router.get("/profile",(req,res)=> {

    res.render("profile");
});


router.post("/changepassword",(req,res)=> {
    console.log(req.body)
    if (req.body.pass == req.body["pass-conf"]){
            var db = getDBInstance(pass.dbcon);
            var passcr = crypto.createHash('md5').update(req.body.pass).digest('hex');
            var sql = "UPDATE users SET pass = '"+passcr+"' WHERE mail = '"+req.body.mail+"'";
            var qry;
            var sqlParams = [passcr,req.body.mail]
            var sqlarr = smartArrayConvert(sqlParams);
            console.log("sql")
            console.log(sql)
            console.log("sqlarr")
            console.log(sqlarr)
            qry = db.query(sql);
            console.log("entro al success")
            qry.on("end", function () {
                console.log("cambio de contrase;a exitoso")
                res.redirect("login?rc=4");
                // db.end();
            });
            qry.on("error", function(err){
                console.error("[DB Error]: ", err);
                res.end('{"status":"err"}');
            });
    }
});


router.post("/deleteacc",(req,res)=> {
    //console.log(req.session)
    var db = getDBInstance(pass.dbcon);

    var sql = "UPDATE users SET disabled = true WHERE id ='"+req.session.uid +"'";
    var qry;
    qry = db.query(sql,(err,res) =>{
        //console.log(res)
        })
    try{
        var newmail;
        newmail = Date.now().toString() + req.session.passport.user.email
        console.log(newmail)
        var sql2 = "UPDATE users SET mail = '"+newmail+"' WHERE id ='"+req.session.uid +"'";
        var qry2;
        qry2 = db.query(sql2,(err,res) =>{
            console.log(res)
            })
            console.log("por arriba")
    }
    catch{
        var newmail;
        newmail = Date.now().toString() + req.body.mail
        console.log(newmail)
        var sql2 = "UPDATE users SET mail = '"+newmail+"' WHERE id ='"+req.session.uid +"'";
        var qry2;
        qry2 = db.query(sql2,(err,res) =>{
            console.log(res)
            })

    }
    finally{
        res.redirect("login")
    }


});
