const express = require('express');
const bodyParser = require('body-parser');
const router = express.Router();

// Import Model
const { Design } = require('../../controllers/api/v2/models');

// Configura body-parser para procesar el cuerpo de las solicitudes en formato JSON
router.use(bodyParser.json());

// Read
router.get('/', async (req, res) => {
    try {
      const designs = await Design.findAll();
      res.json(designs);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Error al obtener los diseños' });
    }
});

// Create
router.post('/', async (req, res) => {
    try {
        console.log("req --->",req.body)
      const design = await Design.create(req.body);
      res.status(201).json(design);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Error al crear el diseño' });
    }
});

// Update
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    try {
      const design = await Design.findByPk(id);
      if (!design) {
        return res.status(404).json({ message: 'diseño no encontrada' });
      }
      await design.update(req.body);
      res.json(design);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Error al actualizar el diseño' });
    }
});

// Delete
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
      const design = await Design.findByPk(id);
      if (!design) {
        return res.status(404).json({ message: 'diseño no encontrada' });
      }
      await design.destroy();
      res.status(204).end();
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Error al eliminar el diseño' });
    }
});

module.exports = router;
