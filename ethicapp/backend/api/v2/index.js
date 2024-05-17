const express = require('express');
const questionsRouter = require('./questions');
const responseRouter = require('./responses')
const designRouter = require('./designs')
const userRouter = require('./users')
const sessionRouter = require('./sessions')
const loginUserRouter = require('./login-user')
const groupRouter = require('./groups')
const chatroomRouter = require('./chatrooms')
const activiyRouter = require('./activities')
const app = express();
const PORT = process.env.PORT || 3000;

app.use('/',questionsRouter);
app.use('/',designRouter);
app.use('/',responseRouter);
app.use('/',userRouter);
app.use('/',sessionRouter);
app.use('/',groupRouter);
app.use('/',chatroomRouter);
app.use('/',activiyRouter);
app.use('/login',loginUserRouter);


app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});

module.exports = app;
