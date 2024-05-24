const express = require('express');
const questionsRouter = require('./questions');
const responseRouter = require('./responses')
const designRouter = require('./designs')
const app = express();
const PORT = process.env.PORT || 3000;

//routers
app.use('/', questionsRouter);
app.use('/',designRouter);
app.use('/', responseRouter);


module.exports = app;
