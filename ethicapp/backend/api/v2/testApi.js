const express = require('express');
const questionRouter = require('./questions');
const responseRouter = require('./responses')
const designRouter = require('./designs')
const userRouter = require('./users')
const sessionRouter = require('./sessions')
const loginUserRouter = require('./login-user')
const groupRouter = require('./groups')
const chatroomRouter = require('./chatrooms')
const activityRouter = require('./activities')
const sessionUserRouter = require('./sessions-users')
const app = express();
const PORT = process.env.PORT || 3000;

app.use('/',questionRouter);
app.use('/',designRouter);
app.use('/',responseRouter);
app.use('/',userRouter);
app.use('/',sessionRouter);
app.use('/',groupRouter);
app.use('/',chatroomRouter);
app.use('/',activityRouter);
app.use('/',loginUserRouter);
app.use('/',sessionUserRouter)

module.exports = app;
