const express = require('express');
const questionsRouter = require('./questions');
const responseRouter = require('./responses')
const designRouter = require('./designs')
const userRouter = require('./users')
const sessionRouter = require('./sessions')
const loginuserRouter = require('./loginUser')
const app = express();
const PORT = process.env.PORT || 3000;

app.use('/questions', questionsRouter);
app.use('/designs',designRouter);
app.use('/responses', responseRouter);
app.use('/users',userRouter);
app.use('/sessions',sessionRouter);
app.use('/login',loginuserRouter);

app.get('/', (req, res) => {
    res.send('¡Bienvenido a la API de EthicApp!');
});

app.listen(PORT, () => {
    console.log(`Servidor escuchando en el puerto ${PORT}`);
});

module.exports = app;
