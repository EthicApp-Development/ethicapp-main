"use strict";

let express = require("express");
let session = require("express-session");
let path = require("path");
let fs = require("fs");
let favicon = require("serve-favicon");
let logger = require("morgan");
let cookieParser = require("cookie-parser");
let FileStore = require("session-file-store")(session);
let busboy = require("express-busboy");
let sss = require("simple-stats-server");
let json2xls = require("json2xls");

let index = require("./routes/index");
let users = require("./routes/users");
let sessions = require("./routes/sessions");
let visor = require("./routes/visor");
let analysis = require("./routes/analysis");
let teams = require("./routes/teams");
let rubrica = require("./routes/rubrica");
let geo = require("./routes/geo");
let stages = require("./routes/stages");
let pass = require("./modules/passwords");

let app = express();
app.set("trust proxy", 1);

const hydrateLegacySession = require('./middlewares/hydrateLegacySession');
const exposeLegacySession = require('./middlewares/exposeLegacySession');
const requireLegacyAuth = require('./middlewares/requireLegacyAuth');

// view engine setup
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

// uncomment after placing your favicon in /public
//app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
app.use(logger("[Readings] :method :url :status - :response-time ms"));
busboy.extend(app, {
    upload:        true,
    mimeTypeLimit: ["application/pdf"],
    path:          pass.uploadPath,
    limits:        { fileSize: 5*1024*1024 }
});
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads",express.static(path.join(__dirname, "uploads")));

const sessionsPath = path.resolve("/app/sessions");

if (!fs.existsSync(sessionsPath)) {
    fs.mkdirSync(sessionsPath, { recursive: true });
}

app.use(session({
  store: new FileStore({
    path: sessionsPath,
    retries: 1
  }),
  secret: process.env.SESSION_SECRET || "legacy-dev-secret",
  resave: false,
  saveUninitialized: false
}));

app.use(hydrateLegacySession);
app.use(exposeLegacySession);

// ruta de prueba
app.get('/debug/session', requireLegacyAuth, function (req, res) {
  res.json({
    uid: req.session.uid || null,
    role: req.session.role || null,
    sesid: req.session.sesid || null
  });
});

app.use("/stats",sss());
app.use(json2xls.middleware);

app.use("/", requireLegacyAuth, index);
app.use("/", requireLegacyAuth, users);
app.use("/", requireLegacyAuth, sessions);
app.use("/", requireLegacyAuth, visor);
app.use("/", requireLegacyAuth, analysis);
app.use("/", requireLegacyAuth, teams);
app.use("/", requireLegacyAuth, rubrica);
app.use("/", requireLegacyAuth, geo);
app.use("/", requireLegacyAuth, stages);

// catch 404 and forward to error handler
app.use((req, res, next) => {
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
