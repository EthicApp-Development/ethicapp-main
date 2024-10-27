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
import * as RecaptchaHelper from "../../helpers/recaptcha-helper.js";

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
        res.status(500).send({ success: false, message: "complete_request_error" });
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
                message: "captcha_error",
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
                message: "account_already_exists",
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
            sql:       
                `INSERT INTO 
                    users (rut, pass, name, mail, sex, ROLE) 
                VALUES ($1, $2, $3, $4, $5, $6)`,
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
            message: "user_account_created_successfully",
        });

    } catch (error) {
        console.error("Error in POST /register", error);
        return res.status(500).json({
            success: false,
            message: "complete_request_error",
        });
    }
});

async function insertTeacherAccountRequest(
    dbcon, rut, pass, name, mail, sex, institution, status, upgrade_flag
) {
    const sql = `
        INSERT INTO teacher_account_requests(
            rut, pass, name, mail, gender, 
            institution, status, upgrade_flag
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `;
    const values = [rut, pass, name, mail, sex, institution, status, upgrade_flag];

    try {
        const db = await getDBInstance(dbcon);
        await db.query(sql, values);
    } catch (error) {
        console.error("Error inserting teacher account request:", error);
        throw new Error("Failed to insert teacher account request");
    }
}

async function checkPendingRequestByEmail(dbcon, email) {
    const sql = `
        SELECT 1
        FROM teacher_account_requests
        WHERE mail = $1 AND status = $2
        LIMIT 1
    `;
    const values = [email, '0'];

    try {
        // Get the database instance
        const db = await getDBInstance(dbcon);
        const result = await db.query(sql, values);
        
        if (result.rows.length > 0) {
            console.debug(`Pending teacher account request found for email '${email}'`);
        }

        // Return true if at least one row meets the criteria, otherwise false
        return result.rows.length > 0;
    } catch (error) {
        console.error("Error checking pending request by email:", error);
        // Exception handling: return false as a safe case in error
        return false;
    }}


router.put("/teacher_account_requests/:id", async (req, res) => {
    try {
        const newStatus = req.body.status;
        const requestId = req.params.id;

        // Status 2: Rejected
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
            // Status 1: Accepted
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
                    return res.status(404).json({ error: "teacher_account_request_not_found" });
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
                    message: "teacher_account_request_processed_successfully"
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

        // Check whether there is a teacher account request already for
        // the given email
        const userEmail = req.body.email;
        const pendingRequestExists = await checkPendingRequestByEmail(
            config.dbconnString, userEmail);
        
        if (pendingRequestExists) {
            return res.status(409).json(
                { 
                    success: false, 
                    message: "duplicate_teacher_account_request" }
                );
        }

        // Captcha verification
        const responseKey = req.body["g_recaptcha_response"];

        const recaptchaResult = RecaptchaHelper.validateRecaptcha(responseKey);
        if (!recaptchaResult) {
            console.debug("Captcha verification failed.");
            return res.status(400).json(
                { success: false, message: "captcha_error" });
        }

        // Hash the password using bcrypt
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(req.body.pass, saltRounds);

        // Check if the user exists in the database
        const checkUserSQL = "SELECT role FROM users WHERE mail = $1 LIMIT 1";
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

        const rut = req.body.rut || "N/A";

        if (!userExists) {
            // If the user does not exist, insert the teacher account request
            await insertTeacherAccountRequest(
                db, rut, hashedPassword, fullname, 
                userEmail, req.body.sex, req.body.institution, 0, false);
            return res.status(200).json(
                { success: true, message: "teacher_account_request_sent" });
        } else {
            // If the user already exists, act according to their role
            if (existingUserRole === "A") {
                // Request to modify the account to a teacher account
                await insertTeacherAccountRequest(
                    db, rut, hashedPassword, 
                    fullname, userEmail, req.body.sex, 
                    req.body.institution, 0, true);
                return res.status(200).json(
                    { 
                        success: true, 
                        message: "teacher_account_request_sent" 
                    });
            } else {
                // Unable to complete this request
                return res.status(400).json(
                    { success: false, message: "complete_request_error" });
            }
        }
    } catch (err) {
        console.error("Error in the controller:", err);
        return res.status(500).json({ success: false, 
            message: "complete_request_error" });
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
        res.status(500).json({ error: "complete_request_error" });
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