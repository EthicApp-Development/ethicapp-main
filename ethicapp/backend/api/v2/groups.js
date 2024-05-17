const express = require('express');
const bodyParser = require('body-parser');
const router = express.Router();

const { Team } = require('../../api/v2/models');

// Configure body-parser to process the body of requests in JSON format.
router.use(bodyParser.json());

// Read
router.get('/group', async (req, res) => {
    try {
        const groups = await Team.findAll();
        res.status(200).json({ status: 'success', data: groups });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// Create
router.post('/group', async (req, res) => {
    try {
        const group = await Team.create(req.body);
        res.status(201).json({ status: 'success', data: group });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// Update
router.put('/group/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const group = await Team.findByPk(id);
        if (!group) {
            return res.status(404).json({ status: 'error', message: 'Group not found' });
        }
        await group.update(req.body);
        res.json({ status: 'success', data: group });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// Delete
router.delete('/group/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const group = await Team.findByPk(id);
        if (!group) {
            return res.status(404).json({ status: 'error', message: 'Group not found' });
        }
        await group.destroy();
        res.status(204).end();
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

module.exports = router;