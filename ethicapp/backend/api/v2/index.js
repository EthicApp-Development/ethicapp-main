const express = require('express');
const questionRouter = require('./questions');
const responseRouter = require('./responses')
const designRouter = require('./designs')
const userRouter = require('./users')
const sessionRouter = require('./sessions')
const loginUserRouter = require('./login-user')
const groupRouter = require('./group')
const chatroomRouter = require('./chatrooms')
const activityRouter = require('./activities')
const sessionUserRouter = require('./sessions-users')
const phaseRouter = require('./phases')
const app = express();
const API_VERSION_PATH_PREFIX = process.env.API_VERSION_PATH_PREFIX || '/api/v2';
const PORT = process.env.PORT || 3000;

app.use(`${API_VERSION_PATH_PREFIX}`,questionRouter);
app.use(`${API_VERSION_PATH_PREFIX}`,designRouter);
app.use(`${API_VERSION_PATH_PREFIX}`,phaseRouter);
app.use(`${API_VERSION_PATH_PREFIX}`,responseRouter);
app.use(`${API_VERSION_PATH_PREFIX}`,userRouter);
app.use(`${API_VERSION_PATH_PREFIX}`,sessionRouter);
app.use(`${API_VERSION_PATH_PREFIX}`,groupRouter);
app.use(`${API_VERSION_PATH_PREFIX}`,chatroomRouter);
app.use(`${API_VERSION_PATH_PREFIX}`,activityRouter);
app.use(`${API_VERSION_PATH_PREFIX}`,loginUserRouter);
app.use(`${API_VERSION_PATH_PREFIX}`,sessionUserRouter)


app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});

module.exports = app;
