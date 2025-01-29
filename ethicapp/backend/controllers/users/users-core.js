"use strict";
import * as config from "../../config/config.js";
import fs from "fs";
import path from "path";
import express from "express";
import passport from "passport";
import { VIEWS_PREFIX } from "./users-common.js";
import { param, execSQL } from  "../../db/rest-pg-2.js";
import { fileURLToPath } from "url";
import * as UserSchemas from "../request-schemas/user-schemas.js";
import * as RecaptchaHelper from "../../helpers/recaptcha-helper.js";
import * as TokenHelper from "../../helpers/token-helper.js";
import * as EmailHelper from "../../helpers/email-helper.js";
import * as UsersHelper from "../../helpers/users-helper.js";
import * as ViewsHelper from "../../helpers/views-helper.js";
import * as EthicAppEventLogger from "../stats/event-logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

router.get("/login", (req, res) => {
    res.render("login", {
        title: "Login - EthicApp",
        controller: "LoginController",
        scripts:    [
            ["js/dist/user-common.js", "js/dist/user-common.min.js"],
        ],
        renderScripts: (scripts) => ViewsHelper.renderScripts(scripts, res),
        welc:  req.query.welc
    });
});

router.post("/login", (req, res, next) => {
    passport.authenticate("local", async (err, user) => {
        try {
            if (!user) {
                return res.status(401).json({ message: "login_failed" });
            }

            if (err) {
                return next(err);
            }
    
            if (await UsersHelper.hasTheUserRole(user.mail, 'S')) {
                return res.status(401).json({ message: "login_failed" });
            }

            // Record the login event
            EthicAppEventLogger.userLogin();

            // Create a session for the user
            req.logIn(user, (err) => {
                
                req.session.uid = user.id;
                req.session.role = user.role;

                if (err) {
                    return next(err);
                }
                
                return res.status(200).json({ message: "login_succeeded" });
            });
        } catch (err) {
            console.error("Error logging user access:", err);
            return res.status(500).json({ message: "login_failed" });
        }
    })(req, res, next);
});

router.post("/login/admin", async (req, res, next) => {
    const { source } = req.body;

    const isAdmin = await UsersHelper.hasTheUserRole(user.mail, 'S');
    if (!isAdmin) {
        return res.status(401).json({ message: "login_failed" });
    }

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

    return res.status(400);
});

router.get("/forgot", async (req, res) => {
    try {
        // Load recaptcha partial head view from file
        const headScriptPath = path.join(__dirname, 
            VIEWS_PREFIX, "partials", "recaptcha-head.ejs");
        let headRecaptchaScript = await fs.promises.readFile(headScriptPath, "utf-8");

        // Load recaptcha partial bottom view from file
        const bottomScriptPath = path.join(__dirname, 
            VIEWS_PREFIX, "partials", "recaptcha-bottom.ejs");
        let bottomRecaptchaScript = await fs.promises.readFile(bottomScriptPath, "utf-8");

        // Replace placeholder with actual site key
        bottomRecaptchaScript = bottomRecaptchaScript.replace("{{RECAPTCHA_SITE_KEY}}", 
            process.env.RECAPTCHA_SITE_KEY);

        const welc = req.query.welc;

        // Render the view
        res.render("recover-password", {
            title:        "EthicApp",
            controller:   "CredentialsController",
            scripts:    [
                ["js/dist/user-common.js", "js/dist/user-common.min.js"],
            ],
            bottomScripts: `${bottomRecaptchaScript}`,
            extraScripts: `${headRecaptchaScript}`,
            renderScripts: (scripts) => ViewsHelper.renderScripts(scripts, res),
            welc:         welc,
        });
    } catch (error) {
        console.error("Error loading extra scripts:", error);
        res.status(500).send("complete_request_error");
    }
});

router.post("/forgot", async (req, res) => {
    async function requestPasswordReset(email, dbcon) {        
        try {
            const { token, expires } = TokenHelper.generateToken();
            await UsersHelper.setPasswordResetToken(token, expires, email);
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
            console.error("Captcha verification failed.");
            return res.status(400).json({
                success: false, message: "captcha_error"
            });
        }

        const { email, lang } = req.body;
        const locale = lang || "en_US";

        const userExists = await UsersHelper.checkIfUserExists(email);
        if (!userExists) {
            return res.status(409).json({
                success: false,
                message: "user_not_found"
            });
        }

        const token = await requestPasswordReset(email, config.dbconnString);
        const resetUrl = `${req.protocol}://${req.headers.host}/reset-password?token=${token}`;

        req.setLocale(locale);
        const subject = req.__("email.reset.subject");

        await EmailHelper.sendEthicAppEmail(
            locale, email, subject,
            "reset-password.ejs", { resetUrl });

        res.status(200).send("Recovery email sent.");
    } catch (err) {
        console.error("Error handling password reset request:", err);
        res.status(500).send("email_transport_failed");
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

        // Load recaptcha partial head view from file
        const headScriptPath = path.join(__dirname, 
            VIEWS_PREFIX, "partials", "recaptcha-head.ejs");
        let headRecaptchaScript = await fs.promises.readFile(headScriptPath, "utf-8");

        // Load recaptcha partial bottom view from file
        const bottomScriptPath = path.join(__dirname, 
            VIEWS_PREFIX, "partials", "recaptcha.ejs");
        let bottomRecaptchaScript = await fs.promises.readFile(bottomScriptPath, "utf-8");

        // Replace placeholder with actual site key
        bottomRecaptchaScript = bottomRecaptchaScript.replace(
            "{{RECAPTCHA_SITE_KEY}}", process.env.RECAPTCHA_SITE_KEY);

        // Render the view with the retrieved email
        res.render("reset-password", {
            title:        "EthicApp",
            controller:   "CredentialsController",
            extraScripts: `${headRecaptchaScript}`,
            bottomScript: `${bottomRecaptchaScript}`,
            email:        email,
            token:        token,
            rc:           req.query.rc
        });
    } catch (error) {
        console.error("Error rendering password reset view:", error);
        res.status(500).send("complete_request_error");
    }
});

router.post("/reset-password", async (req, res) => {
    try {
        // Validate request parameter syntax
        await UserSchemas.passwordResetSchema.validate(req.body);
        const { email, pass, cpass, token } = req.body;
        
        // The user must exist
        const userExists = await UsersHelper.checkIfUserExists(email);
        if (!userExists) {
            return res.status(409).json({
                success: false,
                message: "user_not_found"
            });
        }

        // Passwords must match
        if (pass != cpass) {
            return res.status(400).json(
                { success: false, message: "passwords_do_not_match" }); 
        }
 
        // Validate recaptcha token
        const responseKey = req.body["g_recaptcha_response"];
        const recaptchaResult = await RecaptchaHelper.validateRecaptcha(responseKey);

        if (!recaptchaResult) {
            console.error("Captcha verification failed.");
            return res.status(400).json(
                { success: false, message: "captcha_error" });
        }

        // Step 1: Verify token validity (throws exception on error)
        await TokenHelper.validatePasswordResetToken(token, config.dbconnString);

        // Step 2: Update the password
        const updateResult = await UsersHelper.updatePassword(token, email, pass);
        
        if (!updateResult) {
            const error = "Failed to update password";
            console.error(error); 
            throw new Error(error);
        }

        res.status(200).send({ message: "password_reset_success"});
    } catch (err) {
        return res.status(500).send("password_reset_failure");
    }
});

router.get("/logout", (req, res) => {
    
    req.logout(function (err) {
        if (err) { 
            console.error("Error during logout:", err);
            return res.status(500).json({ message: "logout_failed" });
        }

        // Optionally destroy the session instead of nulling specific properties
        req.session.destroy((sessionErr) => {
            console.debug("attempting to destroy session");
            
            if (sessionErr) {
                console.error("Error destroying session:", sessionErr);
                return res.status(500).json({ message: "logout_failed" });
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
        scope:  ["email", "profile"],
        prompt: "consent"
    })
);

router.get("/google/callback",
    passport.authenticate("google", {
        failureRedirect: "/register"
    }),
    (req, res) => {
        res.redirect("/login_record");
    }
);

router.get("/login_record", async (req, res) => {
    try {                        
        EthicAppEventLogger.userLogin();
        res.redirect("/seslist");
    } catch (error) {
        console.error(error);
        res.redirect("/error");
    }
});
  
// Route to get the user's name and other details
router.post("/get-my-name", async (req, res) => {
    try {
        // Execute SQL query to fetch user's name, role, lang, and mail based on session uid
        const result = await execSQL({
            dbcon: config.dbconnString,
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
            return res.status(404).json({ error: "user_not_found" });
        }
    } catch (error) {
        console.error("Error in /get-my-name:", error);
        return res.status(500).json({ error: "complete_request_error" });
    }
});

router.post("/update-lang", async (req, res) => {
    try {
        // Execute SQL update to modify the user's language based on session uid
        await execSQL({
            dbcon: config.dbconnString,
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
        return res.status(200).json({ message: "language_updated_successfully" });
    } catch (error) {
        console.error("Error in /update-lang:", error);
        return res.status(500).json({ error: "language_update_failed" });
    }
});

router.get("/users/myinfo", async (req, res) => {
    try {
        // Validate session
        if (!req.session || !req.session.uid) {
            return res.status(401).json({ success: false, error: "unauthorized" });
        }

        // Execute the SQL query to get user information based on session uid
        const result = await execSQL({
            dbcon: config.dbconnString,
            sql: `
                SELECT 
                    u.id, 
                    u.name, 
                    u.mail as email,
                    ui.name AS institution_name
                FROM users u
                LEFT JOIN user_institutions ui ON u.institution_id = ui.id
                WHERE u.id = $1
                LIMIT 1
            `,
            sqlParams: [req.session.uid], // Directly pass the plain session uid
        });

        // Return user data if found, else return empty object
        if (result.length > 0) {
            return res.status(200).json({ success: true, data: result[0] });
        } else {
            return res.status(404).json({ success: false, error: "user_not_found" });
        }
    } catch (error) {
        console.error("Error in /users/myinfo:", { error, sessionId: req.session.uid });
        return res.status(500).json({ success: false, error: "internal_server_error" });
    }
});


router.post("/getuserinfo", async (req, res) => {
    try {
        // Execute the SQL query to get user information based on session uid
        const result = await execSQL({
            dbcon: config.dbconnString,
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
            return res.status(404).json({ error: "user_information_lookup_failure" });
        }
    } catch (error) {
        console.error("Error in /getuserinfo:", error);
        return res.status(500).json({ error: "user_information_failure" });
    }
});

export default router;
