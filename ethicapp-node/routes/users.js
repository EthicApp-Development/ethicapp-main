"use strict";

const fetch = require("node-fetch");
let express = require("express");
let router = express.Router();
let rpg = require("../modules/rest-pg");
let pass = require("../modules/passwords");
let crypto = require("crypto");
let mailer = require("nodemailer");
const handlebars = require("handlebars"); 
const fs = require('fs');
const passport = require("passport");
require("./passport-setup");
var AWS = require("aws-sdk");
var pg = require("pg");
var DB = null;
require("../app");
router.use(passport.initialize());
router.use(passport.session());


mailer.createTransport({
    sendmail: true,
    newline:  "unix"
});


router.get("/login", (req, res) => {
    res.render("login", {rc: req.query.rc, tok: req.query.rc});
});


router.get("/institucion", (req, res) => {
    res.render("institucion", { rc: req.query.rc });
});


router.get("/passreset", (req, res) => {
    res.render("passreset", { rc: req.query.rc });
});


router.get("/forgot-pass", function (req, res) {
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
    sql:   `
    SELECT id,
        role
    FROM users
    WHERE (
        rut = $1
        AND pass = $2
    ) OR (
        mail = $3
        AND pass=$4
    )
    `,
    postReqData: ["user", "pass"],
    onStart:     (ses, data, calc) => {
        calc.user = data.user.trim();
        calc.passcr = crypto.createHash("md5").update(data.pass).digest("hex");
    },
    sqlParams: [
        rpg.param("calc", "user"), rpg.param("calc", "passcr"), rpg.param("calc", "user"),
        rpg.param("calc", "passcr")
    ],
    onEnd: (req, res, result) => {
        if (result.id != null) {
            req.session.uid = result.id;
            req.session.role = result.role;
            req.session.ses = null;
            res.redirect(".");
        }
        else {
            res.redirect("login?rc=2");
        }
    }
}));


router.get("/register", (req, res) => {
    res.render("register",{rc: req.query.rc});
});


router.get("/google",
    passport.authenticate("google", {
        scope: ["email", "profile"]
    })
);


router.get("/google/callback",
    passport.authenticate("google", {
        failureRedirect: "/register"
    }),
    function (req, res) {
        var db = getDBInstance(pass.dbcon);
        var sql = `
        SELECT *
        FROM users
        WHERE mail = '${req.user.email}'
        LIMIT 1
        `;
        db.query(sql, (err, res) => {
            if (res.rows[0] != null) {
                req.session.uid = res.rows[0].id;
                req.session.role = "A";
                req.session.ses = null;
            }
        })
            .then(() => res.redirect("/seslist"));
    }
);


function getDBInstance(dbcon) {
    if (DB == null) {
        DB = new pg.Client(dbcon);
        DB.connect();
        DB.on("error", function (err) {
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
        arr.push(p);
    }
    return arr;
}


router.post("/register", (req, res) => {
    const response_key = req.body["g-recaptcha-response"];
    const secret_key = pass.Captcha_Secret;
    fetch(
        "https://www.google.com/recaptcha/api/siteverify" +
        `secret=${secret_key}&response=${response_key}`
    )
        .then(response => response.json())
        .then(data => {
            if (data.success == true) {
                if (req.body.pass == req.body["conf-pass"]) {
                    var db = getDBInstance(pass.dbcon);
                    var sql = `
                    INSERT INTO users(rut, pass, name, mail, sex, ROLE)
                    VALUES ($1,$2,$3,$4,$5,'A')
                    `;
                    var qry;
                    var passcr = crypto.createHash("md5").update(req.body.pass).digest("hex");
                    var fullname = (req.body.name + " " + req.body.lastname);
                    var sqlParams = [req.body.rut, passcr, fullname, req.body.mail, req.body.sex];
                    var sqlarr = smartArrayConvert(sqlParams);
                    qry = db.query(sql, sqlarr);
                    qry.on("end", function () {
                        res.redirect("login?rc=1");
                    });
                    qry.on("error", function () {
                        res.end('{"status":"err"}');
                    });
                } else {
                    res.redirect("register");
                }
            }
            else {
                res.redirect("register");
            }
        })
        .catch(function (e) {
            console.error(e);
        });
});


router.post("/register_institucion", (req, res) => {
    const response_key = req.body["g-recaptcha-response"];
    const secret_key = pass.Captcha_Secret;
    var user_mail;
    var country;
    fetch(
        "https://www.google.com/recaptcha/api/siteverify?" +
        `secret=${secret_key}&response=${response_key}`
    )
        .then(response => response.json())
        .then(data => {
            if(data.success == true) {
                if (
                    req.body.pass == req.body["conf-pass"] && req.body.Pais != "Elige un Pais"
                    && req.body.Pais != "Choose Country"
                ) {
                    var db = getDBInstance(pass.dbcon);
                    var long = req.body.domains.split(",");
                    var exist = true;
                    for(var i = 0;i < long.length ;i++) {
                        var sql = `
                        SELECT *
                        FROM mail_domain
                        WHERE domain_name = '${long[i]}'
                        `;
                        var qry;
                    
                        qry = db.query(sql, (err,res) => {
                            if (res != null) {
                                exist = false;
                            }
                        });
                    }
                    qry.on("end", function() {
                        if (exist) {
                            var sql = `
                            INSERT INTO temporary_users(rut, pass, name, mail, sex, ROLE)
                            VALUES ('11111111-1', $1, $2, $3, 'O', 'I')
                            `;
                            var qry;
                            var passcr = crypto.createHash("md5")
                                .update(req.body.pass).digest("hex");
                            var fullname = (req.body.name + " " + req.body.lastname);
                            var sqlParams = [passcr, fullname, req.body.email];
                            var sqlarr = smartArrayConvert(sqlParams);
                            user_mail = req.body.email;
                            qry = db.query(sql, sqlarr);
                            qry.on("end", function () {
                                var sql2 = `
                                SELECT * FROM temporary_users
                                WHERE mail = '${req.body.email}' LIMIT 1
                                `;
                                db.query(sql2, (err,rest) => {
                                    if (rest.rows[0] != null) {
                                        var sql3 = `
                                        INSERT INTO temporary_institution(
                                            userid, institution_name, num_students, country,
                                            mail_domains, POSITION, acepted
                                        )
                                        VALUES ($1,$2,$3,$4,$5,$6,FALSE)
                                        `;
                                        var qry3;
                                        country = req.body.Pais;
                                        var sqlParams3 = [
                                            rest.rows[0].id,
                                            req.body.name_ins,
                                            parseInt(req.body.Numero_estudiantes, 10),
                                            req.body.Pais,
                                            req.body.domains,
                                            req.body.Cargo
                                        ];
                                        qry3 = db.query(sql3, sqlParams3);
                                        qry3.on("end", function () {});
                                    }
                                    else {
                                        res.redirect("register");
                                    }
                                });
                                var SES_CONFIG = {
                                    accessKeyId:     pass.accessKeyId,
                                    secretAccessKey: pass.secretAccessKey,
                                    region:          "us-east-1",
                                };
                                var AWS_SES = new AWS.SES(SES_CONFIG);
                                var emailTemplate, subject; 
                                if (country == "Chile") {   // ver como decidir en que idioma se manda el mail
                                    // versión en español
                                    emailTemplate = fs.readFileSync(__dirname + '/../public/email-templ/inst-account-request/es-inst-account-request.html', 'utf8');
                                    subject = "Solicitud de cuenta Institucional";
                                }
                                else {
                                    // versión en inglés
                                    emailTemplate = fs.readFileSync(__dirname + '/../public/email-templ/inst-account-request/en-inst-account-request.html', 'utf8');
                                    subject = "Institutional account request";
                                }
                                const template = handlebars.compile(emailTemplate);
                                const html = template;
                                async function mail(user_mail, subject) {
                                    var params ={
                                        Source:      "no-reply@iccuandes.org",
                                        Destination: {
                                            ToAddresses: [
                                                user_mail,
                                            ]},
                                        Message: {
                                            Subject: {
                                                Data: subject
                                            },
                                            Body: {
                                                Text: {
                                                    Data: ""},
                                                Html: html
                                            }
                                        } 
                                    };
                                    
                                    AWS_SES.sendEmail(params).promise()
                                        .then(function() {})
                                        .catch(function() {});
                        
                                }
                                mail(user_mail, subject);
                                res.redirect("login?rc=1");
                            });
                        }
                        else{
                            res.redirect("register?rc=1");
                        }
                    });

                    qry.on("error", function(err){
                        console.error(err);
                        res.end('{"status":"err"}');
                    });
                } else {
                    res.redirect("register");
                }
            }
            else{
                res.redirect("register");
            }
        }).catch(function(e) {
            console.error(e); 
        });   
});


router.post("/register-prof", rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    INSERT INTO users(rut, pass, name, mail, sex, ROLE)
    VALUES ($1,$2,$3,$4,$5,'P')
    `,
    postReqData: ["name", "rut", "pass", "mail", "sex"],
    onStart:     (ses, data, calc) => {
        if (ses.role != "S" || data.pass.length < 5) return "SELECT $1, $2, $3, $4, $5";
        calc.passcr = crypto.createHash("md5").update(data.pass).digest("hex");
        calc.fullname = (data.name + " " + data.lastname);
    },
    sqlParams: [
        rpg.param("post", "rut"), rpg.param("calc", "passcr"), rpg.param("calc", "fullname"),
        rpg.param("post", "mail"), rpg.param("post", "sex")
    ],
    onEnd: (req, res) => {
        res.redirect("login?rc=1");
    }
}));


router.post("/get-my-name", rpg.singleSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT name,
        role,
        lang,
        mail
    FROM users
    WHERE id = $1
    `,
    sesReqData: ["uid"],
    sqlParams:  [rpg.param("ses", "uid")]
}));


router.post("/update-lang", rpg.singleSQL({
    dbcon: pass.dbcon,
    sql:   `
    UPDATE users
    SET lang = $1
    WHERE id = $2
    `,
    sesReqData:  ["uid"],
    postReqData: ["lang"],
    sqlParams:   [rpg.param("post", "lang"), rpg.param("ses", "uid")]
}));


router.post("/resetpassword", (req, res) => {
    var SES_CONFIG = {
        accessKeyId:     pass.accessKeyId,
        secretAccessKey: pass.secretAccessKey,
        region:          "us-east-1",
    };
    var AWS_SES = new AWS.SES(SES_CONFIG);


    if (req.body.lenguaje == "Español") {
        const resetPasswordEmailTemplate = fs.readFileSync(__dirname + '/../public/email-templ/reset-password/reset-password-es.html', 'utf8');
        const data = "Solicitud de restablecimiento de contraseña";
    } else {
        const resetPasswordEmailTemplate = fs.readFileSync(__dirname + '/../public/email-templ/reset-password/reset-password-en.html', 'utf8');
        const data = "Reset Password Request";
    }
    const emailTemplate = handlebars.compile(resetPasswordEmailTemplate);
    const html = emailTemplate({ userName: req.body.user, passwordResetLink: "http://localhost:8501/passreset" });
    
    async function mail(user_mail, subject) {
        const params = {
            Source: "no-reply@iccuandes.org",
            Destination: {
                ToAddresses: [
                    user_mail,
                ]},
            Message: {
                Subject: {
                    Data: subject,
                },
                Body: {
                    Html: {
                        Data: html,
                    },
                },
            },
        };

        AWS_SES.sendEmail(params).promise()
            .then(function() {
                res.redirect("login?rc=3");
            })
            .catch(function() {});
        
    }
    mail(req.body.email, subject);
});


router.get("/new-pass/:token", (req, res) => {
    res.render("newpass", { token: req.params.token });
});


router.post("/newpassword", rpg.execSQL({
    dbcon: pass.dbcon,
    sql:   `
    UPDATE users AS u
    SET pass = $1
    FROM pass_reset AS r
    WHERE r.token = $2
        AND r.mail = u.mail
    `,
    postReqData: ["token", "pass"],
    onStart:     (ses, data, calc) => {
        if (data.pass.length < 5) return "SELECT 1";
        calc.passcr = crypto.createHash("md5").update(data.pass).digest("hex");
    },
    sqlParams: [rpg.param("calc", "passcr"), rpg.param("post", "token")],
    onEnd:     (req, res) => {
        res.redirect("login?rc=4");
    }
}));


router.post("/super-login-as", (req, res) => {
    if (req.session.role != "S" || req.body.uid == null) {
        res.send({ status: "error" });
    }
    else {
        req.session.prevUid = req.session.uid;
        req.session.uid = req.body.uid;
        req.session.role = "P";
        req.session.ses = null;
        res.send({ status: "ok" });
    }
});


router.get("/super-logout", (req, res) => {
    if (req.session.prevUid == null) {
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
    if (req.session.role == "S" || req.session.prevUid != null) {
        res.send({ status: "ok" });
    }
    else {
        res.send({ status: "error" });
    }
});


router.get("/is-institution", (req, res) => {
    if (req.session.role == "I" || req.session.prevUid != null) {
        res.send({ status: true });
    }
    else {
        res.send({ status: false });
    }
});


module.exports = router;


router.get("/profile", (req, res) => {
    res.render("profile");
});


router.post("/changepassword", (req, res) => {
    if (req.body.pass == req.body["pass-conf"]) {
        var db = getDBInstance(pass.dbcon);
        var passcr = crypto.createHash("md5").update(req.body.pass).digest("hex");
        var sql = `
        UPDATE users
        SET pass = '${passcr}'
        WHERE mail = '${req.body.mail}'
        `;
        var qry;
        // var sqlParams = [passcr, req.body.mail]; // unused
        qry = db.query(sql);
        qry.on("end", function () {
            res.redirect("login?rc=4");
        });
        qry.on("error", function () {
            res.end('{"status":"err"}');
        });
    }
});


router.post("/create-multicounts",(req,res)=> {
    if (req.body.data != "") {
        var accounts = req.body.data.split("\r\n");
        var db = getDBInstance(pass.dbcon);
        for (var i = 0; i < accounts.length; i++) {
            var account_data = accounts[i].split(",");
            var sql = `
            SELECT * FROM users
            WHERE mail = '${account_data[0]}'
            LIMIT 1
            `;
            db.query(sql, (err,resu) => {
                if (resu.rowCount == 0) {
                    if (account_data.length > 1) {
                        var sql = `
                        INSERT INTO temporary_users(rut, pass, name, mail, sex, ROLE, token)
                        VALUES ($1,$2,$3,$4,$5,'A',$6)
                        `;
                        var qry;
                        var passcr = crypto.createHash("md5").update(account_data[1]).digest("hex");
                        var name = account_data[1];
                        if(account_data.length == 3){
                            name = account_data[2]; 
                        }
                        if(account_data.length == 4){
                            name = account_data[2] + " "+ account_data[3];
                        }
                        var token = crypto.createHash("md5").update(account_data[0]).digest("hex");
                        var user_mail = account_data[0];
                        var sqlParams = ["11111111-1", passcr, name, account_data[0], "O",token];
                        var sqlarr = smartArrayConvert(sqlParams);
                        qry = db.query(sql, sqlarr);

                        qry.on("end", function () {
                            var SES_CONFIG = {
                                accessKeyId:     pass.accessKeyId,
                                secretAccessKey: pass.secretAccessKey,
                                region:          "us-east-1",
                            };
                            var AWS_SES = new AWS.SES(SES_CONFIG);
                            var emailTemplate, subject; 
                            // Still needed to figure out how to send this mail in different languages.
                            /*
                            if (req.body.lenguaje == "Español") {   
                                // versión en español
                                emailTemplate = fs.readFileSync(__dirname + '/../public/email-templ/create-multicounts/es-create-multicounts.html', 'utf8');
                                subject = "Resolucion de cuenta Institucional";
                            }
                            
                            else {
                                // versión en inglés
        
                            }
                            */
                            emailTemplate = fs.readFileSync(__dirname + '/../public/email-templ/create-multicounts/es-create-multicounts.html', 'utf8');
                            subject = "Resolucion de cuenta Institucional";
                            const template = handlebars.compile(emailTemplate);
                            const html = template({name: name});
                            async function mail() {
                                var params ={
                                    Source:      "no-reply@iccuandes.org",
                                    Destination: {
                                        ToAddresses: [
                                            user_mail,
                                        ]},
                                    Message: {
                                        Subject: {
                                            Data: subject
                                        },
                                        Body: {
                                            Text: {
                                                Data: ""
                                            },
                                            Html: {
                                                Data: html
                                            }
                                        }
                                    } 
                                };
                                AWS_SES.sendEmail(params).promise()
                                    .then(function() {})
                                    .catch(function() {});
                            }
                            mail();
                        });
                        qry.on("error", function(err){
                            res.end(err);
                        });
                    }

                }
            });
        }
        res.redirect("home");
    }
});


router.post("/activate_user", (req) => {
    var db = getDBInstance(pass.dbcon);
    var sql = `
    SELECT *
    FROM temporary_users
    WHERE token = '${req.body.token}'
    LIMIT 1
    `;
    var qry;
    var result;
    qry = db.query(sql,(err,rest) =>{
        if(rest != null){
            result = rest.rows[0];
            var sql = `
            INSERT INTO users(rut, pass, name, mail, sex, ROLE)
            VALUES ($1,$2,$3,$4,$5,'A')
            `;
            var qry;
            var sqlParams = [result.rut, result.pass, result.name, result.mail, result.sex];
            var sqlarr = smartArrayConvert(sqlParams);
            qry = db.query(sql, sqlarr);
            qry.on("end", function () {
                var sql = `
                DELETE
                FROM temporary_users
                WHERE token = '${req.body.token}'
                `;
                db.query(sql,() =>{});
            });
        }
    });
    qry.on("end",function(){});
});


router.post("/deleteacc", (req, res) => {
    var db = getDBInstance(pass.dbcon);
    var sql = `
    UPDATE users
    SET disabled = true
    WHERE id ='${req.session.uid}'
    `;
    var newmail;
    var sql2;
    db.query(sql, () => {});
    try {
        newmail = Date.now().toString() + req.session.passport.user.email;
        sql2 = `
        UPDATE users
        SET mail = '${newmail}'
        WHERE id = '${req.session.uid}'
        `;
        db.query(sql2, () => {});
    }
    catch {
        newmail = Date.now().toString() + req.body.mail;
        sql2 = `
        UPDATE users
        SET mail = '${newmail}'
        WHERE id = '${req.session.uid}'
        `;
        db.query(sql2, () => {});
    }
    finally {
        res.redirect("login");
    }
});


router.post("/get_same_users", (req, res) => {
    var domains = req.body.postdata2.split(",");
    var db = getDBInstance(pass.dbcon);
    var resultados = [];
    var result;
    for (var i = 0; i < domains.length; i++) {
        var sql = `
        SELECT *
        FROM users
        WHERE mail LIKE '%${domains[i]}'
        `;
        var qry = db.query(sql, (err,res) => {
            if (res != null) {
                result = res.rows;
                resultados.push(result);
            }
        });
    }  
    qry.on("end",function(){
        res.json({"data": result});
    });
});


router.post("/get_mail_domains", (req, res) => {
    var db = getDBInstance(pass.dbcon);
    var sql = `
    SELECT *
    FROM mail_domain
    WHERE institutionid = '${req.body}'
    `;
    var qry;
    var result;
    var lista = "";
    qry = db.query(sql, (err,res) => {
        if (res != null) {
            result = res.rows;
            for(var i = 0; i < result.length;i++){
                if (i == result.length-1){
                    lista += result[i].domain_name;
                }
                else {
                    lista += result[i].domain_name+",";
                }
            }
        }
    });
    qry.on("end",function(){
        res.json({"data": lista});
    });
});


router.post("/getuserinfo", (req, res) => {
    var db = getDBInstance(pass.dbcon);
    var sql = `
    SELECT *
    FROM users
    WHERE id = '${req.session.uid}'
    LIMIT 1
    `;
    var qry;
    var result;
    qry = db.query(sql, (err,res) => {
        if (res != null)
            result = res.rows;
    });
    qry.on("end", function () {
        res.json({ "data": result });
    });
});


router.post("/getdomains", (req, res) => {
    var db = getDBInstance(pass.dbcon);
    var sql = `
    SELECT *
    FROM institution
    WHERE userid = '${req.session.uid}'
    `;
    var qry;
    var result;
    qry = db.query(sql,(err,res) =>{
        if(res != null) {
            result = res.rows;
        }
    });
    qry.on("end", function(){
        res.json({"data": result});
    });
});


router.post("/make_prof", (req) => {
    var db = getDBInstance(pass.dbcon);
    var sql = `
    UPDATE users
    SET role = 'P'
    WHERE mail = '${req.body.mail}'
    `;
    var qry;
    qry = db.query(sql,() =>{});
    qry.on("end",function(){});
});


router.post("/make_alum", (req) => {
    var db = getDBInstance(pass.dbcon);
    var sql = `
    UPDATE users
    SET role = 'A'
    WHERE mail = '${req.body.mail}'
    `;
    var qry;
    qry = db.query(sql,() =>{});
    qry.on("end",function(){});
});


router.post("/get_temporary_institutions", (req, res) => {
    var db = getDBInstance(pass.dbcon);
    var sql = `
    SELECT *
    FROM temporary_institution
    `;
    var qry;
    var result;
    qry = db.query(sql,(err,rest) =>{
        if(rest != null){
            result = rest;
        }
    });
    qry.on("end",function(){
        res.json({"data": result});
    });
});


router.post("/get_institutions", (req, res) => {
    var db = getDBInstance(pass.dbcon);
    var sql = `
    SELECT *
    FROM institution
    `;
    var qry;
    var result;
    qry = db.query(sql,(err,rest) =>{
        if(rest != null){
            result = rest;
        }
    });
    qry.on("end",function(){
        res.json({"data": result});
    });
});


router.post("/get_temp_institution_info", (req, res) => {
    var db = getDBInstance(pass.dbcon);
    var sql = `
    SELECT *
    FROM temporary_institution
    WHERE id = '${req.body.inst_id}'
    `;
    var qry;
    var result;
    qry = db.query(sql,(err,rest) =>{
        if(rest != null){
            result = rest;
        }
    });
    qry.on("end",function(){
        res.json({"data": result});
    });
});


router.post("/get_temp_admin_info", (req, res) => {
    var db = getDBInstance(pass.dbcon);
    var sql = `
    SELECT *
    FROM temporary_users
    WHERE id = '${req.body.userid}'
    `;
    var qry;
    var result;
    qry = db.query(sql,(err,rest) =>{
        if(rest != null){
            result = rest;
        }
    });
    qry.on("end",function(){
        res.json({"data": result});
    });
});


router.post("/get_institution_info", (req, res) => {
    var db = getDBInstance(pass.dbcon);
    var sql = `
    SELECT *
    FROM institution
    WHERE id = '${req.body.inst_id}'
    `;
    var qry;
    var result;
    qry = db.query(sql,(err,rest) =>{
        if(rest != null){
            result = rest;
        }
    });
    qry.on("end",function(){
        res.json({"data": result});
    });
});


router.post("/get_admin_info", (req, res) => {
    var db = getDBInstance(pass.dbcon);
    var sql = `
    SELECT *
    FROM users
    WHERE id = '${req.body.userid}'
    `;
    var qry;
    var result;
    qry = db.query(sql,(err,rest) =>{
        if(rest != null){
            result = rest;
        }
    });
    qry.on("end",function(){
        res.json({"data": result});
    });
});


router.post("/get_institution_domains", (req, res) => {
    var db = getDBInstance(pass.dbcon);
    var sql = `
    SELECT *
    FROM mail_domain
    WHERE institutionid = '${req.body.institutuinid}'
    `;
    var qry;
    var result;
    qry = db.query(sql,(err,rest) =>{
        if(rest != null){
            result = rest;
        }
    });
    qry.on("end",function(){
        res.json({"data": result});
    });
});


router.post("/accept_institution", (req, res) => {
    var db = getDBInstance(pass.dbcon);
    var sql = `
    SELECT *
    FROM temporary_institution
    WHERE id = '${req.body.institutionid}'
    LIMIT 1
    `;
    var qry;
    var result;
    var user_mail;
    var fullname;

    qry = db.query(sql,(err,rest) =>{
        if(rest != null){
            result = rest.rows[0];
            var sql = `
            SELECT *
            FROM temporary_users
            WHERE id = '${req.body.userid}'
            LIMIT 1
            `;
            var result2;

            db.query(sql, (err,resu) => {
                if (rest != null) {
                    result2 = resu.rows[0];
                    var sql = `
                    INSERT INTO users(rut, pass, name, mail, sex, ROLE)
                    VALUES ($1,$2,$3,$4,$5,'I')
                    `;
                    var qry;
                    var passcr = result2.pass;
                    fullname = result2.name;
                    var sqlParams = [result2.rut, passcr, fullname, result2.mail, result2.sex];
                    var sqlarr = smartArrayConvert(sqlParams);
                    qry = db.query(sql, sqlarr);

                    qry.on("end", function () {
                        var sql = `
                        SELECT *
                        FROM users
                        WHERE mail = '${result2.mail}'
                        LIMIT 1
                        `;
                        var result3;
                        user_mail = result2.mail;
                        db.query(sql,(err,resul) =>{
                            result3 = resul.rows[0];
                            var sql = `
                            INSERT INTO institution(
                                userid, institution_name, num_students, country, POSITION
                            )
                            VALUES ($1,$2,$3,$4,$5)
                            `;
                            var qry;
                            var sqlParams = [
                                result3.id, result.institution_name, result.num_students,
                                result.country, result.position
                            ];
                            var sqlarr = smartArrayConvert(sqlParams);
                            qry = db.query(sql, sqlarr);

                            qry.on("end", function () {
                                var sql = `
                                SELECT *
                                FROM institution
                                WHERE institution_name = '${result.institution_name}'
                                LIMIT 1
                                `;
                                var result5;db.query(sql,(err,res_inst) =>{
                                    if(res_inst != null){
                                        result5 = res_inst.rows[0];
                                        var domains = result.mail_domains.split(",");
                                        for(var i = 0; i < domains.length ;i++){
                                            var sql = `
                                            INSERT INTO mail_domain(institutionid, domain_name)
                                            VALUES ($1,$2)
                                            `;
                                            var qry;
                                            var sqlParams = [result5.id, domains[i] ];
                                            var sqlarr = smartArrayConvert(sqlParams);
                                            qry = db.query(sql, sqlarr);
                                        }

                                        qry.on("end", function () {                   
                                            var sql = `
                                            DELETE
                                            FROM temporary_institution
                                            WHERE id = '${req.body.institutionid}'
                                            `;
                                            var qry;
                                            qry = db.query(sql,() =>{});

                                            qry.on("end",function(){
                                                var sql = `
                                                DELETE
                                                FROM temporary_users
                                                WHERE id = '${req.body.userid}'
                                                `;
                                                var qry;
                                                qry = db.query(sql,() =>{});
                                                qry.on("end", function() {
                                                    var SES_CONFIG = {
                                                        accessKeyId:     pass.accessKeyId,
                                                        secretAccessKey: pass.secretAccessKey,
                                                        region:          "us-east-1",
                                                    };
                                                    var AWS_SES = new AWS.SES(SES_CONFIG);
                                                    // Still needed to figure out how to send this mail in different languages.
                                                    /*
                                                    if (req.body.lenguaje == "Español") {   
                                                        // versión en español
                                                        emailTemplate = fs.readFileSync(__dirname + '/../public/email-templ/accept-inst/accept-inst.html', 'utf8');
                                                        subject = "Resolucion de cuenta Institucional";
                                                    }
                                                    
                                                    else {
                                                        // versión en inglés
                                
                                                    }
                                                    */
                                                    emailTemplate = fs.readFileSync(__dirname + '/../public/email-templ/accept-inst/accept-inst.html', 'utf8');
                                                    subject = "Resolucion de cuenta Institucional";
                                                    const template = handlebars.compile(emailTemplate);
                                                    const html = template({name: name});
                                                    async function mail() {
                                                        var params = {
                                                            Source:      "no-reply@iccuandes.org",
                                                            Destination: {
                                                                "ToAddresses": [
                                                                    user_mail,
                                                                ]},
                                                            Message: {
                                                                "Subject": {
                                                                    "Data": subject
                                                                },
                                                                "Body": {
                                                                    "Text": {
                                                                        "Data": ""
                                                                    },
                                                                    "Html": {
                                                                        "Data": html
                                                                    }
                                                                }
                                                            } 
                                                        };
                                                        AWS_SES.sendEmail(params).promise()
                                                            .then(function() {})
                                                            .catch(function() {});
                                                    }
                                                    mail();
                                                });
                                            });
                                        });
                                    }
                                });
                            });
                        });
                    });
                }
            });
        }
    });
    qry.on("end",function(){
        res.redirect("home");
    });
});


router.post("/reject_institution", (req, res) => {
    var db = getDBInstance(pass.dbcon);
    var sql = `
    DELETE
    FROM temporary_institution
    WHERE id = '${req.body.institutionid}'
    `;
    var qry;
    var user_mail;
    qry = db.query(sql, () => {});
    qry.on("end", function() {
        var sql = `
        SELECT *
        FROM temporary_users
        WHERE id = '${req.body.userid}'
        LIMIT 1
        `;
        var qry;
        var fullname;
            
        qry = db.query(sql, (err,resu) => {
            if (resu != null) {
                fullname = resu.rows[0].name;
                user_mail = resu.rows[0].mail;
            }
        });
        sql = `
        DELETE
        FROM temporary_users
        WHERE id = '${req.body.userid}'
        `;
        qry = db.query(sql, () =>{});
        qry.on("end",function(){
            var SES_CONFIG = {
                accessKeyId:     pass.accessKeyId,
                secretAccessKey: pass.secretAccessKey,
                region:          "us-east-1",
            };
            var AWS_SES = new AWS.SES(SES_CONFIG);
            async function mail() {
                var params ={
                    Source:      "no-reply@iccuandes.org",
                    Destination: {
                        "ToAddresses": [
                            user_mail,
                        ]
                    },
                    Message: {
                        "Subject": {
                            "Data": "Resolucion de cuenta Institucional"
                        },
                        "Body": {
                            "Text": {
                                "Data": ""
                            },
                            "Html": {
                                "Data": `
<div style="
    max-width: 640px;
    display: block;
    padding: 4px 24px 20px 24px;
    border-color: gray;
    border-width: 10px;
    border-width: 5px;
    border-style: solid;
    margin: 20px auto;
">
    <div style="
        text-align: center;
        margin-bottom: 2em;
        margin-top: 2em;
    ">
        <img src="/img/ethicapp-logo.svg" alt="Ethicapp">
    </div>
    Hola ${fullname}!
    <br>
    <br>
    Lamentamos que tu solicitud de creación de cuenta institucional fue rechazada. Esto pudo deberse
    a que tu institución ya se encuentra registrada en EthicApp, o a información faltante en el
    proceso de registro.
    <br>
    <br>
    Puedes contactarnos a estudios-icc (at) miuandes.cl para buscar solución al problema
    <br>
    <br>
    Un cordial saludo,
    <br>
    <br>
    Creadores de EthicApp
</div>
                                `
                            }
                        }
                    } 
                };
                AWS_SES.sendEmail(params).promise()
                    .then(function() {})
                    .catch(function() {});
            }
            mail();
            res.redirect("home");
        });
    });
});


router.post("/get_all_users", (req, res) => {
    var db = getDBInstance(pass.dbcon);
    var sql = `
    SELECT *
    FROM users
    `;
    var qry;
    var result;
    qry = db.query(sql,(err,rest) =>{
        if(rest != null){
            result = rest;
        }
    });
    qry.on("end",function(){
        res.json({"data": result});
    });
});
