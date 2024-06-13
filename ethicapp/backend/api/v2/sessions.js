const express = require('express');
const bodyParser = require('body-parser'); // Importa body-parser
const router = express.Router();
const crypto = require('crypto');
const authenticateToken = require('../../api/v2/middleware/authenticateToken');

// Import Model
const { Session, SessionsUsers, User, Activity, Design, Phase } = require('../../api/v2/models');

// Configure body-parser to process the body of requests in JSON format.
router.use(bodyParser.json());

// Read
router.get('/sessions', async (req, res) => {
    try {
        const sessions = await Session.findAll();
        res.status(200).json({ status: 'success', data: sessions });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// Create
router.post('/sessions', authenticateToken, async (req, res) => {
    const { role } = req.user;
    if (role === 'E') {
        return res.status(403).json({ status: 'error', message: 'Only professors or administrator can create sessions' });
    }
    try {
        const code = crypto.randomBytes(3).toString('hex');
        
        const sessionData = {
            ...req.body,
            code: code,
        };

        const session = await Session.create(sessionData);
        const creatorSession = session.creator
        // const design = await Design.findOne({
        //     where: {
        //       creator: creatorSession // Assuming the user ID is stored in req.user.id after authentication
        //     }
        //   });
        const activity = await Activity.create({
            design: 1, // Ajustar según el diseño predeterminado
            session: session.id
        });
        const sessionDescriptor = {
            id: session.id,
            name: session.name,
            creator: session.creator,
            code: session.code,
            status: session.status,
            type: session.type,
            activity: {
                id: activity.id,
                design: activity.design,
                session: activity.session,
            }
        };

        res.status(201).json({ status: 'success', data: sessionDescriptor });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
}); 

//generate a new session by professor
router.post('/sessions/creator/:numberDesign', authenticateToken, async (req, res) => {
    const { role, id } = req.user;
    const { numberDesign } = req.params;
    if (role !== 'P') {
      return res.status(403).json({ status: 'error', message: 'Only professors can create sessions' });
    }
  
    try {
      const code = crypto.randomBytes(3).toString('hex');
      const sessionData = {
        ...req.body,
        code,
        creator: id
      };
      const session = await Session.create(sessionData);
  
      // Crear automáticamente la primera actividad
      const activity = await Activity.create({
        design: numberDesign, // Ajustar según el diseño predeterminado
        session: session.id
      });
    //   const design = await Design.findByPk(numberDesign);
    //   if (!design) {
    //       return res.status(400).json({ status: 'error', message: 'Design not found' });
    //   }

    //   // Crear la primera fase basada en el diseño
    //   const firstPhaseDesign = design.design.phase[0];
    //   const phase = await Phase.create({
    //       number: firstPhaseDesign.number,
    //       type: 'initial',
    //       anon: false,
    //       chat: false,
    //       prev_ans: '',
    //       activity_id: activity.id
    //   });
      const sessionDescriptor = {
        id: session.id,
        code: session.code,
        status: session.status,
        activity: activity.id, // Incluir la actividad creada
        design: parseInt(numberDesign)
      };
  
      res.status(201).json({ status: 'success', data: sessionDescriptor });
    } catch (err) {
      console.error(err);
      res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
  });

// Update
router.put('/sessions/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const session = await Session.findByPk(id);
        if (!session) {
            return res.status(404).json({ status: 'error', message: 'Session not found' });
        }
        await session.update(req.body);
        res.json({ status: 'success', data: session });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// Delete
router.delete('/sessions/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const session = await Session.findByPk(id);
        if (!session) {
            return res.status(404).json({ status: 'error', message: 'Session not found' });
        }
        await session.destroy();
        res.status(204).end();
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// Add User to Session
router.post('/sessions/users', authenticateToken, async (req, res) => {
    const { code, user_id } = req.body;

    try {
        const session = await Session.findOne({ where: { code } });
        if (!session) {
            return res.status(404).json({ status: 'error', message: 'Invalid session code' });
        }
        const user = await User.findByPk(user_id);
        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        const sessionUser = await SessionsUsers.create({
            session_id: session.id,
            user_id: user.id
        });

        res.status(201).json({ status: 'success', data: { session_id: sessionUser.session_id, user_id: sessionUser.user_id } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// Get Users in a Session
router.get('/sessionsUsers/:id/users', authenticateToken, async (req, res) => {
    const { id } = req.params;

    try {
        const session = await Session.findByPk(id);
        if (!session) {
            return res.status(404).json({ status: 'error', message: 'Session not found' });
        }

        // Busca los usuarios asociados a la sesión usando la tabla intermedia SessionsUsers
        const sessionUsers = await SessionsUsers.findAll({
            where: { session_id: id },
            attributes: ['user_id'] // Obtén solo los IDs de los usuarios
        });

        // Mapea los IDs de los usuarios
        const userIds = sessionUsers.map(user => user.user_id);
        //console.log("userIds -=>", userIds)
        res.status(200).json({ status: 'success', data: userIds });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

module.exports = router;
