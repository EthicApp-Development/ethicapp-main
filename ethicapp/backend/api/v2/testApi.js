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
const API_VERSION_PATH_PREFIX = process.env.API_VERSION_PATH_PREFIX || '/api/v2';

app.use(`${API_VERSION_PATH_PREFIX}`,questionRouter);
app.use(`${API_VERSION_PATH_PREFIX}`,designRouter);
app.use(`${API_VERSION_PATH_PREFIX}`,responseRouter);
app.use(`${API_VERSION_PATH_PREFIX}`,userRouter);
app.use(`${API_VERSION_PATH_PREFIX}`,sessionRouter);
app.use(`${API_VERSION_PATH_PREFIX}`,groupRouter);
app.use(`${API_VERSION_PATH_PREFIX}`,chatroomRouter);
app.use(`${API_VERSION_PATH_PREFIX}`,activityRouter);
app.use(`${API_VERSION_PATH_PREFIX}`,loginUserRouter);
app.use(`${API_VERSION_PATH_PREFIX}`,sessionUserRouter)

module.exports = app;
