"use strict";

const fetch = require("node-fetch");
let express = require("express");
let router = express.Router();
let rpg = require("../db/rest-pg");
let pass = require("../config/keys-n-secrets");
let crypto = require("crypto");
let mailer = require("nodemailer");
const passport = require("passport");
require("./passport-setup");
var AWS = require("aws-sdk");
var pg = require("pg");
var DB = null;
require("../../app");
router.use(passport.initialize());
router.use(passport.session());

const Yup = require("yup");

const registerSchema = Yup.object().shape({
    name: Yup.string().required("requiredName"),
    lastname: Yup.string().required("requiredLastName"),
    email: Yup.string().email("invalidEmail").required("requiredEmail"),
    pass: Yup.string().min(6, "minLengthPassword").required("requiredPassword"),
    sex: Yup.string().oneOf(["M", "F", "O"], "invalidSex").required("requiredSex"),
    g_recaptcha_response: Yup.string().required("requiredCaptcha")
});

const teacherAccountRequestSchema = Yup.object().shape({
    name: Yup.string().required("requiredName"),
    lastname: Yup.string().required("requiredLastName"),
    email: Yup.string().email("invalidEmail").required("requiredEmail"),
    pass: Yup.string().min(6, "minLengthPassword").required("requiredPassword"),
    sex: Yup.string().oneOf(["M", "F", "O"], "invalidSex").required("requiredSex"),
    institution: Yup.string().required("requiredInstitution"),
    g_recaptcha_response: Yup.string().required("requiredCaptcha")
});


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
    req.logout(function (err) {
        if (err) { console.log(err); }
        req.session.uid = null;
        req.session.role = null;
        req.session.ses = null;
        req.session.prevUid = null;
        res.redirect("login");
    });
});

router.post("/login", (req, res, next) => {
    passport.authenticate("local", (err, user) => {
        
        const {source} = req.body;
        if (source==="admin-panel") {
            if (!user) {
                return res.status(200).json({ sessionID: "ErrorCredential" });
            }

            if (user["role"]!="S") {
                return res.status(200).json({ sessionID: "Unauthorized" });
            }

            const sessionID = req.sessionID;
            return res.status(200).json({ sessionID });
        }

        if (err) {
            return next(err);
        }
        if (!user) {
            return res.redirect("login?rc=2");
        }

        var is_teacher = 0;
        if (user["role"]=="P" || user["role"]=="S") {
            is_teacher=1;
        }
        
        var db = getDBInstance(pass.dbcon);
        const sqlQuery = `SELECT UpdateOrInsertLoginRecord(${is_teacher})`;
        db.query(sqlQuery,(dbErr) =>{
            if (dbErr) {
                return next(dbErr);
            }
        });

        req.logIn(user, (err) => {
            if (err) {
                return next(err);
            }
        
            return res.redirect("/seslist");
        });
    })(req, res, next);
});


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
  (req, res) => {
    // Run the database query and wait for it to complete
    runDbQuery()
      .then(() => {
        // Successful login record update/inserted
        // You can add additional logic here if needed
        res.redirect("/seslist");
      })
      .catch((error) => {
        console.error(error);
        res.redirect("/error");
      });
  }
);

function runDbQuery() {
    return new Promise((resolve, reject) => {
      var db = getDBInstance(pass.dbcon);
      const sqlQuery = "SELECT UpdateOrInsertLoginRecord(0)";
      db.query(sqlQuery, (dbErr) => {
        if (dbErr) {
          reject(dbErr);
        } else {
          resolve();
        }
      });
    });
  }

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


router.post("/register", async (req, res) => {
    try {
        await registerSchema.validate(req.body); // Validar el cuerpo de la solicitud

        const response_key = req.body["g_recaptcha_response"];
        const secret_key = pass.Captcha_Secret;

        const response = await fetch(
            "https://www.google.com/recaptcha/api/siteverify?" +
            `secret=${secret_key}&response=${response_key}`
        );
        const data = await response.json();

        if (data.success) {
            try {
                const passcr = crypto.createHash("md5").update(req.body.pass).digest("hex");
                const fullname = `${req.body.name} ${req.body.lastname}`;
                const db = getDBInstance(pass.dbcon);

                const sql = `
                    INSERT INTO users (rut, pass, name, mail, sex, ROLE) 
                    VALUES ($1, $2, $3, $4, $5, $6)
                `;
                const values = ['N/A', passcr, fullname, req.body.email, req.body.sex, 'A'];

                db.query(sql, values, (err) => {
                    if (err) {
                        if (err.code === '23505' && err.detail.includes('Key (mail)')) {
                            return res.status(409).json({
                                success: false,
                                message: "El correo electrónico ya está registrado.",
                            });
                        }

                        console.error("DB error", err);
                        return res.status(500).json({
                            success: false,
                            message: "Error al registrar el usuario en la base de datos.",
                        });
                    } else {
                        const sqlQuery = "SELECT UpdateOrInsertCreateAccountRecord(0)";
                        db.query(sqlQuery, (dbErr) => {
                            if (dbErr) {
                                return res.status(500).json({
                                    success: false,
                                    message: "Error al actualizar o insertar registro de cuenta.",
                                });
                            }

                            return res.status(200).json({
                                success: true,
                                message: "Usuario registrado exitosamente.",
                            });
                        });
                    }
                });
            } catch (err) {
                console.error("Error al registrar el usuario", err);
                return res.status(500).json({
                    success: false,
                    message: "Error al registrar el usuario.",
                });
            }
        } else {
            console.error("Error recaptcha", data);
            return res.status(400).json({
                success: false,
                message: "Error en la verificación del captcha.",
            });
        }
    } catch (error) {
        console.error("Error en post /register", error);
        return res.status(500).json({
            success: false,
            message: "Error en el servidor.",
        });
    }
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
                                async function mail() {
                                    var params ={
                                        Source:      "no-reply@iccuandes.org",
                                        Destination: {
                                            "ToAddresses": [
                                                user_mail,
                                            ]},
                                        Message: {
                                            "Subject": {
                                                "Data": "Solicitud de cuenta Institucional"
                                            },
                                            "Body": {
                                                "Text": {
                                                    "Data": ""},
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
                                    <img src="/assets/images/logos/ethicapp-logo.svg" 
                                    alt="Ethicapp">
                                </div>
                                En un plazo de 24 a 48 horas hábiles quedará habilitada tu cuenta.
                                <br>
                                Te enviaremos un correo con los pasos a seguir.
                            </div>
                                                `}
                                            }
                                        } 
                                    };
                                    var params2 = {
                                        Source:      "no-reply@iccuandes.org",
                                        Destination: {
                                            "ToAddresses": [
                                                user_mail,
                                            ]},
                                        Message: {
                                            "Subject": {
                                                "Data": "Test"
                                            },
                                            "Body": {
                                                "Text": {
                                                    "Data": "Mail de prueba"},
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
                                    <img src="/assets/images/logos/ethicapp-logo.svg" 
                                    alt="Ethicapp">
                                </div>
                                Within 24 to 48 business hours your account will be enabled.
                                <br>
                                We will send you an email with the steps to follow.
                            </div>`
                                                }
                                            }
                                        } 
                                    };
                                    if (country == "Chile") { // ver como decidir en que idioma se manda el mail
                                        AWS_SES.sendEmail(params).promise()
                                            .then(function() {})
                                            .catch(function() {});
                        
                                    }
                                    else {
                                        AWS_SES.sendEmail(params2).promise()
                                            .then(function() {})
                                            .catch(function() {});
                                    }
                                }
                                mail();
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


router.get("/teacher_account_requests", rpg.multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT *
    FROM teacher_account_requests
    ORDER BY date DESC
    `,
}));


router.get("/teacher_account_requests/:id", (req, res) => {
    rpg.singleSQL({
        dbcon: pass.dbcon,
        sql:   `
          SELECT *
          FROM teacher_account_requests
          WHERE id = $1
      `,
        onStart: (ses, data, calc) => {
            calc.id = req.params.id;
        },
        sqlParams: [rpg.param("calc", "id")]
    })(req, res);
});

router.post("/teacher_account_request", async (req, res) => {
    try {
        await teacherAccountRequestSchema.validate(req.body); // Validar el cuerpo de la solicitud
        
        let response_key = req.body["g_recaptcha_response"];
        let secret_key = pass.Captcha_Secret;
        let captchaResponse = await fetch(
            "https://www.google.com/recaptcha/api/siteverify?" +
            `secret=${secret_key}&response=${response_key}`
        );
        let captchaData = await captchaResponse.json();
        console.log("Captcha log", captchaData);

        if (captchaData.success) {
            var passcr = crypto.createHash("md5").update(req.body.pass).digest("hex");
            var fullname = `${req.body.name} ${req.body.lastname}`;
            var db = getDBInstance(pass.dbcon);
            var existingUserRole = await checkIfUserExists(db, req.body.email);

            if (existingUserRole === false) {
                await insertTeacherAccountRequest(db, req.body.rut, passcr, fullname, req.body.email, req.body.sex, req.body.institution, 0, false);
                return res.status(200).json({ success: true, message: "Solicitud de cuenta de profesor enviada." });
            } else {
                if (existingUserRole === "A") {
                    await insertTeacherAccountRequest(db, req.body.rut, passcr, fullname, req.body.email, req.body.sex, req.body.institution, 0, true);
                    return res.status(200).json({ success: true, message: "Solicitud de modificación de cuenta a profesor enviada." });
                } else {
                    return res.status(409).json({ success: false, message: "El correo electrónico ya está registrado." });
                }
            }
        } else {
            console.log("Error en la verificación del captcha.");
            return res.status(400).json({ success: false, message: "Error en la verificación del captcha." });
        }
    } catch (err) {
        console.error("Error en el controlador:", err);
        return res.status(500).json({ success: false });
    }
});

async function checkIfUserExists(db, email) {
    return new Promise((resolve, reject) => {
        const sql = `
        SELECT *
        FROM users
        WHERE mail = $1
        `;

        db.query(sql, [email], (err, qry_res) => {
            if (err) {
                reject(err);
            } else {
                if (qry_res.rowCount > 0) {
                    resolve(qry_res.rows[0].role);
                } else {
                    resolve(false);
                }
            }
        });
    });
}

async function insertTeacherAccountRequest(db, rut, pass, name, mail, sex, institution, status, upgrade_flag) {
    return new Promise((resolve, reject) => {
        const sql = `
        INSERT INTO teacher_account_requests(rut, pass, name, mail, gender, institution, status, upgrade_flag)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `;

        const values = ['N/A', pass, name, mail, sex, institution, status, upgrade_flag];

        db.query(sql, values, (err, qry_res) => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

router.put("/teacher_account_requests/:id", async (req, res) => {
    try {
        const newStatus = req.body.status;

        if (newStatus === "2") {

            await rpg.execSQL({
                dbcon: pass.dbcon,
                sql:   `
                    UPDATE teacher_account_requests
                    SET status = $1, reject_reason = $2
                    WHERE id = $3
                `,
                onStart: (ses, data, calc) => {
                    calc.id = req.params.id;
                },
                postReqData: ["status", "reject_reason"],
                sqlParams:   [rpg.param("post", "status"), rpg.param("post", "reject_reason"), rpg.param("calc", "id")]
            })(req, res);

        }
        else {
            // Actualizar el estado en la base de datos
            await rpg.execSQL({
                dbcon: pass.dbcon,
                sql:   `
                    UPDATE teacher_account_requests
                    SET status = $1
                    WHERE id = $2
                `,
                onStart: (ses, data, calc) => {
                    calc.id = req.params.id;
                },
                postReqData: ["status"],
                sqlParams:   [rpg.param("post", "status"), rpg.param("calc", "id")]
            })(req, res);

            if (newStatus === "1") {
                // Consulta para obtener datos del profesor
                const teacherDataQuery = `
                    SELECT *
                    FROM teacher_account_requests
                    WHERE id = $1
                `;

                var db = getDBInstance(pass.dbcon);

                const { rows } = await db.query(teacherDataQuery, [req.params.id]);

                if (rows.length === 0) {
                    return res.status(404).json({ error: "Profesor no encontrado" });
                }

                const teacherData = rows[0];

                // Consulta para insertar el profesor como usuario
                const insertUserQuery = `
                    INSERT INTO users(rut, pass, name, mail, sex, ROLE)
                    VALUES ($1, $2, $3, $4, $5, 'P')
                `;

                const userParams = [
                    teacherData.rut,
                    teacherData.pass,
                    teacherData.name,
                    teacherData.mail,
                    teacherData.gender
                ];

                await db.query(insertUserQuery, userParams);

                // Enviar una respuesta de éxito
                res.status(200).json({ message: "Solicitud aceptada y profesor agregado como usuario" });
            }
        }
    } catch (error) {
        console.error("Error en el controlador:", error);

        // Enviar una respuesta de error
        res.status(500).json({ error: "Error interno del servidor" });
    }
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
    async function mail() {
        var params = {
            Source:      "no-reply@iccuandes.org",
            Destination: {
                "ToAddresses": [
                    req.body.user,
                ]},
            Message: {
                "Subject": {
                    "Data": "Test"
                },
                "Body": {
                    "Text": {
                        "Data": "Mail de prueba"},
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
                                <img src="/assets/images/logos/ethicapp-logo.svg" alt="Ethicapp">
                            </div>
                            Hola
                            <br>
                            <br>
                            ¿Has perdido tu contraseña? Puedes restablecerla a continuación:
                            <br>
                            <br>
                            <div style="
                                text-align: center;
                            ">
                                <a href="http://localhost:8080/passreset">
                                    <button style="
                                        background-color: #2649EC;
                                        border-color: #102AA0;
                                        color: white;
                                    ">
                                        Restablecer contraseña
                                    </button>
                                </a>
                            </div>
                            <br>
                            <br>
                            Recibe un cordial saludo,
                            <br>
                            <br>
                            Creadores de EthicApp
                        </div>
                        `
                    }
                }
            } 
        };

        var params2 = {
            Source:      "no-reply@iccuandes.org",
            Destination: {
                "ToAddresses": [
                    req.body.user,
                ]},
            Message: {
                "Subject": {
                    "Data": "Test"
                },
                "Body": {
                    "Text": {
                        "Data": "Mail de prueba"},
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
                                <img src="/assets/images/logos/ethicapp-logo.svg" alt="Ethicapp">
                            </div>
                            Hi
                            <br>
                            <br>
                            Have you lost your password? You can restore it in the following link:
                            <br>
                            <br>
                            <div style="text-align: center;">
                                <a href="http://localhost:8080/passreset">
                                    <button style="
                                        background-color: #2649EC;
                                        border-color: #102AA0;
                                        color: white;
                                    ">
                                        Restore password
                                    </button>
                                </a>
                            </div>
                            <br>
                            <br>
                            Greetings
                            <br>
                            <br>
                            Creators of EthicApp
                        </div>
                        `
                    }
                }
            } 
        };
        if (req.body.lenguaje == "Español") {
            AWS_SES.sendEmail(params).promise()
                .then(function() {
                    res.redirect("login?rc=3");
                })
                .catch(function() {});
        }
        else {
            AWS_SES.sendEmail(params2).promise()
                .then(function() {
                    res.redirect("login?rc=3");
                })
                .catch(function() {});
        }
    }
    mail();
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
                            async function mail() {
                                var params ={
                                    Source:      "no-reply@iccuandes.org",
                                    Destination: {
                                        "ToAddresses": [
                                            user_mail,
                                        ]},
                                    Message: {
                                        "Subject": {
                                            "Data": "Resolucion de cuenta Institucional"},
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
        <img src="/assets/images/logos/ethicapp-logo.svg" alt="Ethicapp">
    </div>
    Hola, ${name}
    <br>
    Bienvenido a EthicApp. Has sido invitado a incorporarte a EthicApp por
    [nombre usuario institucional] de [institución]. Para aceptar la invitación, pincha el siguiente
    botón:
    <br>
    <br>
    <div style="text-align: center;">
        <a href="http://localhost:8080/login?rc=5&&tok='+token+'">
            <button style="
                background-color: #2649EC;
                border-color: #102AA0;
                color: white;
            ">
                Activar tu Cuenta
            </button>
        </a>
    </div>
    <br>
    <br>
    Te recordamos que en EthicApp usamos los datos generados por los usuarios con fines de
    investigación.
    <br>
    <br>
    Garantizamos la absoluta confidencialidad de los datos, y que los datos no los entregamos a
    terceras partes. En nuestras investigaciones reportamos los datos siempre a nivel agregado y
    nunca a nivel individual, ni revelando la identidad de los participantes. Las actividades
    basadas en EthicApp no presentan ningún riesgo físico o psicológico a docentes o a estudiantes.
    <br>
    <br>
    EthicApp se reserva el derecho de suspender o terminar cuentas de usuario en caso que se detecte
    uso indebido del servicio.
    <br>
    <br>
    <strong>
        Activando tu cuenta a través del botón de arriba manifiestas tu aceptación de las
        condiciones antes descritas.
    </strong>
    <br>
    <br>
    Te deseamos el mayor éxito en tus actividades con EthicApp.
    <br>
    <br>
    Creadores de EthicApp
    <br>
    <br>
    ESTE SOFTWARE SE SUMINISTRA POR LA UNIVERSIDAD DE CHILE, CHILE Y LA UNIVERSIDAD DE LOS ANDES,
    CHILE. EN NINGÚN CASO LAS INSTITUCIONES MENCIONADAS SERÁN RESPONSABLES POR NINGÚN DAÑO DIRECTO,
    INDIRECTO, INCIDENTAL, ESPECIAL, EJEMPLAR O CONSECUENTE (INCLUYENDO,PERO NO LIMITADO A, LA
    ADQUISICIÓN DE BIENES O SERVICIOS; LA PÉRDIDA DE USO, DE DATOS O DE BENEFICIOS; O INTERRUPCIÓN
    DE LA ACTIVIDAD EMPRESARIAL) O POR CUALQUIER TEORÍA DE RESPONSABILIDAD, YA SEA POR CONTRATO,
    RESPONSABILIDAD ESTRICTA O AGRAVIO (INCLUYENDO NEGLIGENCIA O CUALQUIER OTRA CAUSA) QUE SURJA DE
    CUALQUIER MANERA DEL USO DE ESTE SOFTWARE, INCLUSO SI SE HA ADVERTIDO DE LA POSIBILIDAD DE TALES
    DAÑOS.
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
                                                    async function mail() {
                                                        var params = {
                                                            Source:      "no-reply@iccuandes.org",
                                                            Destination: {
                                                                "ToAddresses": [
                                                                    user_mail,
                                                                ]},
                                                            Message: {
                                                                "Subject": {
                                                                    "Data": 
                                                                "Resolucion de cuenta Institucional"
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
        <img src="/assets/images/logos/ethicapp-logo.svg" alt="Ethicapp">
    </div>
    Hola ${fullname}!
    <br>
    <br>
    Bienvenido a EthicApp. Tu cuenta institucional se encuentra aprobada. Puedes ingresar a
    EthicApp y comenzar invitando a profesores a utilizarla, e incluso creando tu primera actividad.
    <br>
    <br>
    <div style="text-align: center;">
        <a href="http://localhost:8080/login">
            <button style="
                background-color: #2649EC;
                border-color: #102AA0;
                color: white;
            ">
                ¡Comenzar!
            </button>
        </a>
    </div>
    <br>
    Te recordamos que en EthicApp usamos los datos generados por los usuarios con fines de
    investigación. Garantizamos la absoluta confidencialidad de los datos, y que los datos no los
    entregamos a terceras partes. En nuestras investigaciones reportamos los datos siempre a nivel
    agregado y nunca a nivel individual, ni revelando la identidad de los participantes.
    <br>
    <br>
    Las actividades basadas en EthicApp no presentan ningún riesgo a docentes ni estudiantes.
    EthicApp se entrega como servicio a los usuarios “tal cual”. Los desarrolladores de EthicApp
    quedan exentos de cualquier responsabilidad… [tenemos que ver si lo expresamos en forma similar
    a las licencias permisivas tipo BSD, MIT o Apache].
    <br>
    <br>
    EthicApp se reserva el derecho de suspender o terminar cuentas de usuario en caso que se detecte
    uso indebido del servicio.
    <br>
    <br>
    Deseamos a ti y a tus colegas el mayor éxito utilizando EthicApp en la enseñanza.
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
        <img src="/assets/images/logos/ethicapp-logo.svg" alt="Ethicapp">
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
