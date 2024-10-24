"use strict";
import * as config from "../../config/config.js";
import * as Yup from "yup";
import express from "express";
import passport from "passport";
import axios from "axios";
import bcrypt from "bcrypt";
import "./passport-setup.js";
import { param, getDBInstance, execSQL } from  "../../db/rest-pg-2.js";

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

router.get("/register", (req, res) => {
    res.render("register", {
        title:        "Registro - EthicApp",
        controller:   "RegisterController",
        extraScripts: `
          <script type="text/javascript">
            // Definir onloadCallback globalmente en window
            window.onloadCallback = function() {
              grecaptcha.render("captcha", {
                sitekey: "${process.env.RECAPTCHA_SITE_KEY}"
              });
            };
          </script>
          <script src="https://www.google.com/recaptcha/api.js?onload=onloadCallback&render=explicit" async defer></script>
        `,
        rc: req.query.rc
    });
});

router.post("/register", async (req, res) => {
    try {
        // Validate request body with schema
        await registerSchema.validate(req.body);

        // Verify captcha
        const response_key = req.body["g_recaptcha_response"];
        const secret_key = process.env.RECAPTCHA_SECRET;

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
            dbcon:     config.dbconnString,
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
            dbcon:     config.dbconnString,
            sqlParams: sqlParams
        };

        // Execute the SQL insert using execSQL
        await execSQL(dbParams);

        // Register account record after inserting the user
        const updateAccountQuery = {
            sql:   "SELECT UpdateOrInsertCreateAccountRecord(0)",
            dbcon: config.dbconnString
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
                dbcon: config.dbconnString,
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
                dbcon: config.dbconnString,
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
                    dbcon:     config.dbconnString,
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
                    dbcon:     config.dbconnString,
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

router.post("/teacher_account_request", async (req, res) => {
    try {
        // Validate the request body using the schema
        await teacherAccountRequestSchema.validate(req.body);

        // Captcha verification
        let response_key = req.body["g_recaptcha_response"];
        let secret_key = process.env.RECAPTCHA_SECRET;
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
            const db = getDBInstance(config.dbconnString);
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

router.get("/teacher_account_requests", async (req, res) => {
    try {
        // Execute the SQL query to fetch all teacher account requests, ordered by date descending
        await execSQL({
            dbcon: config.dbconnString,
            sql:   `
                SELECT *
                FROM teacher_account_requests
                ORDER BY date DESC
            `,
        });

        // Return the result in the response
        const result = await execSQL({
            dbcon: config.dbconnString,
            sql:   `
                SELECT *
                FROM teacher_account_requests
                ORDER BY date DESC
            `,
        });

        res.status(200).json(result);
    } catch (error) {
        console.error("Error fetching teacher account requests:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

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

export default router;