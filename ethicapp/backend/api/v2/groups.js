const express = require('express');
const bodyParser = require('body-parser');
const router = express.Router();

const { Team } = require('../../api/v2/models');

// Configure body-parser to process the body of requests in JSON format.
router.use(bodyParser.json());

router.get('/group', (req, res) => {
    res.send('GROUP page');
});


module.exports = router;