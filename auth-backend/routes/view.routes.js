const express = require('express');
const path = require('path');

const router = express.Router();
const spaIndexPath = path.join(__dirname, '..', 'public', 'app', 'index.html');

router.get('/login', (req, res) => {
  res.sendFile(spaIndexPath);
});

router.get('/register', (req, res) => {
  res.sendFile(spaIndexPath);
});

router.get('/forgot', (req, res) => {
  res.sendFile(spaIndexPath);
});

router.get('/reset-password', (req, res) => {
  res.sendFile(spaIndexPath);
});

module.exports = router;