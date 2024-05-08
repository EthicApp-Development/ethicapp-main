const express = require('express');
const bodyParser = require('body-parser'); // Importa body-parser
const router = express.Router();

// Import Model
const { Sessions, SessionsUsers } = require('../../api/v2/models');

router.use(bodyParser.json());

// Read
router.get('/', async (req, res) => {
    try {
        const sessions = await Sessions.findAll();
        res.status(200).json({ status: 'success', data: sessions });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// Create
router.post('/', async (req, res) => {
    try {
        const session = await Sessions.create(req.body);
        res.status(201).json({ status: 'success', data: session });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// Update
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const session = await Sessions.findByPk(id);
        if (!session) {
            return res.status(404).json({ status: 'error', message: 'Sessions not found' });
        }
        await session.update(req.body);
        res.json({ status: 'success', data: session });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// Delete
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const session = await Sessions.findByPk(id);
        if (!session) {
            return res.status(404).json({ status: 'error', message: 'Sessions not found' });
        }
        await session.destroy();
        res.status(204).end();
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// CRUD operations for SessionsUsers

// Create session user
router.post('/:sessionId/users', async (req, res) => {
    const { sessionId } = req.params;
    try {
        const session = await Sessions.findByPk(sessionId);
        if (!session) {
            return res.status(404).json({ status: 'error', message: 'Session not found' });
        }
        console.log("req.body.user_id -> ", req.body.user_id)
        const sessionUser = await SessionsUsers.create({ sesion_id: sessionId, user_id: req.body.user_id });
        res.status(201).json({ status: 'success', data: sessionUser });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// Read session users
router.get('/:sessionId/users', async (req, res) => {
    const { sessionId } = req.params;
    try {
        const sessionUsers = await SessionsUsers.findAll({ where: { sesion_id: sessionId } });
        res.status(200).json({ status: 'success', data: sessionUsers });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

module.exports = router;
