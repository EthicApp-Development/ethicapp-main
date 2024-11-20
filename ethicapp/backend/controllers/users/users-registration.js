"use strict";
import fs from "fs";
import path from "path";
import * as config from "../../config/config.js";
import express from "express";
import passport from "passport";
import { fileURLToPath } from "url";
import { VIEWS_PREFIX } from "./users-common.js";
import * as UserSchemas from "../request-schemas/user-schemas.js";
import * as RecaptchaHelper from "../../helpers/recaptcha-helper.js";
import * as TokenHelper from "../../helpers/token-helper.js";
import * as EmailHelper from "../../helpers/email-helper.js";
import * as UsersHelper from "../../helpers/users-helper.js";
import * as ViewsHelper from "../../helpers/views-helper.js";
import { param, getDBInstance, execSQL, singleSQL } from  "../../db/rest-pg-2.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

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
            scripts:    [
                ["js/dist/user-common.js", "js/dist/user-common.min.js"],
            ],
            renderScripts: (scripts) => ViewsHelper.renderScripts(scripts, res),
            rc:           req.query.rc
        });
    } catch (error) {
        console.error("Error loading extra scripts:", error);
        res.status(500).send({ success: false, message: "complete_request_error" });
    }
});

router.post("/register", async (req, res) => {
    try {
        await UserSchemas.registerSchema.validate(req.body);

        const { email, locale = "en_US", "g_recaptcha_response": responseKey } = req.body;
        req.setLocale(locale);

        // Validate reCAPTCHA field
        const recaptchaValid = await RecaptchaHelper.validateRecaptcha(responseKey);
        if (!recaptchaValid) return res.status(400).
            json({ success: false, message: "captcha_error" });

        // Check if the user already exists
        const emailExists = await UsersHelper.checkIfUserExists(email);
        if (emailExists) return res.status(409).
            json({ success: false, message: "account_already_exists" });

        // Pending teacher account request
        const pendingRequest = await UsersHelper.checkPendingRequestByEmail(email);
        if (pendingRequest) return res.status(409).
            json({ success: false, message: "duplicate_teacher_account_request" });

        // Hash the password
        const hashedPassword = await UsersHelper.hashPassword(req.body.pass);

        await execSQL({
            sql: `INSERT INTO users (rut, pass, name, mail, sex, role)
                            VALUES ($1, $2, $3, $4, $5, $6)`,
            dbcon:     config.dbconnString,
            sqlParams: [
                req.body.rut || "N/A",
                hashedPassword,
                `${req.body.name} ${req.body.lastname}`,
                req.body.email,
                req.body.sex || "U",
                "A"
            ]
        });

        // Account creation statistics
        await execSQL({ sql:   "SELECT UpdateOrInsertCreateAccountRecord(0)", 
            dbcon: config.dbconnString });

        // Set an email verification token
        const token = await setEmailVerificationToken(email, "users", config.dbconnString);
        
        // Send email verification request.
        await sendVerificationEmail(email, locale, req, token, "student");

        return res.status(200).json({ success: true, 
            message: "email_validation_notice" });
    } catch (error) {
        console.error("Error in POST /register", error);
        return res.status(500).json({ success: false, message: "complete_request_error" });
    }
});

router.get("/verify-email", async (req, res) => {
    try {
        const { token, type } = req.query;
        const table = type === "student" ? "users" : "teacher_account_requests";

        const selectSQL = `
            SELECT 1
            FROM ${table}
            WHERE validate_email_token = $1 AND verified_email = FALSE
            LIMIT 1
        `;
        
        const values = [token];

        // Execute the SELECT query
        const db = await getDBInstance(config.dbconnString);
        const result = await db.query(selectSQL, values);
        
        if (result.rows.length === 1) {
            // Update the verified_email field to TRUE for the matched token
            const updateSQL = `UPDATE ${table} SET verified_email = TRUE 
                WHERE validate_email_token = $1`;
            await db.query(updateSQL, values);

            const welcKey = type === "student" ? "email_verification_succeeded" : 
                "email_verification_succeeded_teacher";
            return res.redirect(`/login?welc=${welcKey}`);
        } else {
            // Render the error view if no matching entry was found
            res.status(400).render("error", {
                title:       "EthicApp",
                controller:  "ErrorsController",
                message_key: "email_verification_failed",
            });
        }
    } catch (error) {
        console.error("Error in verify-email endpoint:", error);
        // Render the view for server errors
        res.status(500).render("error", {
            title:       "EthicApp",
            controller:  "ErrorsController",
            message_key: "complete_request_error",
        });
    }
});

router.put("/teacher_account_requests/:id", async (req, res) => {
    try {
        const newStatus = req.body.status;
        const requestId = req.params.id;
        const locale = req.body.locale || "en_US";

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
                    newStatus, 
                    req.body.reject_reason, 
                    requestId
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
                    newStatus, 
                    requestId
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
                    sqlParams: [requestId]
                };

                const teacherDataResult = await execSQL(teacherDataQuery);

                if (teacherDataResult.length === 0) {
                    return res.status(404).json({ error: "teacher_account_request_not_found" });
                }

                const teacherData = teacherDataResult[0];

                // Insert teacher into users table
                const insertUserQuery = {
                    sql: `
                        INSERT INTO users(rut, pass, name, mail, sex, role, verified_email)
                        VALUES ($1, $2, $3, $4, $5, 'P', TRUE)
                    `,
                    dbcon:     config.dbconnString,
                    sqlParams: [
                        teacherData.rut,
                        teacherData.pass,
                        teacherData.name,
                        teacherData.mail,
                        teacherData.gender
                    ]
                };

                await execSQL(insertUserQuery);

                // Send notification to user
                const verificationUrl = 
                    `${req.protocol}://${req.headers.host}/login?welc=account_activated`;
                
                res.setLocale(locale);
                
                const subject = req.__("email.teacher_account_activated.subject");
                await EmailHelper.sendEthicAppEmail(
                    locale, teacherData.mail, subject, "teacher-account-activated.ejs", {
                        ethicAppUrl: verificationUrl,
                        firstName:   req.body.name
                    });

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

router.get("/teacher_account_requests", async (req, res) => {
    try {
        // Execute the SQL query to fetch all teacher account requests, 
        // ordered by date descending
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

router.post("/teacher_account_request", async (req, res) => {
    try {
        // Validate the request body
        await UserSchemas.teacherAccountRequestSchema.validate(req.body);

        const { email, locale = "en_US", "g_recaptcha_response": responseKey } = req.body;

        // Check for pending request and captcha
        const pendingRequestExists = await UsersHelper.checkPendingRequestByEmail(email);
        if (pendingRequestExists) return res.status(409).
            json({ success: false, message: "duplicate_teacher_account_request" });

        const recaptchaValid = await RecaptchaHelper.validateRecaptcha(responseKey);
        if (!recaptchaValid) return res.status(400).
            json({ success: false, message: "captcha_error" });

        // Check if user exists
        const userExists = await UsersHelper.checkIfUserExists(email, "users");
        const hashedPassword = await UsersHelper.hashPassword(req.body.pass);

        if (!userExists) {
            await insertTeacherAccountRequest(config.dbconnString, 
                req.body.rut || "N/A", hashedPassword, 
                `${req.body.name} ${req.body.lastname}`, 
                email, req.body.sex, req.body.institution, 0, false);

            const token = await setEmailVerificationToken(email, 
                "teacher_account_requests", config.dbconnString);

            await sendVerificationEmail(email, locale, req, token, "teacher");
            return res.status(200).json({ success: true, message: "teacher_account_request_sent" });
        } else {
            const existingUserRole = (await execSQL(
                {
                    sql:       "SELECT role FROM users WHERE mail = $1 LIMIT 1",
                    dbcon:     config.dbconnString, sqlParams: [email] 
                }))[0].role;
            if (existingUserRole === "A") {
                await insertTeacherAccountRequest(config.dbconnString, 
                    req.body.rut || "N/A", hashedPassword, 
                    `${req.body.name} ${req.body.lastname}`, 
                    email, req.body.sex, req.body.institution,
                    0, true);
                
                const emailVerified = await UsersHelper.isEmailVerified();
                
                if (!emailVerified) {
                    const token = await setEmailVerificationToken(
                        email, "teacher_account_requests", config.dbconnString);
                    await sendVerificationEmail(email, locale, req, token, "teacher");
                }
                return res.status(200).json({ 
                    success: true, 
                    message: "teacher_account_request_sent" 
                });
            } else {
                return res.status(400).json({
                    success: false,
                    message: "complete_request_error"
                });
            }
        }
    } catch (err) {
        console.error("Error in the controller:", err);
        return res.status(500).json({ success: false, message: "complete_request_error" });
    }
});

router.get("/teacher_account_requests/:id", async (req, res) => {
    try {
        const result = await singleSQL({
            dbcon: config.dbconnString,
            sql:   `
                SELECT *
                FROM teacher_account_requests
                WHERE id = $1
            `,
            sqlParams: [param("calc", "id")],
            onStart:   (ses, data, calc) => {
                calc.id = req.params.id;
            }
        });

        res.json(result);
    } catch (err) {
        console.error("Error fetching teacher account request:", err);
        res.status(500).json({ error: "Error fetching teacher account request." });
    }
});

async function setEmailVerificationToken(email, table, dbcon) {
    const { token, expires } = TokenHelper.generateToken();

    const sql = `
        UPDATE ${table} 
        SET validate_email_token = $1, validate_email_expires = $2 
        WHERE mail = $3
    `;

    const sqlParams = [token, expires, email]; 

    try {
        await execSQL({
            sql,
            dbcon,
            sqlParams
        });

        return token;
    } catch (err) {
        console.error("Error setting email verification token:", err);
        throw new Error("Error setting email verification token.");
    }
}

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

// Send verification email
async function sendVerificationEmail(email, locale, req, token, type) {
    const verificationUrl = 
        `${req.protocol}://${req.headers.host}/verify-email?token=${token}&type=${type}`;
    const subject = req.__("email.verification.subject");
    await EmailHelper.sendEthicAppEmail(locale, email, subject, "verify-email.ejs", {
        verificationUrl: verificationUrl,
        firstName:       req.body.name
    });
}
export default router;