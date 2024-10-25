"use strict";
import * as config from "../../config/config.js";
import fs from "fs";
import path from "path";
import express from "express";
import passport from "passport";
import { VIEWS_PREFIX } from "./users-common.js";
import { sendPasswordResetEmail } from "../../services/email/send-password-reset-email.js";
import bcrypt from "bcrypt";

import * as crypto from "crypto";
import { param, execSQL } from  "../../db/rest-pg-2.js";
import { fileURLToPath } from "url";
import * as UserSchemas from "../request-schemas/user-schemas.js";
import * as RecaptchaHelper from "../../helpers/recaptcha-helper.js";
import * as TokenHelper from "../../helpers/token-helper.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
router.use(passport.initialize());
router.use(passport.session());
import "./passport-setup.js";

router.get("/login", (req, res) => {
    res.render("login", {
        title: "Login - EthicApp",
        welc:  req.query.welc
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
            return res.status(401).json({ message: "Invalid credentials" });
        }

        const is_teacher = (user["role"] === "P" || user["role"] === "S") ? 1 : 0;

        // Log the user access into the database
        const sqlParams = [param("plain", is_teacher.toString())];
        const dbParams = {
            sql:       "SELECT UpdateOrInsertLoginRecord($1)",
            dbcon:     config.dbconnString,
            sqlParams: sqlParams
        };

        try {
            // Execute the query using the new executeSQL function
            await execSQL(dbParams);

            // Log the user
            req.logIn(user, (err) => {
                if (err) {
                    return next(err);
                }
                return res.status(200).json({ message: "Login successful" });
            });
        } catch (err) {
            console.error("Error logging user access:", err);
            return res.status(500).json({ message: "Login error" });
        }
    })(req, res, next);
});

router.get("/forgot", async (req, res) => {
    try {
        // Load recaptcha partial view from file
        const scriptPath = path.join(__dirname, 
            VIEWS_PREFIX, "partials", "recaptcha.ejs");
        let captchaScript = await fs.promises.readFile(scriptPath, "utf-8");

        // Replace placeholder with actual site key
        captchaScript = captchaScript.replace("{{RECAPTCHA_SITE_KEY}}", 
            process.env.RECAPTCHA_SITE_KEY);

        const welc = req.query.welc;

        // Render the view
        res.render("recover-password", {
            title:        "EthicApp",
            controller:   "CredentialsController",
            extraScripts: `${captchaScript}`,
            welc:         welc,
        });
    } catch (error) {
        console.error("Error loading extra scripts:", error);
        res.status(500).send("Server error");
    }
});

router.post("/forgot", async (req, res) => {
    async function requestPasswordReset(email, dbcon) {
        const token = crypto.randomBytes(20).toString("hex");
        const expires = new Date(Date.now() + 3600000 * 24);
    
        const sql = `
            UPDATE users 
            SET reset_password_token = $1, reset_password_expires = $2 
            WHERE mail = $3
        `;

        const sqlParams = [token, expires, email];  // No proceses sqlParams como JSON

        try {
            await execSQL({
                sql,
                dbcon,
                sqlParams  // Pasar sqlParams directamente
            });
    
            return token;
        } catch (err) {
            console.error("Error updating password reset token:", err);
            throw new Error("Error processing password reset request.");
        }
    }

    try {
        await UserSchemas.passwordRecoverySchema.validate(req.body);

        const responseKey = req.body["g_recaptcha_response"];
        const recaptchaResult = await RecaptchaHelper.validateRecaptcha(responseKey);
        
        if (!recaptchaResult) {
            console.log("Captcha verification failed.");
            return res.status(400).json({
                success: false, message: "Captcha verification failed."
            });
        }

        const { email, lang } = req.body;
        const locale = lang || "en_US";
        const token = await requestPasswordReset(email, config.dbconnString);
        const resetUrl = `http://${req.headers.host}/reset/${token}`;

        req.setLocale(locale);
        const subject = req.__("email.reset.subject");

        await sendPasswordResetEmail(email, locale, subject, resetUrl);
        res.status(200).send("Recovery email sent.");
    } catch (err) {
        console.error("Error handling password reset request:", err);
        res.status(500).send("Error sending recovery email.");
    }
});

router.get("/reset-password", async (req, res) => {
    try {
        // Validate request
        await UserSchemas.passwordRecoveryPageSchema.validate(req.query);

        const { token } = req.query;

        // Check if the token is valid and get the associated email
        let email;
        try {
            const sql = `
                SELECT mail 
                FROM users 
                WHERE reset_password_token = $1 
                AND reset_password_expires > NOW()
            `;
            const result = await execSQL({
                sql,
                dbcon:     config.dbconnString,
                sqlParams: [token]
            });

            if (result.length === 0) {
                console.error("Invalid or expired token");
                return res.redirect("/forgot?welc=pass_recovery_token_expired");
            }

            email = result[0].mail;
        } catch (error) {
            console.error("Error retrieving email by token:", error);
            return res.redirect("/forgot?welc=pass_recovery_token_expired");
        }

        // Load recaptcha partial view from file
        const scriptPath = path.join(__dirname, 
            VIEWS_PREFIX, "partials", "recaptcha.ejs");
        let captchaScript = await fs.promises.readFile(scriptPath, "utf-8");

        // Replace placeholder with actual site key
        captchaScript = captchaScript.replace(
            "{{RECAPTCHA_SITE_KEY}}", process.env.RECAPTCHA_SITE_KEY);

        // Render the view with the retrieved email
        res.render("reset-password", {
            title:        "EthicApp",
            controller:   "CredentialsController",
            extraScripts: `${captchaScript}`,
            email:        email,
            rc:           req.query.rc
        });
    } catch (error) {
        console.error("Error rendering password reset view:", error);
        res.status(500).send("Server error");
    }
});

router.post("/reset-password/:token", async (req, res) => {
    async function updatePassword(token, email, newPassword, dbcon) {
        const hashedPassword = await bcrypt.hash(newPassword, 10);
    
        const sql = `
            UPDATE users 
            SET password = $1, reset_password_token = NULL, reset_password_expires = NULL 
            WHERE reset_password_token = $2 AND
            mail = $3
        `;
        const sqlParams = [hashedPassword, token, email];
    
        try {
            await execSQL({
                sql,
                dbcon,
                sqlParams: sqlParams.map((param, index) => param("plain", `param${index}`))
            });
    
            return true;
        } catch (err) {
            console.error("Error updating password:", err);
            throw new Error("Error updating password.");
        }
    }

    try {
        // Validate request
        await UserSchemas.passwordResetSchema.validate(req.body);

        const { token } = req.params;
        const { email, pass } = req.body;
 
        // Validate recaptcha token
        const responseKey = req.body["g_recaptcha_response"];
        const recaptchaResult = await RecaptchaHelper.validateRecaptcha(responseKey);

        if (!recaptchaResult) {
            console.log("Captcha verification failed.");
            return res.status(400).json(
                { success: false, message: "Captcha verification failed." });
        }

        // Step 1: Verify token validity
        //await TokenHelper.validateToken(token, config.dbconnString);

        // Step 2: Update the password
        await updatePassword(token, email, pass, config.dbconnString);
        res.status(200).send("Password has been reset.");
    } catch (err) {
        return res.status(500).send("An error ocurred when updating the password.");
    }
});

router.get("/logout", (req, res) => {
    
    req.logout(function (err) {
        if (err) { 
            console.error("Error during logout:", err);
            return res.status(500).json({ message: "Logout failed" });
        }

        // Optionally destroy the session instead of nulling specific properties
        req.session.destroy((sessionErr) => {
            console.log("attempting to destroy session");
            
            if (sessionErr) {
                console.error("Error destroying session:", sessionErr);
                return res.status(500).json({ message: "Failed to destroy session" });
            }

            // Redirect to login after logout and session destruction
            res.redirect("login");
        });
    });
});

router.get("/profile", (req, res) => {
    res.render("profile");
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
            dbcon:     config.dbconnString,
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


export default router;
