"use strict";
// import { createRequire } from "module";
// const require = createRequire(import.meta.url);

//let index = require("./backend/controllers/index");
//let users = require("./backend/controllers/users");
//let adminApi = require("./backend/controllers/admin-panel-api");
// let sessions = require("./backend/controllers/sessions");
// let visor = require("./backend/controllers/visor");
// let analysis = require("./backend/controllers/analysis");
// let teams = require("./backend/controllers/teams");
// let rubrica = require("./backend/controllers/rubrica");
// let stages = require("./backend/controllers/stages");
// let content_analysis = require("./backend/controllers/content-analysis-controller");
// let pass = require("./backend/config/keys-n-secrets");
// let cases = require("./backend/controllers/cases");

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

import index from "./backend/controllers/index.js";
import passport from "./backend/controllers/users/passport-setup.js";
import users_core from "./backend/controllers/users/users-core.js";
import users_registration from "./backend/controllers/users/users-registration.js";

//import sessions from "./backend/controllers/sessions.js";

import { uploadsPath } from "./backend/config/config.js";
import { validateSession } from "./backend/middleware/validate-session.js";
import i18n from "i18n";
import path from "path";
import { fileURLToPath } from "url";
import expressLayouts from "express-ejs-layouts";

let app = express();

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

const assetPath = path.join(__dirname, "/frontend/assets");
app.use(express.static(assetPath));
app.use(assetVersions("/assets", assetPath));

// JSON handling for requests
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// view engine setup
app.set("views", path.join(__dirname, "frontend/views"));
app.set("view engine", "ejs");
app.use(expressLayouts); // Usar express-ejs-layouts
app.set("layout", "./layouts/basic-common"); 

// uncomment after placing your favicon in /public
app.use(logger("[EthicApp] :method :url :status - :response-time ms"));
busboy.extend(app, {
    upload:        true,
    mimeTypeLimit: ["application/pdf", "image/png"],
    path:          uploadsPath,
    limits:        { fileSize: 5*1024*1024 }
});
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "frontend")));
app.use("/uploads",express.static(path.join(__dirname, "frontend/assets")));

app.use(session({
    store: new FileStore({
        path:     path.join(__dirname, "/sessions"),
        retries:  0, // Desactivar reintentos temporales para identificar fallas inmediatas
        logFn:    function(msg) { console.log("FileStore Log:", msg); },
        fileMode: 0o600, // Cambia el modo de archivo para asegurar permisos mínimos necesarios
    }),
    secret:            process.env.SESSION_SECRET || "ssshhh",
    resave:            false,
    saveUninitialized: false,
    cookie:            { maxAge: 24 * 60 * 60 * 1000 } // Cookie para 1 día
}));

app.use("/", index);
app.use("/", users_core);
app.use("/", users_registration);
// app.use("/", validateSession, sessions);
// app.use("/", adminApi);
// app.use("/", validateSession, cases);
// app.use("/", validateSession, visor);
// app.use("/", validateSession, analysis);
// app.use("/", validateSession, teams);
// app.use("/", validateSession, rubrica);
// app.use("/", validateSession, stages);
// app.use("/", validateSession, content_analysis);

// catch 404 and forward to error handler
app.use((req, res, next) => {
    console.log(`[app.use error] req.path: '${req.path}'`);
    let err = new Error("Not Found");
    err.status = 404;
    next(err);
});

// error handler
app.use((err, req, res) => {
    // set locals, only providing error in development
    res.locals.message = err.message;
    res.locals.error = req.app.get("env") === "development" ? err : {};

    // render the error page
    res.status(err.status || 500);
    res.render("error");
});

export default app;