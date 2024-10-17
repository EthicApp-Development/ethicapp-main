"use strict";
import * as pass from "../config/keys-n-secrets.js";
import * as Yup from "yup";
import AWS from "aws-sdk";
import express from "express";
import passport from "passport";
import axios from "axios";
import nodemailer from "nodemailer";
import bcrypt from "bcrypt";
import "./passport-setup.js";
import { param, getDBInstance, execSQL, singleSQL, multiSQL } from  "../db/rest-pg-2.js";

const router = express.Router();
router.use(passport.initialize());
router.use(passport.session());

const registerSchema = Yup.object().shape({
    name:                 Yup.string().required("requiredName"),
    lastname:             Yup.string().required("requiredLastName"),
    email:                Yup.string().email("invalidEmail").required("requiredEmail"),
    pass:                 Yup.string().min(6, "minLengthPassword").required("requiredPassword"),
    sex:                  Yup.string().oneOf(["M", "F", "O"], "invalidSex").required("requiredSex"),
    g_recaptcha_response: Yup.string().required("requiredCaptcha")
});

const teacherAccountRequestSchema = Yup.object().shape({
    name:                 Yup.string().required("requiredName"),
    lastname:             Yup.string().required("requiredLastName"),
    email:                Yup.string().email("invalidEmail").required("requiredEmail"),
    pass:                 Yup.string().min(6, "minLengthPassword").required("requiredPassword"),
    sex:                  Yup.string().oneOf(["M", "F", "O"], "invalidSex").required("requiredSex"),
    institution:          Yup.string().required("requiredInstitution"),
    g_recaptcha_response: Yup.string().required("requiredCaptcha")
});

nodemailer.createTransport({
    sendmail: true,
    newline:  "unix"
});

router.get("/login", (req, res) => {
    res.render("login", {rc: req.query.rc, tok: req.query.rc});
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
        const { source } = req.body;
        if (source === "admin-panel") {
            if (!user) {
                return res.status(200).json({ sessionID: "ErrorCredential" });
            }

            if (user["role"] != "S") {
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

        var is_teacher = (user["role"] === "P" || user["role"] === "S") ? 1 : 0;

        // Log the user access
        const sqlParams = [param("plain", is_teacher.toString())];
        const dbParams = {
            sql:       "SELECT UpdateOrInsertLoginRecord($1)",  
            dbcon:     pass.dbcon,  
            sqlParams: sqlParams,  
            onEnd:     (req, res) => {
                req.logIn(user, (err) => {
                    if (err) {
                        return next(err);
                    }
                    return res.redirect("/seslist");
                });
            }
        };

        const executeQuery = execSQL(dbParams);
        executeQuery(req, res);
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
    async (req, res) => {
      
        const sqlParams = [param("plain", "0")];
        const dbParams = {
            sql:       "SELECT UpdateOrInsertLoginRecord($1)",
            dbcon:     pass.dbcon,
            sqlParams: sqlParams,
        };
  
        try {
            const executeQuery = execSQL(dbParams);
            await executeQuery(req, res);
  
            res.redirect("/seslist");
        } catch (error) {
            console.error(error);
            res.redirect("/error");
        }
    }
);
  
router.post("/register", async (req, res) => {
    try {
        // Validate request body with schema
        await registerSchema.validate(req.body);
    
        // Verify captcha
        const response_key = req.body["g_recaptcha_response"];
        const secret_key = pass.Captcha_Secret;
    
        const response = await axios.post("https://www.google.com/recaptcha/api/siteverify", null, {
            params: {
                secret:   secret_key,
                response: response_key
            }
        });
        const data = response.data;
          
        if (data.success) {
            // Continue with user registration if captcha verification is successful
            try {
                // Hash the password using bcrypt
                const saltRounds = 10; // Define the number of salt rounds for bcrypt
                const passwordHash = await bcrypt.hash(req.body.pass, saltRounds);
    
                const fullname = `${req.body.name} ${req.body.lastname}`;
                const sqlParams = [
                    param("plain", req.body.rut || "N/A"), // Use 'N/A' if no RUT is provided
                    param("plain", passwordHash),  // Hashed password
                    param("plain", fullname),
                    param("plain", req.body.email),
                    param("plain", req.body.sex || "U"),  // Undefined gender if not provided
                    param("plain", "A"), // Default role, e.g., 'A' for student
                ];
    
                const dbParams = {
                    sql:       "INSERT INTO users (rut, pass, name, mail, sex, ROLE) VALUES ($1, $2, $3, $4, $5, $6)",
                    dbcon:     pass.dbcon,
                    sqlParams: sqlParams,
                };
    
                // Use execSQL to execute the insertion in the database
                await new Promise((resolve, reject) => {
                    const executeInsert = execSQL(dbParams);
                    executeInsert(req, {
                        json:   resolve,
                        status: (code) => reject(new Error(`Insert failed with status code: ${code}`)),
                        end:    () => {}
                    });
                });
    
                // Register account record after inserting the user
                const db = getDBInstance(pass.dbcon);
                const sqlQuery = "SELECT UpdateOrInsertCreateAccountRecord(0)";
                db.query(sqlQuery, (dbErr) => {
                    if (dbErr) {
                        return res.status(500).json({
                            success: false,
                            message: "Error updating or inserting account record.",
                        });
                    }
    
                    return res.status(200).json({
                        success: true,
                        message: "User successfully registered.",
                    });
                });
    
            } catch (err) {
                console.error("Error registering the user", err);
                return res.status(500).json({
                    success: false,
                    message: "Error registering the user.",
                });
            }
        } else {
            console.error("Captcha verification error", data);
            return res.status(400).json({
                success: false,
                message: "Captcha verification failed.",
            });
        }
    } catch (error) {
        console.error("Error in POST /register", error);
        return res.status(500).json({
            success: false,
            message: "Server error.",
        });
    }
});
  
router.get("/teacher_account_requests", multiSQL({
    dbcon: pass.dbcon,
    sql:   `
    SELECT *
    FROM teacher_account_requests
    ORDER BY date DESC
    `,
}));

router.get("/teacher_account_requests/:id", (req, res) => {
    singleSQL({
        dbcon: pass.dbcon,
        sql:   `
          SELECT *
          FROM teacher_account_requests
          WHERE id = $1
      `,
        onStart: (ses, data, calc) => {
            calc.id = req.params.id;
        },
        sqlParams: [param("calc", "id")]
    })(req, res);
});

router.post("/teacher_account_request", async (req, res) => {
    try {
        // Validate the request body using the schema
        await teacherAccountRequestSchema.validate(req.body);

        // Captcha verification
        let response_key = req.body["g_recaptcha_response"];
        let secret_key = pass.Captcha_Secret;
        let captchaResponse = await fetch(
            "https://www.google.com/recaptcha/api/siteverify?" +
            `secret=${secret_key}&response=${response_key}`
        );
        let captchaData = await captchaResponse.json();
        console.log("Captcha log", captchaData);

        if (captchaData.success) {
            // Use bcrypt to hash the password instead of MD5
            const saltRounds = 10;  // Define salt rounds for bcrypt
            const passcr = await bcrypt.hash(req.body.pass, saltRounds);  // Hashed password

            const fullname = `${req.body.name} ${req.body.lastname}`;
            const db = getDBInstance(pass.dbcon);
            const existingUserRole = await checkIfUserExists(db, req.body.email);

            if (existingUserRole === false) {
                // Insert the teacher account request into the database
                await insertTeacherAccountRequest(db, req.body.rut, 
                    passcr, fullname, req.body.email, req.body.sex, req.body.institution, 0, false);
                return res.status(200).json({ success: true, 
                    message: "Teacher account request submitted." });
            } else {
                if (existingUserRole === "A") {
                    // Request to modify the account to a teacher account
                    await insertTeacherAccountRequest(db, req.body.rut, passcr, 
                        fullname, req.body.email, req.body.sex, req.body.institution, 0, true);
                    return res.status(200).json({ success: true, 
                        message: "Request to modify the account to a teacher account submitted." });
                } else {
                    // Email is already registered with a different role
                    return res.status(409).json({ success: false,
                        message: "The email is already registered." });
                }
            }
        } else {
            console.log("Captcha verification failed.");
            return res.status(400).json({ success: false, 
                message: "Captcha verification failed." });
        }
    } catch (err) {
        console.error("Error in the controller:", err);
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

async function insertTeacherAccountRequest(
    db, rut, pass, name, mail, sex, institution, status, upgrade_flag) {
    return new Promise((resolve, reject) => {
        const sql = `
        INSERT INTO teacher_account_requests(
            rut, pass, name, mail, gender, 
            institution, status, upgrade_flag)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `;

        const values = ["N/A", pass, name, mail, sex, institution, status, upgrade_flag];

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
            await execSQL({
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
                sqlParams:   [
                    param("post", "status"), 
                    param("post", "reject_reason"), 
                    param("calc", "id")]
            })(req, res);
        }
        else {
            // Actualizar el estado en la base de datos
            await execSQL({
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
                sqlParams:   [param("post", "status"), param("calc", "id")]
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
                res.status(200).json(
                    { message: "Solicitud aceptada y profesor agregado como usuario" });
            }
        }
    } catch (error) {
        console.error("Error en el controlador:", error);

        // Enviar una respuesta de error
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

router.post("/get-my-name", singleSQL({
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
    sqlParams:  [param("ses", "uid")]
}));

router.post("/update-lang", singleSQL({
    dbcon: pass.dbcon,
    sql:   `
    UPDATE users
    SET lang = $1
    WHERE id = $2
    `,
    sesReqData:  ["uid"],
    postReqData: ["lang"],
    sqlParams:   [param("post", "lang"), param("ses", "uid")]
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

router.post("/newpassword", execSQL({
    dbcon: pass.dbcon,
    sql:   `
    UPDATE users AS u
    SET pass = $1
    FROM pass_reset AS r
    WHERE r.token = $2
        AND r.mail = u.mail
    `,
    postReqData: ["token", "pass"],
    onStart:     async (ses, data, calc) => {
        if (data.pass.length < 8) return "SELECT 1";  // Ensure password is long enough
        
        // Define salt rounds for bcrypt
        const saltRounds = 10;
        
        // Hashed password stored in calc.passcr
        calc.passcr = await bcrypt.hash(data.pass, saltRounds);
    },
    sqlParams: [param("calc", "passcr"), param("post", "token")],
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

router.get("/profile", (req, res) => {
    res.render("profile");
});

router.post("/changepassword", async (req, res) => {
    try {
        // Check if passwords match
        if (req.body.pass === req.body["pass-conf"]) {
            const db = getDBInstance(pass.dbcon);

            // Hash the password using bcrypt
            const saltRounds = 10;
            const passcr = await bcrypt.hash(req.body.pass, saltRounds);

            // Use parameterized query to prevent SQL injection
            const sql = `
            UPDATE users
            SET pass = $1
            WHERE mail = $2
            `;
            const sqlParams = [passcr, req.body.mail];

            // Execute the query with parameters
            const qry = db.query(sql, sqlParams);

            // Handle query success
            qry.on("end", function () {
                res.redirect("login?rc=4");
            });

            // Handle query errors
            qry.on("error", function () {
                res.status(500).json({ status: "err" });
            });
        } else {
            res.status(400).json({ status: "error", message: "Passwords do not match" });
        }
    } catch (err) {
        console.error("Error changing password:", err);
        res.status(500).json({ status: "err" });
    }
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

export default router;
