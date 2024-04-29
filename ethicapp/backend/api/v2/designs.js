const express = require('express');
const router = express.Router();

// import model

const Design = require('../../controllers/api/v2/models/designs')

// Read
router.get('/designs', async (req, res) => {
    try {
      const designs = await Design.findAll();
      res.json(designs);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Error al obtener los diseños' });
    }
  });

// Create

router.post('/designs', async (req, res) => {
    try {
      const design = await Design.create(req.body);
      res.status(201).json(design);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Error al crear el diseño' });
    }
  });

// Update

router.put('/designs/:id', async (req, res) => {
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

//Delete

router.delete('/designs/:id', async (req, res) => {
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
      res.status(500).json({ message: 'Error al eliminar la diseño' });
    }
  });

  module.exports = router;