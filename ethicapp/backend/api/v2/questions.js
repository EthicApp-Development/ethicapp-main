const express = require('express');
const bodyParser = require('body-parser'); // Importa body-parser
const router = express.Router();

// Import Model
//const Question = require('../../controllers/api/v2/models/questions');
const { Question } = require('../../controllers/api/v2/models');

// Configura body-parser para procesar el cuerpo de las solicitudes en formato JSON
router.use(bodyParser.json());

// Read
router.get('/', async (req, res) => {
    try {
        const questions = await Question.findAll();
        res.json(questions);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error al obtener las preguntas' });
    }
});

// Create
router.post('/', async (req, res) => {
    try {
        console.log("req --->", req.body)
        const question = await Question.create(req.body);
        res.status(201).json(question);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error al crear la pregunta' });
    }
});

// Update
router.put('/:id', async (req, res) => {
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

// Delete
router.delete('/:id', async (req, res) => {
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
