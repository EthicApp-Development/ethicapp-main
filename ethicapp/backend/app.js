"use strict";

import dotenv from "dotenv";
dotenv.config({ path: "../.env" });

import express from "express";
import cors from "cors";
import logger from "morgan";
import cookieParser from "cookie-parser";

import busboy from "express-busboy";
import assetVersions from "express-asset-versions";

import session from "express-session";
import { default as fileStoreFactory } from "session-file-store"; 
const FileStore = fileStoreFactory(session);

import index from "./controllers/index.js";
import users_core from "./controllers/users/users-core.js";
import users_registration from "./controllers/users/users-registration.js";
import sessions from "./controllers/sessions.js";
import activities from "./controllers/activities.js";
import phases from "./controllers/phases.js";
import designs from "./controllers/designs.js";
import groups from "./controllers/groups.js";
import group_messages from "./controllers/group-messages.js";
import content_analysis from "./controllers/content-analysis-controller.js";
import admin_panel from "./controllers/admin-panel-api.js";
//import visor from "./controllers/visor.js";

import fs from "fs";

import * as config from "./config/config.js";
import { validateSession } from "./middleware/validate-session.js";
import i18n from "i18n";
import path from "path";
import { fileURLToPath } from "url";
import expressLayouts from "express-ejs-layouts";
import { renderScripts } from "./helpers/views-helper.js";
import { ErrorReply } from "redis";

let app = express();
app.set("trust proxy", true); // i.e., trust headers from a reverse proxy

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

const allowedOrigins = process.env.ALLOWED_ORIGINS.split(",");
const corsOptions = {
    origin: function (origin, callback) {
        callback(null, true); // Permite todos los orígenes
    },
    credentials: true,
};

app.use(cors(corsOptions));

// Asset handling
const assetPath = path.join(__dirname, "../frontend/assets");
app.use(express.static(assetPath));
app.use(assetVersions("/assets", assetPath));

// Uploads
app.use("/uploads", express.static(path.join(__dirname, "../frontend/assets/uploads")));

// view engine setup
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");
app.use(expressLayouts); // Usar express-ejs-layouts
app.set("layout", "./layouts/user-common"); 

// JSON handling for requests
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize the logger
// Get UTC date and time
logger.token("utc-date", function () {
    return new Date().toISOString();
});

app.use(logger("[:utc-date | EthicApp] :method :url :status - :response-time ms"));

// Setup busboy for uploads
busboy.extend(app, {
    upload:        true,
    mimeTypeLimit: ["application/pdf", "image/png"],
    path:          config.uploadsPath,
    limits:        { fileSize: 5*1024*1024 }
});

// Static path for frontend files
app.use(express.static(path.join(__dirname, "../frontend")));

// Set up cookies and session management
app.use(cookieParser());
app.use(session({
    store: new FileStore({
        path:     path.join(__dirname, "/sessions"),
        retries:  0,
        logFn:    function(msg) { console.log("FileStore Log:", msg); },
        fileMode: 0o600,
    }),
    secret:            process.env.SESSION_SECRET || "ssshhh",
    resave:            false,
    saveUninitialized: false,
    cookie:            { maxAge: 24 * 60 * 60 * 1000 } // Cookie para 1 día
}));

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

app.use("/", index);
app.use("/", users_core);
app.use("/", users_registration);
app.use("/", validateSession, sessions);
app.use("/", validateSession, activities);
app.use("/", validateSession, phases);
app.use("/", validateSession, groups);
app.use("/", validateSession, designs);
app.use("/", validateSession, group_messages);
app.use("/", validateSession, content_analysis);
//app.use("/", validateSession, visor);

//app.use("/", validateSession, cases);
app.use("/", admin_panel);

// app.use("/", validateSession, rubrica);

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