const express = require('express');
const bodyParser = require('body-parser');
const router = express.Router();
const authenticateToken = require('../../api/v2/middleware/authenticateToken');
const checkAbility = require('../v2/middleware/checkAbility');
// Import Model

const { Question, Response, Session, Phase, User, Design, Activity } = require('../../api/v2/models');

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

    try {

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


// Create a response for a question
router.post('/questions/:id/responses', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { content, type } = req.body;
    const userId = req.user.id; // from authenticateToken

    try {
        const question = await Question.findByPk(id);
        if (!question) {
            return res.status(404).json({ status: 'error', message: 'Question not found' });
        }

        const phase = await Phase.findByPk(question.phase_id);
        if (!phase) {
            return res.status(404).json({ status: 'error', message: 'Phase not found' });
        }
        const activity = await Activity.findByPk(phase.activity_id);
        if (!activity) {
            return res.status(404).json({ status: 'error', message: 'Activity not found' });
        }

        const session = await Session.findByPk(activity.session);
        if (!session) {
            return res.status(404).json({ status: 'error', message: 'Session not found' });
        }
        //console.log(session)
        const existingResponse = await Response.findOne({ where: { user_id: userId, question_id: id } });
        if (existingResponse) {
            return res.status(400).json({ status: 'error', message: 'You have already responded to this question' });
        }

        const response = await Response.create({
            user_id: userId,
            content,
            type,
            question_id: id
        });

        res.status(201).json({ status: 'success', data: response });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// Update a response for a question
router.put('/questions/:id/responses', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { content, type } = req.body;
    const userId = req.user.id; //from authenticateToken

    try {
        const response = await Response.findOne({ where: { user_id: userId, question_id: id } });
        if (!response) {
            return res.status(404).json({ status: 'error', message: 'Response not found' });
        }
        await response.update({ content, type });

        res.json({ status: 'success', data: response });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// Get all responses for a question
router.get('/questions/:id/responses', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id; // from authenticateToken

    try {
        const question = await Question.findByPk(id);
        if (!question) {
            return res.status(404).json({ status: 'error', message: 'Question not found' });
        }

        const phase = await Phase.findByPk(question.phase_id);
        if (!phase) {
            return res.status(404).json({ status: 'error', message: 'Phase not found' });
        }

        const activity = await Activity.findByPk(phase.activity_id);
        if (!activity) {
            return res.status(404).json({ status: 'error', message: 'Activity not found' });
        }

        const session = await Session.findByPk(activity.session);
        if (!session) {
            return res.status(404).json({ status: 'error', message: 'Session not found' });
        }
        console.log(session.creator)
        console.log(userId)
        if (session.creator !== userId) {
            return res.status(403).json({ status: 'error', message: 'Only the professor who owns the session can view responses' });
        }

        const responses = await Response.findAll({ where: { question_id: id } });

        res.status(200).json({ status: 'success', data: responses });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});


module.exports = router;
