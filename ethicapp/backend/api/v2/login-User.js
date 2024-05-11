const express = require('express');
const jwt = require('jsonwebtoken');
const { User } = require('./models');  //  Make sure you import the model correctly
const bodyParser = require('body-parser');
const authenticateToken = require('./middleware/authenticateToken');
const router = express.Router();
router.use(bodyParser.json());

// Path to create a user session (login)
router.post('/user_session', async (req, res) => {
  try {
    console.log("req.body ->: ",req.body)
    const { mail, pass } = req.body; // 
    
    const user = await User.findOne({ where: { mail } }); // Modifies to get the email and password from the body of the request
    if (!user || !user.validPassword(pass)) {
      return res.status(401).json({status: 'error', error: 'Incorrect login or password' });
    }
    const userId = user.dataValues.id;
    const token = jwt.sign({id: userId}, 'your_secret_key',  { expiresIn: '1h' })
    console.log("token -->", token)
    res.json({ token });
  }
  catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }

});

// Path to logout (logout)
router.delete('/user_session', (req, res) => {
  // JWT does not allow a direct logout, but you can handle it in the client.
  res.json({ message: 'Session terminated. Please remove the token from the client side.' });
});

router.get('/logout', (req, res) => {
  // Similar to DELETE, you cannot override a JWT that has already been issued.
  res.json({ message: 'Please remove the client-side token to log out' });
});

// example the client token
router.get('/protected', authenticateToken, (req, res) => {
  res.json({ message: "This is protected content", user: req.user });
});

module.exports = router;
