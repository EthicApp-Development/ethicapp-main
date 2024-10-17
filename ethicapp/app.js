"use strict";
import { createRequire } from "module";
const require = createRequire(import.meta.url);

let express = require("express");
let cors = require("cors");
let logger = require("morgan");
let cookieParser = require("cookie-parser");
let FileStore = require("session-file-store")(session);
let busboy = require("express-busboy");
let json2xls = require("json2xls");
let assetVersions = require("express-asset-versions");

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
require("serve-favicon");
require("dotenv").config({ path: "../.env" });

import session from "express-session";
import passport from "./backend/controllers/passport-setup.js";
import index from "./backend/controllers/index.js";
import users from "./backend/controllers/users.js";
//import sessions from "./backend/controllers/sessions.js";
import { uploadsPath } from "./backend/config/config.js";
import { validateSession } from "./backend/middleware/validate-session.js";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "redis";
import connectRedis from "connect-redis";

let app = express();

const allowedOrigins = process.env.ALLOWED_ORIGINS.split(",");
const corsOptions = {
    origin: function (origin, callback) {
        callback(null, true); // Permite todos los orígenes
    },
    credentials: true,
};

app.use(cors(corsOptions));

// Configure assets 
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const assetPath = path.join(__dirname, "/frontend/assets");
app.use(express.static(assetPath));
app.use(assetVersions("/assets", assetPath));

// view engine setup
app.set("views", path.join(__dirname, "frontend/views"));
app.set("view engine", "ejs");

// uncomment after placing your favicon in /public
//app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
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

/*
app.use(session({
    secret:            "ssshhh",
    saveUninitialized: false,
    resave:            false,
    store:             new FileStore({
        path:  path.join(__dirname, "sessions"),
        logFn: function (msg) { console.log(msg); },
    }),
}));
*/

const RedisStore = connectRedis(session);
const redisClient = createClient();

redisClient.connect().catch(console.error);

app.use(session({
    store:             new RedisStore({ client: redisClient }),
    secret:            "ssshhh",
    resave:            false,
    saveUninitialized: false
}));

app.use(json2xls.middleware);

app.use("/", index);
app.use("/", users);
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