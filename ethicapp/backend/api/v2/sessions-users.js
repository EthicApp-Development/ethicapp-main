const express = require('express');
const bodyParser = require('body-parser'); // Importa body-parser
const router = express.Router();
const crypto = require('crypto');


// Import Model
const { Session, SessionsUsers } = require('../../api/v2/models');

// Configure body-parser to process the body of requests in JSON format.
router.use(bodyParser.json());

// CRUD operations for SessionsUsers

// Create session user
router.post('/sessions/:sessionId/users', async (req, res) => {
    const { sessionId } = req.params;
    try {
        const session = await Session.findByPk(sessionId);
        if (!session) {
            return res.status(404).json({ status: 'error', message: 'Session not found' });
        }
        console.log("req.body.user_id -> ", req.body.user_id)
        const sessionUser = await SessionsUsers.create({ session_id: sessionId, user_id: req.body.user_id });
        res.status(201).json({ status: 'success', data: sessionUser });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// Read session users
router.get('/sessions/:sessionId/users', async (req, res) => {
    const { sessionId } = req.params;
    try {
        const sessionUsers = await SessionsUsers.findAll({ where: { session_id: sessionId } });
        res.status(200).json({ status: 'success', data: sessionUsers });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// Delete session user
router.delete('/sessions/:sessionId/users/:userId', async (req, res) => {
    const { sessionId, userId } = req.params;
    try {
        const session = await Session.findByPk(sessionId);
        if (!session) {
            return res.status(404).json({ status: 'error', message: 'Session not found' });
        }
        const sessionUser = await SessionsUsers.findOne({ where: { session_id: sessionId, user_id: userId } });
        if (!sessionUser) {
            return res.status(404).json({ status: 'error', message: 'Session user not found' });
        }
        await sessionUser.destroy();
        res.status(204).end();
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

module.exports = router;
