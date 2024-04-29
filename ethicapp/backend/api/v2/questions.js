const express = require('express');
const router = express.Router();

// import model

const Question = require('../../controllers/api/v2/models/questions');

// Read
router.get('/questions', async (req, res) => {
    try {
      const questions = await Question.findAll();
      res.json(questions);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Error al obtener las preguntas' });
    }
  });

// Create

router.post('/questions', async (req, res) => {
    try {
      const question = await Question.create(req.body);
      res.status(201).json(question);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Error al crear la pregunta' });
    }
  });

// Update

router.put('/questions/:id', async (req, res) => {
    const { id } = req.params;
    try {
      const question = await Question.findByPk(id);
      if (!question) {
        return res.status(404).json({ message: 'Pregunta no encontrada' });
      }
      await question.update(req.body);
      res.json(question);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Error al actualizar la pregunta' });
    }
  });

//Delete

router.delete('/questions/:id', async (req, res) => {
    const { id } = req.params;
    try {
      const question = await Question.findByPk(id);
      if (!question) {
        return res.status(404).json({ message: 'Pregunta no encontrada' });
      }
      await question.destroy();
      res.status(204).end();
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Error al eliminar la pregunta' });
    }
  });

  module.exports = router;