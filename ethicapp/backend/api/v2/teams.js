const express = require('express');
const bodyParser = require('body-parser');
const router = express.Router();
const checkAbility = require('./middleware/checkAbility');

const { Team } = require('./models');

// Configure body-parser to process the body of requests in JSON format.
router.use(bodyParser.json());

// Read
router.get('/team', async (req, res) => {
    try {
        const teams = await Team.findAll();
        res.status(200).json({ status: 'success', data: teams });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// Create
router.post('/team', checkAbility('create', 'Team'), async (req, res) => {
    try {
        const team = await Team.create(req.body);
        res.status(201).json({ status: 'success', data: team });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// Update
router.put('/team/:id', checkAbility('update', 'Team'), async (req, res) => {
    const { id } = req.params;
    try {
        const team = await Team.findByPk(id);
        if (!team) {
            return res.status(404).json({ status: 'error', message: 'team not found' });
        }
        await team.update(req.body);
        res.json({ status: 'success', data: team });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// Delete
router.delete('/team/:id', checkAbility('delete', 'Team'), async (req, res) => {
    const { id } = req.params;
    try {
        const team = await Team.findByPk(id);
        if (!team) {
            return res.status(404).json({ status: 'error', message: 'team not found' });
        }
        await team.destroy();
        res.status(204).end();
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

module.exports = router;