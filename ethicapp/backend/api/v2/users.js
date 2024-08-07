const express = require('express');
const bodyParser = require('body-parser'); // Importa body-parser
const router = express.Router();
const checkAbility = require('../v2/middleware/checkAbility')
const auth = require('../v2/middleware/authenticateToken')
// Import Model
const { User } = require('../../api/v2/models');

// Configure body-parser to process the body of requests in JSON format.
router.use(bodyParser.json());

// Read
router.get('/users',auth,checkAbility('get', 'User'), async (req, res) => {
    try {
        const users = await User.findAll();
        res.status(200).json({ status: 'success', data: users });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// Create
router.post('/users', async (req, res) => {
    const { pass, pass_confirmation, mail, rut } = req.body;

    // Validate password length
    if (pass.length < 8) {
        return res.status(400).json({ status: 'error', message: 'Password must be at least 8 characters long' });
    }

    // Validate password confirmation
    if (pass !== pass_confirmation) {
        return res.status(400).json({ status: 'error', message: 'Passwords do not match' });
    }

    try { // This was put in place to avoid creating an infinite number of identical users, with different id's, so that they could be reused.
        const existingUser = await User.findOne({
            where: {
                mail: mail,
                rut: rut
            }
        })

        if (existingUser) {
            //console.log("Existe en la base de datos")
            return res.status(201).json({ status: 'success', data: existingUser, message: 'User already exist' });
        }
        /////////
        const user = await User.create(req.body);
        return res.status(201).json({ status: 'success', data: user });
    } catch (err) {
        console.error(err);
        return res.status(400).json({ status: 'error', message: 'invalid field' });
    }
});

// Update
router.put('/users/:id', auth, checkAbility('update', 'User'), async (req, res) => {
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
router.delete('/users/:id', async (req, res) => {
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

// Read One User
router.get('/users/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const user = await User.findByPk(id);
        res.status(200).json({ status: 'success', data: user });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

module.exports = router;
