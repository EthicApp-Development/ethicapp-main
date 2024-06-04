const express = require('express');
const bodyParser = require('body-parser'); // Importbody-parser
const router = express.Router();

// Import Model

const { Question, Phase } = require('../../api/v2/models');

// Configure body-parser to process the body of requests in JSON format.
router.use(bodyParser.json());

// Read
router.get('/questions', async (req, res) => {
    try {
        const questions = await Question.findAll();
        res.status(200).json({ status: 'success', data: questions });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// Create
router.post('/questions', async (req, res) => {
    const { text, phases_id } = req.body;
    if (!phases_id) {
        return res.status(400).json({ status: 'error', message: 'phases_id is required' });
    }
    try {
        const phase = await Phase.findByPk(phases_id);
        if (!phase) {
            return res.status(400).json({ status: 'error', message: 'Phase not found' });
        }

        const existingQuestion = await Question.findOne({ where: { phases_id, text } });
        if (existingQuestion) {
            return res.status(400).json({ status: 'error', message: 'Question already exists for this phase' });
        }

        const question = await Question.create(req.body);
        res.status(201).json({ status: 'success', data: question });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// Update
router.put('/questions/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const question = await Question.findByPk(id);
        if (!question) {
            return res.status(404).json({ status: 'error', message: 'Question not found' });
        }
        await question.update(req.body);
        res.json({ status: 'success', data: question });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// Delete
router.delete('/questions/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const question = await Question.findByPk(id);
        if (!question) {
            return res.status(404).json({ status: 'error', message: 'Question not found' });
        }
        await question.destroy();
        res.status(204).end();
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

module.exports = router;
