"use strict";
import fs from "fs";
import path from "path";
import * as config from "../../config/config.js";
import express from "express";
import passport from "passport";
import axios from "axios";
import bcrypt from "bcrypt";
import { fileURLToPath } from "url";
import { VIEWS_PREFIX } from "./users-common.js";
import * as UserSchemas from "../request-schemas/user-schemas.js";
import * as RecaptchaHelper from "../../helpers/recaptcha-helper.js";
import * as TokenHelper from "../../helpers/token-helper.js";
import * as EmailHelper from "../../helpers/email-helper.js";
import "./passport-setup.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { param, getDBInstance, execSQL, singleSQL } from  "../../db/rest-pg-2.js";

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

router.get("/verify-email", async (req, res) => {
    try {
        const { token, type } = req.query;
        const table = type === "student" ? "users" : "teacher_account_requests";

        const selectSQL = `
            SELECT 1
            FROM ${table}
            WHERE token = $1 AND verified_email = FALSE
            LIMIT 1
        `;
        
        const values = [token];

        // Execute the SELECT query
        const db = await getDBInstance(config.dbconnString);
        const result = await db.query(selectSQL, values);
        
        if (result.rows.length === 1) {
            // Update the verified_email field to TRUE for the matched token
            const updateSQL = `UPDATE ${table} SET verified_email = TRUE WHERE token = $1`;
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

router.post("/register", async (req, res) => {
    try {
        // Validate request body with schema
        await UserSchemas.registerSchema.validate(req.body);

        // Retrieve user's email and language preference
        const { lang, email, name } = req.body;
        const locale = lang || "en_US";

        req.setLocale(locale);

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
            sqlParams: [param("plain", email)]
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

        // Set the email verification token for the newly created user
        const token = await setEmailVerificationToken(email, "users", config.dbconnString);
        const verificationUrl = `${req.protocol}://${req.headers.host}/verify-email?token=${token}&type=student`;

        const subject = req.__("email.verification.subject");

        await EmailHelper.sendEthicAppEmail(
            locale, email, subject,
            "verify-email.ejs", { 
                verificationUrl: verificationUrl, 
                firstName:       name 
            });

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

async function checkPendingRequestByEmail(email) {
    const sql = `
        SELECT 1
        FROM teacher_account_requests
        WHERE mail = $1 AND status = $2
        LIMIT 1
    `;
    const values = [email, "0"];

    try {
        // Get the database instance
        const db = await getDBInstance(config.dbconnString);
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
    }
}

async function IsEmailVerified(email) {
    const sql = `
        SELECT 1
        FROM users
        WHERE mail = $1 AND verified_email = TRUE
        LIMIT 1
    `;
    const values = [email, "0"];

    // Get the database instance
    const db = await getDBInstance(config.dbconnString);
    const result = await db.query(sql, values);
    
    // Return true if at least one row meets the criteria, otherwise false
    return result.rows.length > 0;    
}

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
        const email = req.body.mail;
        const { locale, name } = req.body;
        
        const pendingRequestExists = await checkPendingRequestByEmail(email);
        
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
            sqlParams: [email]
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

        let sendVerificationEmail = async () => {
            // Set the email verification token for the newly created user
            const token = await setEmailVerificationToken(email, "users", config.dbconnString);
            let verificationUrl = `${req.protocol}://${req.headers.host}/verify-email?token=${token}&type=teacher`;

            const subject = req.__("email.verification.subject");

            await EmailHelper.sendEthicAppEmail(
                locale, email, subject,
                "verify-email.ejs", { 
                    verificationUrl: verificationUrl,
                    firstName:       name 
                });
    
        };
    
        if (!userExists) {
            // If the user does not exist, insert the teacher account request
            await insertTeacherAccountRequest(
                db, rut, hashedPassword, fullname, 
                email, req.body.sex, req.body.institution, 0, false);
            
            await sendVerificationEmail();
                
            return res.status(200).json(
                { success: true, message: "teacher_account_request_sent" });
        } else {
            // If the user already exists, act according to their role
            if (existingUserRole === "A") {
                // Request to modify the account to a teacher account
                await insertTeacherAccountRequest(
                    db, rut, hashedPassword, 
                    fullname, email, req.body.sex, 
                    req.body.institution, 0, true);
                
                // Request email verification if necessary
                const emailVerified = await IsEmailVerified();
                if (!emailVerified) {
                    await sendVerificationEmail();
                }

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


export default router;