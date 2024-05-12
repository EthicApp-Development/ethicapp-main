const express = require('express');
const bodyParser = require('body-parser');
const router = express.Router();

const { Chatroom } = require('./models');

// Configure body-parser to process the body of requests in JSON format.
router.use(bodyParser.json());

router.get('/chatroom', (req, res) => {
    res.send('CHATROOM page');
});


module.exports = router;