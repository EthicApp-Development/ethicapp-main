const express = require('express');
const jwt = require('jsonwebtoken');
const { User } = require('./models');  // Asegúrate de importar el modelo correctamente
const bodyParser = require('body-parser');
const authenticateToken = require('./middleware/authenticateToken');
const router = express.Router();
router.use(bodyParser.json());

// Ruta para crear una sesión de usuario (login)
router.post('/user_session', async (req, res) => {
  try {
    console.log("req.body ->: ",req.body)
    const { mail, pass } = req.body; // Modifica para obtener el correo y contraseña desde el cuerpo de la solicitud
    
    const user = await User.findOne({ where: { mail } }); // Busca al usuario por correo
    if (!user || !user.validPassword(pass)) {
      return res.status(401).json({status: 'error', error: 'Usuario o contraseña incorrectos' });
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

// Ruta para terminar la sesión (logout)
router.delete('/user_session', (req, res) => {
  // JWT no permite un cierre de sesión directo, pero puedes manejarlo en el cliente
  res.json({ message: 'Sesión terminada. Por favor, elimina el token del lado cliente.' });
});

router.get('/logout', (req, res) => {
  // Similar a DELETE, no se puede invalidar un JWT ya emitido
  res.json({ message: 'Por favor, elimina el token del lado cliente para cerrar sesión.' });
});

// example the client token
router.get('/protected', authenticateToken, (req, res) => {
  console.log("req ->", req)
  res.json({ message: "Este es un contenido protegido", user: req.user });
});

module.exports = router;
