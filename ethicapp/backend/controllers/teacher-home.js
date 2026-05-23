"use strict";

import express from "express";
import * as ViewsHelper from "../helpers/views-helper.js";

const router = express.Router();

router.get("/home", (req, res) => {
    if (req.session.role !== "P") {
        return res.redirect(".");
    }

    return res.render("home", {
        layout: "./layouts/teacher-app",
        ngApp:  "TeacherApp",
        scripts: [
            ["js/dist/teacher-admin.js", "js/dist/teacher-admin.min.js"],
        ],
        renderScripts:     (scripts) => ViewsHelper.renderScripts(scripts, res),
        recaptchaEnabled:  String(process.env.RECAPTCHA_ENABLED || "false").toLowerCase() === "true",
        recaptchaSiteKey:  process.env.VITE_RECAPTCHA_SITE_KEY || "",
    });
});

export default router;
