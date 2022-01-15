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

router.get('/institucion', (req, res) => {
    res.render('institucion', {rc: req.query.rc});
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
                var qry;
                qry = db.query(sql,(err,res) =>{
                    if(res.rows[0] != null){
                        req.session.uid = res.rows[0].id;
                        req.session.role = 'A';
                        req.session.ses = null;
                        }
                }).then(t => res.redirect("/seslist") )
                

              }


     );

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
        arr.push(p)
    }
    return arr;
}

router.post("/register", (req, res) => {
    const response_key = req.body["g-recaptcha-response"];
    const secret_key = pass.Captcha_Secret;
fetch("https://www.google.com/recaptcha/api/siteverify?secret="+secret_key+"&response="+response_key)
  .then(response => response.json())
  .then(data => {
      if(data.success == true){
          if (req.body.pass == req.body["conf-pass"]){
            var db = getDBInstance(pass.dbcon);
            var sql = "insert into users(rut, pass, name, mail, sex, role) values ($1,$2,$3,$4,$5,'A')";
            var qry;
            var passcr = crypto.createHash('md5').update(req.body.pass).digest('hex');
            var fullname = (req.body.name + " " + req.body.lastname);
            var sqlParams = [req.body.rut, passcr, fullname, req.body.mail, req.body.sex]
            var sqlarr = smartArrayConvert(sqlParams);
            qry = db.query(sql, sqlarr);
            qry.on("end", function () {
                res.redirect("login?rc=1");
            });
            qry.on("error", function(err){
                res.end('{"status":"err"}');
            });
          }else{
            res.redirect("register");
          }
      }
      else{
        res.redirect("register");
      }
}).catch(function(e) {
  });
});

router.post("/register_institucion", (req, res) => {
    const response_key = req.body["g-recaptcha-response"];
    const secret_key = pass.Captcha_Secret;
fetch("https://www.google.com/recaptcha/api/siteverify?secret="+secret_key+"&response="+response_key)
  .then(response => response.json())
  .then(data => {
      if(data.success == true){
          if (req.body.pass == req.body["conf-pass"]){
            var db = getDBInstance(pass.dbcon);
            var sql = "insert into users(rut, pass, name, mail, sex, role) values ('11111111-1',$1,$2,$3,'O','I')";
            var qry;
            var passcr = crypto.createHash('md5').update(req.body.pass).digest('hex');
            var fullname = (req.body.name + " " + req.body.lastname);
            var sqlParams = [passcr, fullname, req.body.email]
            var sqlarr = smartArrayConvert(sqlParams);
            qry = db.query(sql, sqlarr);
            qry.on("end", function () {
                var sql2 = "SELECT * FROM users WHERE mail ='"+req.body.email +"' LIMIT 1";
                var qry2;
                qry2 = db.query(sql2,(err,rest) =>{
                    if(rest.rows[0] != null){
                        var sql3 = "insert into institucion(userid, institutionName, numEstudents, country, mailDomains, position) values ($1,$2,$3,$4,$5,$6)";
                        var qry3;
                        var sqlParams3 = [rest.rows[0].id, req.body.name_ins, parseInt(req.body.Numero_estudiantes,10),req.body.Pais,req.body.domains,req.body.Cargo ]
                        qry3 = db.query(sql3, sqlParams3);
                        qry3.on("end", function () {

                        });
                        }
                        else{
                            res.redirect("register");
                        }
                    })
                res.redirect("login?rc=1");
            });
            qry.on("error", function(err){
                res.end('{"status":"err"}');
            });
          }else{
            res.redirect("register");
          }
      }
      else{
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


var AWS = require('aws-sdk');
router.post("/resetpassword", (req, res) => {

    const SES_CONFIG = {
        accessKeyId: pass.accessKeyId,
        secretAccessKey: pass.secretAccessKey,
        region: "us-east-1",
    };
    const AWS_SES = new AWS.SES(SES_CONFIG);

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


          AWS_SES.sendEmail(params).promise().then(
             function(data) {
                res.redirect("login?rc=3");
              }).catch(
                function(err) {
              });;
        }
        mail()

    
})



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

router.get("/is-institution", (req, res) => {
    if(req.session.role == "I" || req.session.prevUid != null){
        res.send({status: true});
    }
    else {
        res.send({status: false});
    }
});

module.exports = router;


router.get("/profile",(req,res)=> {

    res.render("profile");
});


router.post("/changepassword",(req,res)=> {
    if (req.body.pass == req.body["pass-conf"]){
            var db = getDBInstance(pass.dbcon);
            var passcr = crypto.createHash('md5').update(req.body.pass).digest('hex');
            var sql = "UPDATE users SET pass = '"+passcr+"' WHERE mail = '"+req.body.mail+"'";
            var qry;
            var sqlParams = [passcr,req.body.mail]
            qry = db.query(sql);
            qry.on("end", function () {
                res.redirect("login?rc=4");
            });
            qry.on("error", function(err){
                res.end('{"status":"err"}');
            });
    }
});

router.post("/create-multicounts",(req,res)=> {
    var accounts = req.body.data.split('\r\n')
    var db = getDBInstance(pass.dbcon);
    for(var i = 0;i< accounts.length;i++){
        var account_data = accounts[i].split(',')
        var sql = "SELECT * FROM users WHERE mail ='"+account_data[0] +"' LIMIT 1";
        var qry;
        qry = db.query(sql,(err,res) =>{
            if(res.rows[0] != null){
                console.log("el mail ya esta usado")
                }
            else{
                var sql = "insert into users(rut, pass, name, mail, sex, role) values ($1,$2,$3,$4,$5,'A')";
                var qry;
                var passcr = crypto.createHash('md5').update(account_data[1]).digest('hex');
                var name = account_data[1];
                if(account_data.length == 3){
                    name = account_data[2] 
                }
                if(account_data.length == 4){
                    name = account_data[2] + " "+ account_data[3]
                }
                 
                var sqlParams = ["11111111-1", passcr, account_data[2], account_data[0], 'O']
                var sqlarr = smartArrayConvert(sqlParams);
                qry = db.query(sql, sqlarr);
                qry.on("end", function () {
                    console.log("creacion exitosa")
                });
                qry.on("error", function(err){
                });
            }
            });
    }
    

});


router.post("/deleteacc",(req,res)=> {
    var db = getDBInstance(pass.dbcon);
    var sql = "UPDATE users SET disabled = true WHERE id ='"+req.session.uid +"'";
    var qry;
    qry = db.query(sql,(err,res) =>{
        })
    try{
        var newmail;
        newmail = Date.now().toString() + req.session.passport.user.email
        var sql2 = "UPDATE users SET mail = '"+newmail+"' WHERE id ='"+req.session.uid +"'";
        var qry2;
        qry2 = db.query(sql2,(err,res) =>{

            })
    }
    catch{
        var newmail;
        newmail = Date.now().toString() + req.body.mail
        var sql2 = "UPDATE users SET mail = '"+newmail+"' WHERE id ='"+req.session.uid +"'";
        var qry2;
        qry2 = db.query(sql2,(err,res) =>{
            })

    }
    finally{
        res.redirect("login")
    }


});



router.post("/get_same_users", (req, res) => {
    var domains = req.body.postdata2.split(",")
    var db = getDBInstance(pass.dbcon);
    var resultados = [];
    for(var i =0;i<domains.length;i++){
        
        var sql = "SELECT * FROM users WHERE mail LIKE'%"+domains[i] +"%'";
        var qry;
        var result;
        qry = db.query(sql,(err,res) =>{
            result = res.rows
            
            resultados.push(result)
            
            });
            

    }  
    qry.on('end',function(){
        res.json({"data": resultados})
    })


});

router.post("/getuserinfo", (req, res) => {
    var db = getDBInstance(pass.dbcon);
    var sql = "SELECT * FROM users WHERE id ='"+req.session.uid +"' LIMIT 1";
    var qry;
    var result;
    qry = db.query(sql,(err,res) =>{
        result = res.rows
        });
qry.on('end',function(){
    res.json({"data": result})

})
});


router.post("/getdomains", (req, res) => {
    var db = getDBInstance(pass.dbcon);
    var sql = "SELECT * FROM institution WHERE userid ='"+req.session.uid +"'";
    var qry;
    var result;
    qry = db.query(sql,(err,res) =>{
        result = res.rows
        });
qry.on('end',function(){
    res.json({"data": result})
})
});


router.post("/make_prof", (req, res) => {
    var db = getDBInstance(pass.dbcon);
    var sql = "UPDATE users SET role = 'P' WHERE mail ='"+req.body.mail +"'";
    var qry;
    var result;
    qry = db.query(sql,(err,rest) =>{
        console.log("data uploaded")
        result = rest
        });
        qry.on('end',function(){
            
        })

});

router.post("/make_alum", (req, res) => {
    var db = getDBInstance(pass.dbcon);
    var sql = "UPDATE users SET role = 'A' WHERE mail ='"+req.body.mail +"'";
    var qry;
    var result;
    qry = db.query(sql,(err,rest) =>{
        console.log("data uploaded")
        result = rest

        });
        qry.on('end',function(){
            
        })

});