const express = require('express');
const questionsRouter = require('./questions');
const responseRouter = require('./responses')
const designRouter = require('./designs')
const app = express();
const PORT = process.env.PORT || 3000;

//routers
app.use('/questions', questionsRouter);
app.use('/designs',designRouter);
app.use('/responses', responseRouter);



app.get('/', (req, res) => {
    res.send('¡Bienvenido a la API de EthicApp!');
});


module.exports = app;
