"use strict";

let express = require("express");
let cors = require("cors");
let session = require("express-session");
let path = require("path");
let logger = require("morgan");
let cookieParser = require("cookie-parser");
let FileStore = require("session-file-store")(session);
let busboy = require("express-busboy");
let sss = require("simple-stats-server");
let json2xls = require("json2xls");
let assetVersions = require("express-asset-versions");

let index = require("./backend/controllers/index");
let users = require("./backend/controllers/users");
let admin_api = require("./backend/controllers/admin-panel-api");
let sessions = require("./backend/controllers/sessions");
let visor = require("./backend/controllers/visor");
let analysis = require("./backend/controllers/analysis");
let teams = require("./backend/controllers/teams");
let rubrica = require("./backend/controllers/rubrica");
let stages = require("./backend/controllers/stages");
let pass = require("./backend/config/keys-n-secrets");
let middleware = require("./backend/middleware/validate-session");
require("serve-favicon");
require("./backend/controllers/passport-setup");
require("dotenv").config();

let app = express();


const allowedOrigins = process.env.ALLOWED_ORIGINS.split(",");
const corsOptions = {
    origin:      allowedOrigins,
    credentials: true,
};


app.use(cors(corsOptions));



//express asset versions
var assetPath = path.join(__dirname, "/frontend/assets");
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
    path:          pass.uploadPath,
    limits:        { fileSize: 5*1024*1024 }
});
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "frontend")));
app.use("/uploads",express.static(path.join(__dirname, "frontend/assets")));
app.use(session({
    secret:            "ssshhh",
    saveUninitialized: false,
    resave:            false,
    store:             new FileStore()
}));
app.use("/stats",sss());
app.use(json2xls.middleware);

app.use("/", index);
app.use("/", users);
app.use("/", admin_api);
app.use("/", middleware.verifySession, sessions);
app.use("/", middleware.verifySession, visor);
app.use("/", middleware.verifySession, analysis);
app.use("/", middleware.verifySession, teams);
app.use("/", middleware.verifySession, rubrica);
app.use("/", middleware.verifySession, stages);

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

module.exports = app;
