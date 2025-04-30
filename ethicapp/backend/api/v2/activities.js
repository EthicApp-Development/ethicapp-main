const express = require('express');
const bodyParser = require('body-parser');
const router = express.Router();
const auth = require('../v2/middleware/authenticateToken');
const checkAbility = require('../v2/middleware/checkAbility');
const { Activity, Design, Session, Phase, Group, groupUser } = require('./models');
const { studentNotifications } = require('./config/socket.config.js');
const { groupingAlgorithms } = require('../../helpers/groups-helper.js');

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

// GET /activities/:activity_id
router.get('/activities/:activity_id', async (req, res) => {
    const { activity_id } = req.params;
 
 
    try {
        const activity = await Activity.findByPk(activity_id, {
            include: {
                model: Phase,
                as: 'Phases',
                attributes: ['id', 'number', 'status'] 
            }
        });
        if (!activity) {
            return res.status(404).json({ status: 'error', message: 'Activity not found' });
        }
 
 
        res.status(200).json({
            status: 'success',
            data: {
                activity_id: activity.id,
                name: activity.name,
                phases: activity.Phases
            }
        });
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

router.post(
    '/activities/:id/init_next_phase',
    auth,
    checkAbility('update', 'Phase'),
    async (req, res) => {
      const { id } = req.params;
      try {
        console.log('[init] Buscar actividad:', id);
        const activity = await Activity.findByPk(id);
        if (!activity) return res.status(400).json({ status: 'error', message: 'Activity not found' });
  
        console.log('[init] Buscar sesión:', activity.session);
        const session = await Session.findByPk(activity.session);
        if (!session) return res.status(400).json({ status: 'error', message: 'Session not found' });
        if (session.creator !== req.user.id)
          return res.status(403).json({ status: 'error', message: 'You do not own this session' });
  
        console.log('[init] Buscar diseño:', activity.design);
        const designInstance = await Design.findByPk(activity.design);
        if (!designInstance) return res.status(400).json({ status: 'error', message: 'Design not found' });
        const design = typeof designInstance.design === 'string'
          ? JSON.parse(designInstance.design)
          : designInstance.design;
  
        const existingPhases = await Phase.findAll({ where: { activity_id: activity.id } });
        const nextPhaseNumber = existingPhases.length + 1;
        const nextPhaseDesign = design.phases.find(p => p.number === nextPhaseNumber);
        if (!nextPhaseDesign)
          return res.status(400).json({ status: 'error', message: 'No more phases available in the design' });
        if (await Phase.findOne({ where: { activity_id: activity.id, number: nextPhaseNumber } }))
          return res.status(400).json({ status: 'error', message: 'Phase already initiated' });
  
        console.log('[init] Crear fase:', nextPhaseDesign);
        const phase = await Phase.create({
          number: nextPhaseNumber,
          // usa `mode` para grupal/individual
          type: nextPhaseDesign.mode || nextPhaseDesign.type || 'regular',
          anon: nextPhaseDesign.anonymous || nextPhaseDesign.anon || false,
          chat: nextPhaseDesign.chat || false,
          prev_ans: (nextPhaseDesign.prevPhasesResponse || []).join(','),
          activity_id: activity.id
        });
        console.log ('[init] tipo siguiente fase', nextPhaseDesign.type);
        // === FORMACIÓN DE GRUPOS si es modo 'group' ===
        if (nextPhaseDesign.type === 'group') {
          console.log('[group] Inicia agrupación');
          const { stdntAmount, grouping_algorithm, heteroQuestionIndex } = nextPhaseDesign;
          console.log('[group] Params:', { stdntAmount, grouping_algorithm, heteroQuestionIndex });
  
          const allPhases = await Phase.findAll({ where: { activity_id: activity.id } });
          console.log('[group] Fases:', allPhases);
          const groups = await groupingAlgorithms[grouping_algorithm || 'random'](
            session.id,
            allPhases,
            stdntAmount,
            heteroQuestionIndex
          );
          console.log('[group] Grupos generados:', groups);
  
          for (const g of groups) {
            const newGroup = await Group.create({ session_id: session.id });
            for (const userId of g) {
              await groupUser.create({ group_id: newGroup.id, user_id: userId });
            }
          }
          console.log('[group] Equipos creados');
        }
  
        console.log('[notify] Enviando notificación');
        studentNotifications.phaseTransition(session.id, phase.id);
  
        res.status(201).json({ status: 'success', data: phase });
      } catch (err) {
        console.error('[init_next_phase] Error:', err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
      }
    }
  );
  

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


router.post('/activities/start', auth, checkAbility('create', 'Activity'), async (req, res) => {
    const { design, session } = req.body;
    const { id: userId } = req.user;

    try {
        const designInstance = await Design.findByPk(design);
        if (!designInstance) {
            return res.status(404).json({ status: 'error', message: 'Design not found' });
        }

        const sessionInstance = await Session.findByPk(session);
        if (!sessionInstance) {
            return res.status(404).json({ status: 'error', message: 'Session not found' });
        }

        if (sessionInstance.creator !== userId) {
            return res.status(403).json({ status: 'error', message: 'You do not own this session' });
        }

        const activity = await Activity.create({ design, session });

        const designJson = typeof designInstance.design === 'string'
            ? JSON.parse(designInstance.design)
            : designInstance.design;

        const firstPhaseJson = designJson.phases?.[0];
        if (!firstPhaseJson) {
            return res.status(400).json({ status: 'error', message: 'No phases defined in design' });
        }

        const firstPhase = await Phase.create({
            number: 1,
            type: firstPhaseJson.mode || 'individual',
            anon: firstPhaseJson.anonymous || false,
            chat: firstPhaseJson.chat || false,
            prev_ans: (firstPhaseJson.prevPhasesResponse || []).join(','),
            activity_id: activity.id
        });

        res.status(201).json({ status: 'success', data: { activity, firstPhase } });
    } catch (err) {
        console.error('[POST /activities/start] Error:', err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

router.post('/activities/end', auth, checkAbility('update', 'Activity'), async (req, res) => {
    const { activityId } = req.body;
    const { id: userId } = req.user;

    try {
        // Validate input
        if (!activityId) {
            return res.status(400).json({ status: 'error', message: 'Activity ID is required' });
        }

        // Find the activity
        const activity = await Activity.findByPk(activityId);
        if (!activity) {
            return res.status(404).json({ status: 'error', message: 'Activity not found' });
        }

        // Verify that the session exists and the user is the creator
        const sessionInstance = await Session.findByPk(activity.session);
        if (!sessionInstance) {
            return res.status(404).json({ status: 'error', message: 'Session not found' });
        }
        if (sessionInstance.creator !== userId) {
            return res.status(403).json({ status: 'error', message: 'You do not own this session' });
        }

        // Check if the activity is already ended
        if (activity.status === 'finished') {
            return res.status(400).json({ status: 'error', message: 'Activity is already finished' });
        }

        // Update activity status to finished
        await activity.update({ status: 'finished' });

        res.status(200).json({ status: 'success', message: 'Activity ended successfully' });
    } catch (err) {
        console.error('[POST /activities/end] Error:', err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});


router.post('/activities/start', auth, checkAbility('create', 'Activity'), async (req, res) => {
    const { design, session } = req.body;
    const { id: userId } = req.user;

    try {
        const designInstance = await Design.findByPk(design);
        if (!designInstance) {
            return res.status(404).json({ status: 'error', message: 'Design not found' });
        }

        const sessionInstance = await Session.findByPk(session);
        if (!sessionInstance) {
            return res.status(404).json({ status: 'error', message: 'Session not found' });
        }

        if (sessionInstance.creator !== userId) {
            return res.status(403).json({ status: 'error', message: 'You do not own this session' });
        }

        const activity = await Activity.create({ design, session });

        const designJson = typeof designInstance.design === 'string'
            ? JSON.parse(designInstance.design)
            : designInstance.design;

        const firstPhaseJson = designJson.phases?.[0];
        if (!firstPhaseJson) {
            return res.status(400).json({ status: 'error', message: 'No phases defined in design' });
        }

        const firstPhase = await Phase.create({
            number: 1,
            type: firstPhaseJson.mode || 'individual',
            anon: firstPhaseJson.anonymous || false,
            chat: firstPhaseJson.chat || false,
            prev_ans: (firstPhaseJson.prevPhasesResponse || []).join(','),
            activity_id: activity.id
        });

        res.status(201).json({ status: 'success', data: { activity, firstPhase } });
    } catch (err) {
        console.error('[POST /activities/start] Error:', err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

router.post('/activities/end', auth, checkAbility('update', 'Activity'), async (req, res) => {
    const { activityId } = req.body;
    const { id: userId } = req.user;

    try {
        // Validate input
        if (!activityId) {
            return res.status(400).json({ status: 'error', message: 'Activity ID is required' });
        }

        // Find the activity
        const activity = await Activity.findByPk(activityId);
        if (!activity) {
            return res.status(404).json({ status: 'error', message: 'Activity not found' });
        }

        // Verify that the session exists and the user is the creator
        const sessionInstance = await Session.findByPk(activity.session);
        if (!sessionInstance) {
            return res.status(404).json({ status: 'error', message: 'Session not found' });
        }
        if (sessionInstance.creator !== userId) {
            return res.status(403).json({ status: 'error', message: 'You do not own this session' });
        }

        // Check if the activity is already ended
        if (activity.status === 'finished') {
            return res.status(400).json({ status: 'error', message: 'Activity is already finished' });
        }

        // Update activity status to finished
        await activity.update({ status: 'finished' });

        res.status(200).json({ status: 'success', message: 'Activity ended successfully' });
    } catch (err) {
        console.error('[POST /activities/end] Error:', err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

module.exports = router;