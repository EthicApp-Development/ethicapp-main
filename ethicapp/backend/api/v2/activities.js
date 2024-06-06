const express = require('express');
const bodyParser = require('body-parser');
const router = express.Router();
const auth = require('../v2/middleware/authenticateToken');
const checkAbility = require('../v2/middleware/checkAbility');
const { Activity, Design, Session, Phase } = require('../../api/v2/models');

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
router.post('/activity', auth, checkAbility('create', 'Activity'), async (req, res) => {
    const { design, session } = req.body;
    const { id, role } = req.user;

    try {
        const designActivity = await Design.findByPk(design);
        if (!designActivity) {
            return res.status(400).json({ status: 'error', message: 'Design not found' });
        }
        const sessionActivity = await Session.findByPk(session);
        if (!sessionActivity) {
            return res.status(400).json({ status: 'error', message: 'Session not found' });
        }
        if (sessionActivity.creator !== id) {
            return res.status(403).json({ status: 'error', message: 'You do not own this session' });
        }
        const activity = await Activity.create({ design, session });
        res.status(201).json({ status: 'success', data: activity });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// Update
router.put('/activity/:id', auth, checkAbility('update', 'Activity'), async (req, res) => {
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
router.delete('/activity/:id', auth, checkAbility('delete', 'Activity'), async (req, res) => {
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

router.post('/activities/:id/init_next_phase', auth, checkAbility('update', 'Phase'), async (req, res) => {
    const { id } = req.params;
    const { role } = req.user;

    try {
        const activity = await Activity.findByPk(id);
        if (!activity) {
            return res.status(400).json({ status: 'error', message: 'Activity not found' });
        }
        const session = await Session.findByPk(activity.session);
        if (!session) {
            return res.status(400).json({ status: 'error', message: 'Session not found' });
        }
        if (session.creator !== req.user.id) {
            return res.status(403).json({ status: 'error', message: 'You do not own this session' });
        }

        const design = await Design.findByPk(activity.design);
        if (!design) {
            return res.status(400).json({ status: 'error', message: 'Design not found' });
        }

        const phases = await Phase.findAll({ where: { activity_id: activity.id } });
        const nextPhaseNumber = phases.length + 1;
        const nextPhaseDesign = design.design.phases.find(p => p.number === nextPhaseNumber);
        if (!nextPhaseDesign) {
            return res.status(400).json({ status: 'error', message: 'No more phases available in the design' });
        }
        const existingPhase = await Phase.findOne({ where: { activity_id: activity.id, number: nextPhaseNumber } });
        if (existingPhase) {
            return res.status(400).json({ status: 'error', message: 'Phase already initiated' });
        }
        const phase = await Phase.create({
            number: nextPhaseNumber,
            type: nextPhaseDesign.type || 'regular',
            anon: nextPhaseDesign.anon || false,
            chat: nextPhaseDesign.chat || false,
            prev_ans: nextPhaseDesign.prev_ans || '',
            activity_id: activity.id
        });
        res.status(201).json({ status: 'success', data: phase });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

router.get('/activities/:id/phases', async (req, res) => {
    const { id } = req.params;
    try {
        const activity = await Activity.findByPk(id);
        if (!activity) {
            return res.status(400).json({ status: 'error', message: 'Activity not found' });
        }

        const phases = await Phase.findAll({ where: { activity_id: activity.id } });
        res.status(200).json({ status: 'success', data: phases });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

module.exports = router;
