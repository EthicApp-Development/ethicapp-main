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
        if (err) { 
            console.error("Error during logout:", err);
            return res.status(500).json({ message: "Logout failed" });
        }

        // Optionally destroy the session instead of nulling specific properties
        req.session.destroy((sessionErr) => {
            if (sessionErr) {
                console.error("Error destroying session:", sessionErr);
                return res.status(500).json({ message: "Failed to destroy session" });
            }

            // Redirect to login after logout and session destruction
            res.redirect("login");
        });
    });
});

router.post("/login", (req, res, next) => {
    passport.authenticate("local", async (err, user) => {
        const { source } = req.body;

        if (source === "admin-panel") {
            if (!user) {
                return res.status(200).json({ sessionID: "ErrorCredential" });
            }

            if (user["role"] !== "S") {
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

        const is_teacher = (user["role"] === "P" || user["role"] === "S") ? 1 : 0;

        // Log the user access into the database
        const sqlParams = [param("plain", is_teacher.toString())];
        const dbParams = {
            sql:       "SELECT UpdateOrInsertLoginRecord($1)",
            dbcon:     pass.dbcon,
            sqlParams: sqlParams
        };

        try {
            // Execute the query using the new executeSQL function
            await execSQL(dbParams);

            // Log the user in and redirect to "/seslist"
            req.logIn(user, (err) => {
                if (err) {
                    return next(err);
                }
                return res.redirect("/seslist");
            });
        } catch (err) {
            console.error("Error logging user access:", err);
            return res.status(500).json({ message: "Database error during login" });
        }
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
        const secret_key = pass.RECAPTCHA_SECRET;

        const response = await axios.post("https://www.google.com/recaptcha/api/siteverify", null, {
            params: {
                secret:   secret_key,
                response: response_key
            }
        });
        const data = response.data;

        if (!data.success) {
            console.error("Captcha verification error", data);
            return res.status(400).json({
                success: false,
                message: "Captcha verification failed.",
            });
        }

        // Check if the email is already registered
        const emailCheckQuery = {
            sql:       "SELECT COUNT(*) FROM users WHERE mail = $1",
            dbcon:     pass.dbcon,
            sqlParams: [param("plain", req.body.email)]
        };

        const emailExists = await execSQL(emailCheckQuery);

        if (emailExists[0].count > 0) {
            return res.status(400).json({
                success: false,
                message: "Email already registered.",
            });
        }

        // Continue with user registration
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(req.body.pass, saltRounds);

        const fullname = `${req.body.name} ${req.body.lastname}`;
        const sqlParams = [
            param("plain", req.body.rut || "N/A"),
            param("plain", passwordHash),
            param("plain", fullname),
            param("plain", req.body.email),
            param("plain", req.body.sex || "U"),
            param("plain", "A"), // Default role
        ];

        const dbParams = {
            sql:       "INSERT INTO users (rut, pass, name, mail, sex, ROLE) VALUES ($1, $2, $3, $4, $5, $6)",
            dbcon:     pass.dbcon,
            sqlParams: sqlParams
        };

        // Execute the SQL insert using execSQL
        await execSQL(dbParams);

        // Register account record after inserting the user
        const updateAccountQuery = {
            sql:   "SELECT UpdateOrInsertCreateAccountRecord(0)",
            dbcon: pass.dbcon
        };

        await execSQL(updateAccountQuery);

        // Respond with success
        return res.status(200).json({
            success: true,
            message: "User successfully registered.",
        });

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
        const requestId = req.params.id;

        if (newStatus === "2") {
            // Execute SQL to update status and reject reason
            await execSQL({
                dbcon: pass.dbcon,
                sql:   `
                    UPDATE teacher_account_requests
                    SET status = $1, reject_reason = $2
                    WHERE id = $3
                `,
                sqlParams: [
                    param("plain", newStatus), 
                    param("plain", req.body.reject_reason), 
                    param("plain", requestId)
                ]
            });

        } else {
            // Execute SQL to update only the status
            await execSQL({
                dbcon: pass.dbcon,
                sql:   `
                    UPDATE teacher_account_requests
                    SET status = $1
                    WHERE id = $2
                `,
                sqlParams: [
                    param("plain", newStatus), 
                    param("plain", requestId)
                ]
            });

            if (newStatus === "1") {
                // Query teacher data from the request
                const teacherDataQuery = {
                    sql: `
                        SELECT *
                        FROM teacher_account_requests
                        WHERE id = $1
                    `,
                    dbcon:     pass.dbcon,
                    sqlParams: [param("plain", requestId)]
                };

                const teacherDataResult = await execSQL(teacherDataQuery);

                if (teacherDataResult.length === 0) {
                    return res.status(404).json({ error: "Teacher not found" });
                }

                const teacherData = teacherDataResult[0];

                // Insert teacher into users table
                const insertUserQuery = {
                    sql: `
                        INSERT INTO users(rut, pass, name, mail, sex, ROLE)
                        VALUES ($1, $2, $3, $4, $5, 'P')
                    `,
                    dbcon:     pass.dbcon,
                    sqlParams: [
                        param("plain", teacherData.rut),
                        param("plain", teacherData.pass),
                        param("plain", teacherData.name),
                        param("plain", teacherData.mail),
                        param("plain", teacherData.gender)
                    ]
                };

                await execSQL(insertUserQuery);

                // Send success response
                return res.status(200).json({
                    message: "Request accepted and teacher added as user"
                });
            }
        }
    } catch (error) {
        console.error("Error in the controller:", error);

        // Send error response
        return res.status(500).json({ error: "Internal server error" });
    }
});


// Route to get the user's name and other details
router.post("/get-my-name", async (req, res) => {
    try {
        // Execute SQL query to fetch user's name, role, lang, and mail based on session uid
        const result = await execSQL({
            dbcon: pass.dbcon,
            sql:   `
                SELECT name,
                    role,
                    lang,
                    mail
                FROM users
                WHERE id = $1
            `,
            sqlParams: [param("plain", req.session.uid)]  // Use session uid as the parameter
        });

        if (result.length > 0) {
            return res.status(200).json(result[0]);  // Return the first row
        } else {
            return res.status(404).json({ error: "User not found" });
        }
    } catch (error) {
        console.error("Error in /get-my-name:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});

// Route to update the user's language
router.post("/update-lang", async (req, res) => {
    try {
        // Execute SQL update to modify the user's language based on session uid
        await execSQL({
            dbcon: pass.dbcon,
            sql:   `
                UPDATE users
                SET lang = $1
                WHERE id = $2
            `,
            sqlParams: [
                param("plain", req.body.lang),  // Language from the request body
                param("plain", req.session.uid)  // Session uid
            ]
        });

        // Return success message
        return res.status(200).json({ message: "Language updated successfully" });
    } catch (error) {
        console.error("Error in /update-lang:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});

/*
router.post("/resetpassword", (req, res) => {
    var SES_CONFIG = {
        accessKeyId:     pass.AWS_APIKEY,
        secretAccessKey: pass.AWS_SECRET,
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
*/

router.get("/new-pass/:token", (req, res) => {
    res.render("newpass", { token: req.params.token });
});

router.post("/newpassword", async (req, res) => {
    try {
        const { token, pass } = req.body;

        // Ensure the password meets the minimum length requirement
        if (pass.length < 8) {
            return res.status(400).json({ error: "Password must be at least 8 characters long." });
        }

        // Define salt rounds for bcrypt and hash the password
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(pass, saltRounds);

        // Execute the SQL query to update the password
        await execSQL({
            dbcon: pass.dbcon,
            sql:   `
                UPDATE users AS u
                SET pass = $1
                FROM pass_reset AS r
                WHERE r.token = $2
                  AND r.mail = u.mail
            `,
            sqlParams: [
                param("plain", hashedPassword), // Hashed password
                param("plain", token)  // Token from the request body
            ]
        });

        // Redirect to the login page with a success code
        return res.redirect("login?rc=4");
    } catch (error) {
        console.error("Error in /newpassword:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});


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
        const { pass, "pass-conf": passConf, mail } = req.body;

        // Check if passwords match
        if (pass !== passConf) {
            return res.status(400).json({ status: "error", message: "Passwords do not match" });
        }

        // Hash the password using bcrypt
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(pass, saltRounds);

        // Execute the SQL query to update the password
        await execSQL({
            dbcon: pass.dbcon,
            sql:   `
                UPDATE users
                SET pass = $1
                WHERE mail = $2
            `,
            sqlParams: [
                param("plain", hashedPassword),  // Hashed password
                param("plain", mail)  // User email from request body
            ]
        });

        // Redirect to the login page with a success code
        return res.redirect("login?rc=4");
    } catch (err) {
        console.error("Error changing password:", err);
        return res.status(500).json({ status: "err", message: "Internal server error" });
    }
});

router.post("/getuserinfo", async (req, res) => {
    try {
        // Execute the SQL query to get user information based on session uid
        const result = await execSQL({
            dbcon: pass.dbcon,
            sql:   `
                SELECT *
                FROM users
                WHERE id = $1
                LIMIT 1
            `,
            sqlParams: [param("plain", req.session.uid)]  // Use session uid as a parameter
        });

        // Return user data if found, else return empty object
        if (result.length > 0) {
            return res.status(200).json({ data: result[0] });
        } else {
            return res.status(404).json({ error: "User not found" });
        }
    } catch (error) {
        console.error("Error in /getuserinfo:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});

router.post("/make_prof", async (req, res) => {
    try {
        // Execute the SQL query to update the user's role to 'P' (professor)
        await execSQL({
            dbcon: pass.dbcon,
            sql:   `
                UPDATE users
                SET role = 'P'
                WHERE mail = $1
            `,
            sqlParams: [param("plain", req.body.mail)]  // Use email from request body
        });

        // Respond with success message
        return res.status(200).json({ message: "User role updated to professor" });
    } catch (error) {
        console.error("Error in /make_prof:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});

router.post("/make_alum", async (req, res) => {
    try {
        // Execute the SQL query to update the user's role to 'A' (student)
        await execSQL({
            dbcon: pass.dbcon,
            sql:   `
                UPDATE users
                SET role = 'A'
                WHERE mail = $1
            `,
            sqlParams: [param("plain", req.body.mail)]  // Use email from request body
        });

        // Respond with success message
        return res.status(200).json({ message: "User role updated to student" });
    } catch (error) {
        console.error("Error in /make_alum:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});


export default router;
