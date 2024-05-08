const express = require('express');
const jwt = require('jsonwebtoken');
const { User } = require('./models');  // Asegúrate de importar el modelo correctamente
const bodyParser = require('body-parser');
const router = express.Router();
router.use(bodyParser.json());

// Ruta para crear una sesión de usuario (login)
router.post('/user_session', async (req, res) => {
    console.log("req.body ->: ",req.body)
    const { mail, pass } = req.body; // Modifica para obtener el correo y contraseña desde el cuerpo de la solicitud
    
    const user = await User.findOne({ where: { mail } }); // Busca al usuario por correo

  if (!user || !user.validPassword(pass)) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }

  const token = jwt.sign({ id: user.id }, 'your_secret_key', { expiresIn: '1h' });  // Asegúrate de usar una clave secreta segura
  res.json({ token });
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

module.exports = router;
