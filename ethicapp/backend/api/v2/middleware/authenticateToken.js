const jwt = require('jsonwebtoken');
const { User } = require('../models');

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    console.log('No token provided');
    return res.status(401).json({ status: 'error', message: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, 'your_secret_key');
    const user = await User.findByPk(decoded.id);

    if (!user) {
      console.log('Invalid token: User not found');
      return res.status(401).json({ status: 'error', message: 'Invalid token' });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error('Error verifying token:', err);
    res.status(403).json({ status: 'error', message: 'Invalid token' });
  }
};

module.exports = authenticateToken;
