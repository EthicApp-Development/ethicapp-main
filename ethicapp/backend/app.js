"use strict";

import dotenv from "dotenv";
dotenv.config({ path: "../.env" });

import express from "express";
import cors from "cors";
import logger from "morgan";
import cookieParser from "cookie-parser";

import assetVersions from "express-asset-versions";

import session from "express-session";
import { createLegacySessionStore } from "./db/session-redis.js";

import user_profile from "./controllers/users/user-profile.js";
import impersonation from "./controllers/users/impersonation.js";
import sessions from "./controllers/sessions.js";
import activitiesCommon from "./controllers/activities/activities-common.js";
import activitiesTeacher from "./controllers/activities/activities-teacher.js";
import activitiesStudent from "./controllers/activities/activities-student.js";
import activityReports from "./controllers/activities/reports.js";
import phases from "./controllers/phases.js";
import designs from "./controllers/designs.js";
import groups from "./controllers/groups.js";
import group_messages from "./controllers/group-messages.js";
import cases from "./controllers/cases.js";

import fs from "fs";

import { uploadsPath } from "./config/uploads.config.js";
import i18n from "i18n";
import path from "path";
import { fileURLToPath } from "url";
import expressLayouts from "express-ejs-layouts";
import { renderScripts } from "./helpers/views-helper.js";
import redisClient from "./db/redis.js"; // Importar el módulo centralizado
import { ErrorReply } from "redis";
import {
  hydrateLegacySession,
  exposeLegacySession,
  requireLegacyAuth
} from './middleware/index.js';

let app = express();
app.set("trust proxy", true); // i.e., trust headers from a reverse proxy

app.set("trust proxy", 1);

// Configure assets 
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

i18n.configure({
    locales:        ["es_CL", "en_US"],
    directory:      path.join(__dirname, "locales"),
    defaultLocale:  "en_US",
    queryParameter: "lang",
    objectNotation: true,
});

app.use(i18n.init);

//const allowedOrigins = process.env.ALLOWED_ORIGINS.split(",");
const corsOptions = {
    origin: function (origin, callback) {
        callback(null, true); // Permite todos los orígenes
    },
    credentials: true,
};

app.use(cors(corsOptions));

// Asset handling
const assetPath = path.join(__dirname, "../frontend/assets");
const uploadsAbsolutePath = path.resolve(process.cwd(), uploadsPath);
app.use(express.static(assetPath));
app.use(assetVersions("/assets", assetPath));

// Uploads
app.use("/uploads", express.static(uploadsAbsolutePath));
app.use("/assets/uploads", express.static(uploadsAbsolutePath));

// view engine setup
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");
app.use(expressLayouts); // Usar express-ejs-layouts
app.set("layout", "./layouts/teacher-app");

// JSON handling for requests
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize the logger
// Get UTC date and time
logger.token("utc-date", function () {
    return new Date().toISOString();
});

app.use(logger("[:utc-date | EthicApp] :method :url :status - :response-time ms"));

// Static path for frontend files
app.use(express.static(path.join(__dirname, "../frontend")));

// Set up cookies and session management
app.use(cookieParser());
app.use(session({
    store:             createLegacySessionStore(),
    name:              process.env.ETHICAPP_SESSION_COOKIE_NAME || "ethicapp.sid",
    secret:            process.env.SESSION_SECRET || "legacy-dev-secret",
    resave:            false,
    saveUninitialized: false,
    cookie:            {
        httpOnly: true,
        secure:   process.env.ETHICAPP_SESSION_COOKIE_SECURE
            ? process.env.ETHICAPP_SESSION_COOKIE_SECURE === "true"
            : process.env.NODE_ENV === "production",
        sameSite: process.env.ETHICAPP_SESSION_COOKIE_SAMESITE || "lax",
        maxAge:   Number(process.env.ETHICAPP_SESSION_COOKIE_MAX_AGE_MS || 24 * 60 * 60 * 1000),
    },
}));

app.use(hydrateLegacySession);
app.use(exposeLegacySession);

// Middleware for handling redis errors
app.use((req, res, next) => {
    if (!redisClient.status || redisClient.status !== "ready") {
        return res.status(500).json({ error: "Redis is not connected" });
    }
    next();
});

// Load build_hash.json
const buildHashPath = path.join(__dirname, "build_hash.json");
let ETHICAPP_BUILD_HASH = "";

try {
    const buildData = JSON.parse(fs.readFileSync(buildHashPath, "utf8"));
    ETHICAPP_BUILD_HASH = buildData.build_hash;
} catch (error) {
    console.error("Error loading build_hash.json:", error);
}

// Make ETHICAPP_BUILD_HASH available in the entire application
app.locals.ETHICAPP_BUILD_HASH = ETHICAPP_BUILD_HASH;

app.use("/", requireLegacyAuth, user_profile);
app.use("/", requireLegacyAuth, impersonation);
app.use("/", requireLegacyAuth, sessions);
app.use("/", requireLegacyAuth, activitiesCommon);
app.use("/", requireLegacyAuth, activitiesTeacher);
app.use("/", requireLegacyAuth, activitiesStudent);
app.use("/", requireLegacyAuth, activityReports);
app.use("/", requireLegacyAuth, phases);
app.use("/", requireLegacyAuth, groups);
app.use("/", requireLegacyAuth, designs);
app.use("/", requireLegacyAuth, group_messages);
app.use("/", requireLegacyAuth, cases);

// Catch 404 and forward to error handler
app.use((req, res, next) => {
    console.log(`[404 error] Request path: '${req.path}'`);
    const err = new Error("Not Found");
    err.status = 404;
    next(err);
});

// Error handler
app.use((err, req, res, next) => {
    if (!err || typeof err !== "object") {
        err = new Error("Unknown error occurred");
        err.status = 500; // Establece un estado predeterminado si no existe
    }

    console.error(`GENERIC ERROR HANDLER: Status ${err.status || 500}, Message: ${err.message || "No message available"}`);
    
    const env = req.app.get("NODE_ENV") || "production";

    // Log the error for debugging (if not production)
    if (env === "development" || env === "test") {
        console.error(`[${err.status || 500}] ${err.message}`);
    }

    // Determine error message key based on status
    const statusCode = err.status || 500;
    const messageKeys = {
        400: "400_bad_request",
        401: "401_unauthorized",
        403: "403_forbidden",
        404: "404_not_found",
        500: "500_internal_server_error",
    };
    const messageKey = messageKeys[statusCode] || "xxx_unknown_error";

    // Set locals for error rendering
    res.locals.error = env === "production" ? {} : err;
    res.locals.message = err.message;
    
    // Render the error page
    res.status(statusCode).render("error", {
        message_key: messageKey,
        error:       res.locals.error,
    });
});

export default app;
