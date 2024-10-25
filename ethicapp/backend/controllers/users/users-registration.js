"use strict";
import fs from "fs";
import path from "path";
import * as config from "../../config/config.js";
import express from "express";
import passport from "passport";
import axios from "axios";
import bcrypt from "bcrypt";
import { fileURLToPath } from "url";
import "./passport-setup.js";
import { VIEWS_PREFIX } from "./users-common.js";
import * as UserSchemas from "../request-schemas/user-schemas.js";
import * as RecaptchaHelper from "../helpers/recaptcha-helper.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { param, getDBInstance, execSQL } from  "../../db/rest-pg-2.js";

const router = express.Router();
router.use(passport.initialize());
router.use(passport.session());

router.get("/register", async (req, res) => {
    try {
        // Load recaptcha partial view from file
        const scriptPath = path.join(__dirname, 
            VIEWS_PREFIX, "partials", "recaptcha.ejs");
        let captchaScript = await fs.promises.readFile(scriptPath, "utf-8");

        // Replace placeholder with actual site key
        captchaScript = captchaScript.replace("{{RECAPTCHA_SITE_KEY}}", 
            process.env.RECAPTCHA_SITE_KEY);

        // Render the view
        res.render("register", {
            title:        "EthicApp",
            controller:   "RegistrationsController",
            extraScripts: `${captchaScript}`,
            rc:           req.query.rc
        });
    } catch (error) {
        console.error("Error loading extra scripts:", error);
        res.status(500).send("Server error");
    }
});

router.post("/register", async (req, res) => {
    try {
        // Validate request body with schema
        await UserSchemas.registerSchema.validate(req.body);

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
            return res.status(409).json({
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
        // Validate the request body
        await UserSchemas.teacherAccountRequestSchema.validate(req.body);

        // Captcha verification
        const responseKey = req.body["g_recaptcha_response"];

        const recaptchaResult = RecaptchaHelper.validateRecaptcha(responseKey);
        if (!recaptchaResult) {
            console.log("Captcha verification failed.");
            return res.status(400).json(
                { success: false, message: "Captcha verification failed." });
        }

        // Hash the password using bcrypt
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(req.body.pass, saltRounds);

        // Check if the user exists in the database
        const userEmail = req.body.email;
        const checkUserSQL = "SELECT role FROM users WHERE mail = $1";
        const dbParams = { 
            sql:       checkUserSQL, 
            dbcon:     config.dbconnString, 
            sqlParams: [param("plain", "userEmail")]
        };

        let userExists = false;
        let existingUserRole = null;

        // Execute the query to check if the user already exists and retrieve the role
        const result = await execSQL(dbParams);
        if (result.length > 0) {
            userExists = true;
            existingUserRole = result[0].role;
        }

        const fullname = `${req.body.name} ${req.body.lastname}`;
        const db = await getDBInstance(config.dbconnString);

        if (!userExists) {
            // If the user does not exist, insert the teacher account request
            await insertTeacherAccountRequest(
                db, req.body.rut, hashedPassword, fullname, 
                userEmail, req.body.sex, req.body.institution, 0, false);
            return res.status(200).json(
                { success: true, message: "Teacher account request submitted." });
        } else {
            // If the user already exists, act according to their role
            if (existingUserRole === "A") {
                // Request to modify the account to a teacher account
                await insertTeacherAccountRequest(
                    db, req.body.rut, hashedPassword, 
                    fullname, userEmail, req.body.sex, 
                    req.body.institution, 0, true);
                return res.status(200).json(
                    { 
                        success: true, 
                        message: "Request to modify the account to a teacher account submitted." 
                    });
            } else {
                // The email is already registered with a different role
                return res.status(409).json(
                    { success: false, message: "The email is already registered." });
            }
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

export default router;