const express = require('express');
const bodyParser = require('body-parser');
const router = express.Router();

// Import Model
const { User } = require('../../api/v2/models');

// Configure body-parser to process the body of requests in JSON format.
router.use(bodyParser.json());

// Read
router.get('/register/users', async (req, res) => {
    try {
        const users = await User.findAll();
        res.status(200).json({ status: 'success', data: users });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// Create
router.post('/register/users', async (req, res) => {
    console.log('req.body -> ', req.body);
    const { pass, pass_confirmation } = req.body;
    
    // Validate password length
    if (pass.length < 8) {
        return res.status(400).json({ status: 'error', message: 'Password must be at least 8 characters long' });
    }

    // Validate password confirmation
    if (pass !== pass_confirmation) {
        return res.status(400).json({ status: 'error', message: 'Passwords do not match' });
    }

    try {
        const user = await User.create(req.body);
        res.status(201).json({ status: 'success', data: user });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// Update
router.put('/register/users/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const user = await User.findByPk(id);
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }
        await user.update(req.body);
        res.json({ status: 'success', data: user });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// Delete
router.delete('/register/users/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const user = await User.findByPk(id);
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }
        await user.destroy();
        res.status(204).end();
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

module.exports = router;