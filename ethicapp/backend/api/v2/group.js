const express = require('express');
const bodyParser = require('body-parser');
const router = express.Router();
const checkAbility = require('./middleware/checkAbility');

const { Group } = require('./models')

// Configure body-parser to process the body of requests in JSON format.
router.use(bodyParser.json());

// Read
router.get('/group', async (req, res) => {
    try {
        const groups = await Group.findAll();
        res.status(200).json({ status: 'success', data: groups });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// Create
router.post('/group', checkAbility('create', 'group'), async (req, res) => {
    try {
        const group = await Group.create(req.body);
        res.status(201).json({ status: 'success', data: group });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// Update
router.put('/group/:id', checkAbility('update', 'group'), async (req, res) => {
    const { id } = req.params;
    try {
        const group = await Group.findByPk(id);
        if (!group) {
            return res.status(404).json({ status: 'error', message: 'group not found' });
        }
        await group.update(req.body);
        res.json({ status: 'success', data: group });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// Delete
router.delete('/group/:id', checkAbility('delete', 'group'), async (req, res) => {
    const { id } = req.params;
    try {
        const group = await Group.findByPk(id);
        if (!group) {
            return res.status(404).json({ status: 'error', message: 'group not found' });
        }
        await group.destroy();
        res.status(204).end();
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

module.exports = router;