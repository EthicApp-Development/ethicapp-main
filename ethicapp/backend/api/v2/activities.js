const express = require('express');
const bodyParser = require('body-parser');
const router = express.Router();

const { Activity } = require('../../api/v2/models');

// Configure body-parser to process the body of requests in JSON format.
router.use(bodyParser.json());

router.get('/activity', (req, res) => {
    res.send('ACTIVITIES page');
});


module.exports = router;