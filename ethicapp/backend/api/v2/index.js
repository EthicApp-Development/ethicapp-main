const express = require('express');
const questionsRouter = require('./questions');
const responseRouter = require('./responses')
const designRouter = require('./designs')
const userRouter = require('./users')
const sessionRouter = require('./sessions')
const loginUserRouter = require('./login-User')
const app = express();
const PORT = process.env.PORT || 3000;

app.use('/questions', questionsRouter);
app.use('/designs',designRouter);
app.use('/responses', responseRouter);
app.use('/users',userRouter);
app.use('/',sessionRouter);
app.use('/login',loginUserRouter);

app.get('/', (req, res) => {
    res.send('¡Bienvenido a la API de EthicApp!');
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});

module.exports = app;
