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
var AWS = require('aws-sdk');


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

router.get("/admin-profile", function(req,res){
    res.render("admin-profile");
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
    res.render("register",{rc: req.query.rc});
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
    var user_mail;
    var country;
fetch("https://www.google.com/recaptcha/api/siteverify?secret="+secret_key+"&response="+response_key)
  .then(response => response.json())
  .then(data => {
      if(data.success == true){
          if (req.body.pass == req.body["conf-pass"]){
            var db = getDBInstance(pass.dbcon);
            var long = req.body.domains.split(",")
            var exist = true;
            for(var i = 0;i < long.length ;i++){
                var sql = "SELECT * FROM mail_domain WHERE domain_name ='"+long[i] +"'";
                var qry;
                
                qry = db.query(sql,(err,res) =>{
                    if(res != null){
                        console.log("lo que quiero ver")
                        console.log(res)
                        exist = false

                    }
                    
                    });


            }
            console.log(exist)
            qry.on('end',function(){
                if(exist){
                    var sql = "insert into temporary_users(rut, pass, name, mail, sex, role) values ('11111111-1',$1,$2,$3,'O','I')";
                    var qry;
                    var passcr = crypto.createHash('md5').update(req.body.pass).digest('hex');
                    var fullname = (req.body.name + " " + req.body.lastname);
                    var sqlParams = [passcr, fullname, req.body.email]
                    var sqlarr = smartArrayConvert(sqlParams);
                    user_mail = req.body.email
                    qry = db.query(sql, sqlarr);
                    qry.on("end", function () {
                        var sql2 = "SELECT * FROM temporary_users WHERE mail ='"+req.body.email +"' LIMIT 1";
                        var qry2;
                        qry2 = db.query(sql2,(err,rest) =>{
                            if(rest.rows[0] != null){
                                var sql3 = "insert into temporary_institution(userid, institution_name, num_students, country, mail_domains, position,acepted) values ($1,$2,$3,$4,$5,$6,false)";
                                var qry3;
                                country = req.body.Pais
                                var sqlParams3 = [rest.rows[0].id, req.body.name_ins, parseInt(req.body.Numero_estudiantes,10),req.body.Pais,req.body.domains,req.body.Cargo ]
                                qry3 = db.query(sql3, sqlParams3);
                                qry3.on("end", function () {
        
                                });
                                }
                                else{
                                    res.redirect("register");
                                }
                            })
                            var SES_CONFIG = {
                                accessKeyId: pass.accessKeyId,
                                secretAccessKey: pass.secretAccessKey,
                                region: "us-east-1",
                            };
                            var AWS_SES = new AWS.SES(SES_CONFIG);
                            async function mail() {
                                var params ={
                                        Source:'no-reply@iccuandes.org',
                                        Destination:{
                                            'ToAddresses': [
                                                user_mail,
                                            ]},
                                        Message:{
                                            'Subject': {
                                                'Data': 'Solicitud de cuenta Institucional'},
                                            'Body': {
                                                'Text': {
                                                    'Data': ''},
                                                'Html': {
                                                    'Data': '<div>En un plazo de 24 a 48 horas hábiles quedará habilitada tu cuenta.<br>Te enviaremos un correo con los pasos a seguir.</div>'} }
                                            } 
                                    };
                                    var params2 ={
                                        Source:'no-reply@iccuandes.org',
                                        Destination:{
                                            'ToAddresses': [
                                                user_mail,
                                            ]},
                                        Message:{
                                            'Subject': {
                                                'Data': 'Test'},
                                            'Body': {
                                                'Text': {
                                                    'Data': 'Mail de prueba'},
                                                'Html': {
                                                    'Data': '<div>Within 24 to 48 business hours your account will be enabled.<br> We will send you an email with the steps to follow.</div>'} }
                                            } 
                                    };
                                    if (country == 'Chile'){// ver como decidir en que idioma se manda el mail
                                        AWS_SES.sendEmail(params).promise().then(
                                            function(data) {
                                             }).catch(
                                               function(err) {
                                             });
                        
                                    }
                                    else{
                                        AWS_SES.sendEmail(params2).promise().then(
                                            function(data) {
                                             }).catch(
                                               function(err) {
                                             });
                                    }
                                }
                                mail()
                        
                           
        
        
        
                        res.redirect("login?rc=1");
                    });
                }
                else{
                    res.redirect("register?rc=1");
                }
            })


            qry.on("error", function(err){
                console.log(err)
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
    sql: "select name, role, lang, mail from users where id = $1",
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



router.post("/resetpassword", (req, res) => {
    var SES_CONFIG = {
        accessKeyId: pass.accessKeyId,
        secretAccessKey: pass.secretAccessKey,
        region: "us-east-1",
    };
    var AWS_SES = new AWS.SES(SES_CONFIG);
    async function mail() {
        var params ={
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
        

            var params2 ={
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
                            'Data': '<div>Hi<br>Have you lost your password? You can restore it in the following link:<br><a href="http://localhost:8501/passreset"> <button class="btn-primary"> Restore Password</button> </a> <br>greetings<br>Creators of EthicApp</div>'} }
                    } 
            };
            if (req.body.lenguaje == 'Español'){
                AWS_SES.sendEmail(params).promise().then(
                    function(data) {
                       res.redirect("login?rc=3");
                     }).catch(
                       function(err) {
                     });

            }
            else{
                AWS_SES.sendEmail(params2).promise().then(
                    function(data) {
                       res.redirect("login?rc=3");
                     }).catch(
                       function(err) {
                     });
            }



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

    if(req.body.data != ''){
        console.log("se llama a la funcion saddddddddddddd")
        var accounts = req.body.data.split('\r\n')
        var db = getDBInstance(pass.dbcon);
        for(var i = 0;i< accounts.length;i++){
            console.log("se llama a la funcion saddddddddddddd")
            var account_data = accounts[i].split(',')
            var sql = "SELECT * FROM users WHERE mail ='"+account_data[0] +"' LIMIT 1";
            var qry;
            qry = db.query(sql,(err,res) =>{
                if(res.rows != []){
                    
           
            }
            else{
                var sql = "insert into temporary_users(rut, pass, name, mail, sex, role, token) values ($1,$2,$3,$4,$5,'A',$6)";
                var qry;
                var passcr = crypto.createHash('md5').update(account_data[1]).digest('hex');
                var name = account_data[1];
                if(account_data.length == 3){
                    name = account_data[2] 
                }
                if(account_data.length == 4){
                    name = account_data[2] + " "+ account_data[3]
                }
                var token = "10"
                var sqlParams = ["11111111-1", passcr, account_data[2], account_data[0], 'O',token]
                var sqlarr = smartArrayConvert(sqlParams);
                qry = db.query(sql, sqlarr);
                qry.on("end", function () {

                    var SES_CONFIG = {
                        accessKeyId: pass.accessKeyId,
                        secretAccessKey: pass.secretAccessKey,
                        region: "us-east-1",
                    };
                    var AWS_SES = new AWS.SES(SES_CONFIG);
                    async function mail() {
                        var params ={
                                Source:'no-reply@iccuandes.org',
                                Destination:{
                                    'ToAddresses': [
                                        user_mail,
                                    ]},
                                Message:{
                                    'Subject': {
                                        'Data': 'Resolucion de cuenta Institucional'},
                                    'Body': {
                                        'Text': {
                                            'Data': ''},
                                        'Html': {
                                            'Data': '<div>Hola '+'!<br><br> Bienvenido a EthicApp. Tu cuenta institucional está aprobada. Puedes ingresar a EthicApp y comenzar invitando a profesores a utilizarla, e incluso creando tu primera actividad. <br>'+
                                            +'<button class="btn-primary">Activar cuenta!</button>'+
                                            'Te recordamos que en EthicApp usamos los datos generados por los usuarios con fines de investigación. Garantizamos la absoluta confidencialidad de los datos, y que los datos no los entregamos a terceras partes. En nuestras investigaciones reportamos los datos siempre a nivel agregado y nunca a nivel individual, ni revelando la identidad de los participantes.<br>'+
                                            'Las actividades basadas en EthicApp no presentan ningún riesgo a docentes ni estudiantes. EthicApp se entrega como servicio a los usuarios “tal cual”. Los desarrolladores de EthicApp quedan exentos de cualquier responsabilidad… [tenemos que ver si lo expresamos en forma similar a las licencias permisivas tipo BSD, MIT o Apache].<br>'+
                                            'EthicApp se reserva el derecho de suspender o terminar cuentas de usuario en caso que se detecte uso indebido del servicio.<br>'+
                                            'Deseamos a ti y a tus colegas el mayor éxito utilizando EthicApp en la enseñanza.<br>'+
                                            'Creadores de EthicApp'+
                                            '</div>'} }
                                    } 
                            };
                            console.log(user_mail)
                                AWS_SES.sendEmail(params).promise().then(
                                    function(data) {
                                     }).catch(
                                       function(err) {
                                     });
                
        
                        }
                        mail()
                });
                qry.on("error", function(err){
                });
            }

                });
        }
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
    var result;
    for(var i =0;i<domains.length;i++){
        
        var sql = "SELECT * FROM users WHERE mail LIKE'%"+domains[i] +"'";
        var qry;
        
        qry = db.query(sql,(err,res) =>{
            if(res != null)
            {
            result = res.rows
            resultados.push(result)
            }
            
            });
            

    }  
    qry.on('end',function(){
        res.json({"data": result})
    })


});

router.post("/get_mail_domains", (req, res) => {
    var db = getDBInstance(pass.dbcon);
    var sql = "SELECT * FROM mail_domain WHERE institutionid ='"+req.body +"'";
    var qry;
    var result;
    var lista = "";
    qry = db.query(sql,(err,res) =>{
        if(res != null){
            result = res.rows
            for(var i = 0; i < result.length;i++){
                if(i == result.length-1){
                    lista += result[i].domain_name
                }
                else{
                    lista += result[i].domain_name+","
                }
                
            }
        }
        
        });
qry.on('end',function(){
    res.json({"data": lista})

})



});

router.post("/getuserinfo", (req, res) => {
    var db = getDBInstance(pass.dbcon);
    var sql = "SELECT * FROM users WHERE id ='"+req.session.uid +"' LIMIT 1";
    var qry;
    var result;
    qry = db.query(sql,(err,res) =>{
        if(res != null)
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
        if(res != null){
        result = res.rows
        }
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
        if(rest != null){
            result = rest
        }
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
        if(rest != null){
            result = rest
        }

        });
        qry.on('end',function(){
            
        })

});


router.post("/get_temporary_institutions", (req, res) => {
    var db = getDBInstance(pass.dbcon);
    var sql = "SELECT * FROM temporary_institution";
    var qry;
    var result;
    qry = db.query(sql,(err,rest) =>{
        if(rest != null){
            result = rest
        }

        });
        qry.on('end',function(){
            res.json({"data": result})
        })

});

router.post("/get_institutions", (req, res) => {
    var db = getDBInstance(pass.dbcon);
    var sql = "SELECT * FROM institution";
    var qry;
    var result;
    qry = db.query(sql,(err,rest) =>{
        if(rest != null){
            result = rest
        }

        });
        qry.on('end',function(){
            res.json({"data": result})
        })

});



router.post("/get_temp_institution_info", (req, res) => {
    var db = getDBInstance(pass.dbcon);
    var sql = "SELECT * FROM temporary_institution WHERE id = '"+req.body.inst_id +"'";
    var qry;
    var result;
    qry = db.query(sql,(err,rest) =>{
        if(rest != null){
            result = rest
        }

        });
        qry.on('end',function(){
            res.json({"data": result})
        })


});

router.post("/get_temp_admin_info", (req, res) => {
    var db = getDBInstance(pass.dbcon);
    var sql = "SELECT * FROM temporary_users WHERE id = '"+req.body.userid +"'";
    var qry;
    var result;
    qry = db.query(sql,(err,rest) =>{
        if(rest != null){
            result = rest
        }

        });
        qry.on('end',function(){
            res.json({"data": result})
        })


});


router.post("/get_institution_info", (req, res) => {
    var db = getDBInstance(pass.dbcon);
    var sql = "SELECT * FROM institution WHERE id = '"+req.body.inst_id +"'";
    var qry;
    var result;
    qry = db.query(sql,(err,rest) =>{
        if(rest != null){
            result = rest
        }

        });
        qry.on('end',function(){
            res.json({"data": result})
        })


});

router.post("/get_admin_info", (req, res) => {
    var db = getDBInstance(pass.dbcon);
    var sql = "SELECT * FROM users WHERE id = '"+req.body.userid +"'";
    var qry;
    var result;
    qry = db.query(sql,(err,rest) =>{
        if(rest != null){
            result = rest
        }

        });
        qry.on('end',function(){
            res.json({"data": result})
        })


});

router.post("/get_institution_domains", (req, res) => {
    var db = getDBInstance(pass.dbcon);
    var sql = "SELECT * FROM mail_domain WHERE institutionid = '"+req.body.institutuinid +"'";
    var qry;
    var result;
    qry = db.query(sql,(err,rest) =>{
        if(rest != null){
            result = rest
        }

        });
        qry.on('end',function(){
            res.json({"data": result})
        })


});


router.post("/accept_institution", (req, res) => {
    var db = getDBInstance(pass.dbcon);
    var sql = "SELECT * FROM temporary_institution WHERE id = '"+req.body.institutionid +"' LIMIT 1";
    var qry;
    var result;
    var user_mail;
    var fullname;

    qry = db.query(sql,(err,rest) =>{
        if(rest != null){
            result = rest.rows[0]
            var sql = "SELECT * FROM temporary_users WHERE id = '"+req.body.userid +"' LIMIT 1";
            var qry;
            var result2;

            qry = db.query(sql,(err,resu) =>{
                if(rest != null){
                    result2 = resu.rows[0]
                    var sql = "insert into users(rut, pass, name, mail, sex, role) values ($1,$2,$3,$4,$5,'I')";
                    var qry;
                    var passcr = result2.pass
                    fullname = result2.name
                    var sqlParams = [result2.rut, passcr, fullname, result2.mail, result2.sex]
                    var sqlarr = smartArrayConvert(sqlParams);
                    qry = db.query(sql, sqlarr);

                    qry.on("end", function () {
                        var sql = "SELECT * FROM users WHERE mail = '"+result2.mail +"' LIMIT 1";
                        var qry;
                        var result3;
                        user_mail = result2.mail;

                        qry = db.query(sql,(err,resul) =>{
                            result3 = resul.rows[0]
                            var sql = "insert into institution(userid, institution_name, num_students, country, position) values ($1,$2,$3,$4,$5)";
                            var qry;
                            var sqlParams = [result3.id, result.institution_name, result.num_students, result.country, result.position]
                            var sqlarr = smartArrayConvert(sqlParams);
                            qry = db.query(sql, sqlarr);

                            qry.on("end", function () {
                                var sql = "SELECT * FROM institution WHERE institution_name = '"+result.institution_name +"' LIMIT 1";
                                var qry;
                                var result5;

                                qry = db.query(sql,(err,res_inst) =>{
                                    if(res_inst != null){
                                        result5 = res_inst.rows[0]
                                        var domains = result.mail_domains.split(",")
                                        for(var i = 0; i < domains.length ;i++){
                                            var sql = "insert into mail_domain(institutionid, domain_name) values ($1,$2)";
                                            var qry;
                                            var sqlParams = [result5.id, domains[i] ]
                                            var sqlarr = smartArrayConvert(sqlParams);
                                            qry = db.query(sql, sqlarr);

                                        }

                                        qry.on("end", function () {                   
                                            var sql = "delete from temporary_institution WHERE id = '"+req.body.institutionid +"'";
                                            var qry;
                                            var result4;
                                            qry = db.query(sql,(err,resto) =>{
                                                if(rest != null){
                                                    result4 = resto
                                                }
                                        
                                                });

                                                qry.on('end',function(){
                                                    var sql = "delete from temporary_users WHERE id = '"+req.body.userid +"'";
                                                    var qry;
                                                    var result5;
                                                    qry = db.query(sql,(err,resta) =>{
                                                        if(rest != null){
                                                            result5 = resta
                                                        }
                                                
                                                        });
                                                        qry.on('end',function(){
                                                            var SES_CONFIG = {
                                                                accessKeyId: pass.accessKeyId,
                                                                secretAccessKey: pass.secretAccessKey,
                                                                region: "us-east-1",
                                                            };
                                                            
                                                            var AWS_SES = new AWS.SES(SES_CONFIG);
                                                            async function mail() {
                                                                var params ={
                                                                        Source:'no-reply@iccuandes.org',
                                                                        Destination:{
                                                                            'ToAddresses': [
                                                                                user_mail,
                                                                            ]},
                                                                        Message:{
                                                                            'Subject': {
                                                                                'Data': 'Resolucion de cuenta Institucional'},
                                                                            'Body': {
                                                                                'Text': {
                                                                                    'Data': ''},
                                                                                'Html': {
                                                                                    'Data': '<div>Hola '+ fullname+'!<br><br> Bienvenido a EthicApp. Tu cuenta institucional está aprobada. Puedes ingresar a EthicApp y comenzar invitando a profesores a utilizarla, e incluso creando tu primera actividad. <br>'+
                                                                                    +'<button class="btn-primary">¡Comenzar!</button>'+
                                                                                    'Te recordamos que en EthicApp usamos los datos generados por los usuarios con fines de investigación. Garantizamos la absoluta confidencialidad de los datos, y que los datos no los entregamos a terceras partes. En nuestras investigaciones reportamos los datos siempre a nivel agregado y nunca a nivel individual, ni revelando la identidad de los participantes.<br>'+
                                                                                    'Las actividades basadas en EthicApp no presentan ningún riesgo a docentes ni estudiantes. EthicApp se entrega como servicio a los usuarios “tal cual”. Los desarrolladores de EthicApp quedan exentos de cualquier responsabilidad… [tenemos que ver si lo expresamos en forma similar a las licencias permisivas tipo BSD, MIT o Apache].<br>'+
                                                                                    'EthicApp se reserva el derecho de suspender o terminar cuentas de usuario en caso que se detecte uso indebido del servicio.<br>'+
                                                                                    'Deseamos a ti y a tus colegas el mayor éxito utilizando EthicApp en la enseñanza.<br>'+
                                                                                    'Creadores de EthicApp'+
                                                                                    '</div>'} }
                                                                            } 
                                                                    };
                                                                        AWS_SES.sendEmail(params).promise().then(
                                                                            function(data) {
                                                                             }).catch(
                                                                               function(err) {
                                                                             });
                                                        
                                                
                                                                }
                                                                mail()
                                                        })
                                                })
                                        })
                                    }
                                })
                                })
                        })
                    });
                
                }
                });
        }
        });
        qry.on('end',function(){// termino de la funciones de base de datos, a continuacion se manda el mail al usuario diciendo que fue aceptado

            res.redirect("home");
        })
    


});




router.post("/reject_institution", (req, res) => {
    var db = getDBInstance(pass.dbcon);
    var sql = "delete from temporary_institution WHERE id = '"+req.body.institutionid +"'";
    var qry;
    var result;
    var user_mail;
    qry = db.query(sql,(err,rest) =>{
        if(rest != null){
            result = rest
        }
        });
        qry.on('end',function(){
            var sql = "SELECT * FROM temporary_users WHERE id = '"+req.body.userid +"' LIMIT 1";
            var qry;
            var fullname;
            
            qry = db.query(sql,(err,resu) =>{
                if(resu != null){
                    fullname = resu.rows[0].name
                    user_mail = resu.rows[0].mail

                }



            })
            var sql = "delete from temporary_users WHERE id = '"+req.body.userid +"'";
            var qry;
            qry = db.query(sql,(err,rest) =>{
                if(rest != null){

                }
        
                });
                qry.on('end',function(){
                    console.log("llega donde se manda el mail")
                    var SES_CONFIG = {
                        accessKeyId: pass.accessKeyId,
                        secretAccessKey: pass.secretAccessKey,
                        region: "us-east-1",
                    };
                    var AWS_SES = new AWS.SES(SES_CONFIG);
                    async function mail() {
                        var params ={
                                Source:'no-reply@iccuandes.org',
                                Destination:{
                                    'ToAddresses': [
                                        user_mail,
                                    ]},
                                Message:{
                                    'Subject': {
                                        'Data': 'Resolucion de cuenta Institucional'},
                                    'Body': {
                                        'Text': {
                                            'Data': ''},
                                        'Html': {
                                            'Data': '<div>Hola '+ fullname+'!<br><br> Lamentamos que tu solicitud de creación de cuenta institucional fue rechazada. Esto pudo deberse a que tu institución ya se encuentra registrada en EthicApp, o a información faltante en el proceso de registro.<br>'+
                                            'Puedes contactarnos a estudios-icc (at) miuandes.cl para buscar solución al problema.<br>'+
                                            'Un cordial saludo,<br>'+
                                            'Creadores de EthicApp'+
                                            '</div>'} }
                                    } 
                            };
                            AWS_SES.sendEmail(params).promise().then(
                                function(data) {
                                    }).catch(
                                    function(err) {
                                    });
                
        
                        }
                        mail()
                    res.redirect("home");
                })
        })
    

});