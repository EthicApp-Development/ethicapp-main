"use strict";

let express = require('express');
let session = require('express-session');
let path = require('path');
let favicon = require('serve-favicon');
let logger = require('morgan');
let cookieParser = require('cookie-parser');
let busboy = require('express-busboy');

let index = require('./routes/index');
let users = require('./routes/users');
let sessions = require("./routes/sessions");
let visor = require("./routes/visor");
let analysis = require("./routes/analysis");
let teams = require("./routes/teams");

let app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// uncomment after placing your favicon in /public
//app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
app.use(logger('dev'));
busboy.extend(app, {
    upload: true,
    mimeTypeLimit: ["application/pdf"],
    path: path.join(__dirname, 'uploads')
});
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use("/uploads",express.static(path.join(__dirname, 'uploads')));
app.use(session({secret: 'ssshhh', saveUninitialized: false, resave: false}));

app.use('/', index);
app.use('/', users);
app.use("/", sessions);
app.use("/", visor);
app.use("/", analysis);
app.use("/", teams);

// catch 404 and forward to error handler
app.use((req, res, next) => {
    let err = new Error('Not Found');
    err.status = 404;
    next(err);
});

// error handler
app.use((err, req, res) => {
    // set locals, only providing error in development
    res.locals.message = err.message;
    res.locals.error = req.app.get('env') === 'development' ? err : {};

    // render the error page
    res.status(err.status || 500);
    res.render('error');
});

module.exports = app;
