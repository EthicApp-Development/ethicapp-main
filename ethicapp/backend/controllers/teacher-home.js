"use strict";

import express from "express";
import * as ViewsHelper from "../helpers/views-helper.js";

const router = express.Router();

router.get("/home", (req, res) => {
    if (req.session.role !== "P") {
        return res.redirect(".");
    }

    try {
        return res.render("home", {
            layout:     "./layouts/teacher-app",
            ngApp:      "TeacherApp",
            scripts:    [
                ["libs/angular-glue.min.js"],
                ["js/dist/teacher-admin.js", "js/dist/teacher-admin.min.js"],
                ["libs/save-csv.min.js"],
            ],
            renderScripts:       (scripts) => ViewsHelper.renderScripts(scripts, res),
            recaptchaEnabled:    String(process.env.RECAPTCHA_ENABLED || "false").toLowerCase() === "true",
            recaptchaSiteKey:    process.env.VITE_RECAPTCHA_SITE_KEY || "",
        });
    } catch (error) {
        console.error("Error rendering teacher home:", error);
        return res.status(500).end();
    }
});

export default router;
