const express = require('express');
const router = express.Router();

// import model

//const Response = require('../../controllers/api/v2/models/responses')
const { Response } = require('../../controllers/api/v2/models');

// Read
router.get('/', async (req, res) => {
    try {
      const responses = await Response.findAll();
      res.json(responses);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Error al obtener las respuestas' });
    }
  });

// Create

router.post('/', async (req, res) => {
    try {
      const response = await Response.create(req.body);
      res.status(201).json(response);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Error al crear la respuesta' });
    }
  });

// Update

router.put('/:id', async (req, res) => {
    const { id } = req.params;
    try {
      const response = await Response.findByPk(id);
      if (!response) {
        return res.status(404).json({ message: 'respuesta no encontrada' });
      }
      await response.update(req.body);
      res.json(response);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Error al actualizar la respuesta' });
    }
  });

//Delete

router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
      const response = await Response.findByPk(id);
      if (!response) {
        return res.status(404).json({ message: 'respuesta no encontrada' });
      }
      await response.destroy();
      res.status(204).end();
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Error al eliminar la respuesta' });
    }
  });

  module.exports = router;