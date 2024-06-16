const express = require('express');
const jwt = require('jsonwebtoken');
const { User } = require('./models');  //  Make sure you import the model correctly
const bodyParser = require('body-parser');
const authenticateToken = require('./middleware/authenticateToken');
const router = express.Router();
const bcrypt = require('bcryptjs');
// Import Model
// Configure body-parser to process the body of requests in JSON format.
router.use(bodyParser.json());

// Secret key for JWT (in a real app, store this in an environment variable)
const JWT_SECRET = 'your_secret_key';

// Authentication route
router.post('/authenticate_client', async (req, res) => {
  const { mail, pass } = req.body;

  try {
    const user = await User.findOne({ where: { mail } });

    if (!user) {
      return res.status(401).json({ status: 'error', message: 'User not found' });
    }

    const isPasswordValid = bcrypt.compareSync(pass, user.pass);
    if (!isPasswordValid) {
      return res.status(401).json({ status: 'error', message: 'Invalid password' });
    }
    const userId = user.id
    const token = jwt.sign({ id: user.id, mail: user.mail }, JWT_SECRET, { expiresIn: '1h' });
    //console.log("token ->", token)
    res.status(200).json({ status: 'success', token, userId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});


// Path to logout (logout)
router.delete('/login/user_session', (req, res) => {
  // JWT does not allow a direct logout, but you can handle it in the client.
  res.json({ message: 'Session terminated. Please remove the token from the client side.' });
});

router.get('/logout', (req, res) => {
  // Similar to DELETE, you cannot override a JWT that has already been issued.
  res.json({ message: 'Please remove the client-side token to log out' });
});

// example the client token
router.get('/login/protected', authenticateToken, (req, res) => {
  res.json({ message: "This is protected content", user: req.user });
});



module.exports = router;
