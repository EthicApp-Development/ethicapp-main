const jwt = require('jsonwebtoken');

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];  // Bearer TOKEN
  if (token == null) return res.sendStatus(401); // No token provided

  jwt.verify(token, 'your_secret_key', (err, user) => {
    if (err) return res.sendStatus(403); // Token no longer valid
    req.user = user;
    next();
  });
};

module.exports = authenticateToken;
