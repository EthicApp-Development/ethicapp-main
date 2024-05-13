const express = require('express');
const bodyParser = require('body-parser');
const router = express.Router();

const { Activity } = require('../../api/v2/models');

// Configure body-parser to process the body of requests in JSON format.
router.use(bodyParser.json());

// Read
router.get('/activity', async (req, res) => {
    try {
        const activities = await Activity.findAll();
        res.status(200).json({ status: 'success', data: activities });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// Create
router.post('/activity', async (req, res) => {
    try {
        const activity = await Activity.create(req.body);
        res.status(201).json({ status: 'success', data: activity });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// Update
router.put('/activity/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const activity = await Activity.findByPk(id);
        if (!activity) {
            return res.status(404).json({ status: 'error', message: 'Activity not found' });
        }
        await activity.update(req.body);
        res.json({ status: 'success', data: activity });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// Delete
router.delete('/activity/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const activity = await Activity.findByPk(id);
        if (!activity) {
            return res.status(404).json({ status: 'error', message: 'Activity not found' });
        }
        await activity.destroy();
        res.status(204).end();
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

module.exports = router;