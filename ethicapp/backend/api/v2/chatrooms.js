const express = require('express');
const bodyParser = require('body-parser');
const router = express.Router();

const { Chatroom } = require('./models');

// Configure body-parser to process the body of requests in JSON format.
router.use(bodyParser.json());

// Read
router.get('/chatroom', async (req, res) => {
    try {
        const chatrooms = await Chatroom.findAll();
        res.status(200).json({ status: 'success', data: chatrooms });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// Create
router.post('/chatroom', async (req, res) => {
    try {
        const chatroom = await Chatroom.create(req.body);
        res.status(201).json({ status: 'success', data: chatroom });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// Update
router.put('/chatroom/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const chatroom = await Chatroom.findByPk(id);
        if (!chatroom) {
            return res.status(404).json({ status: 'error', message: 'Chatroom not found' });
        }
        await chatroom.update(req.body);
        res.json({ status: 'success', data: chatrooms });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// Delete
router.delete('/chatroom/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const chatroom = await Chatroom.findByPk(id);
        if (!chatroom) {
            return res.status(404).json({ status: 'error', message: 'Chatroom not found' });
        }
        await chatroom.destroy();
        res.status(204).end();
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});


module.exports = router;