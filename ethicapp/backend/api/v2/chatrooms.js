const express = require('express');
const router = express.Router();
const auth = require('../v2/middleware/authenticateToken');
const checkAbility = require('../v2/middleware/checkAbility');
const { Phase, ChatRoom, ChatMessage, groupUser, Session, Activity } = require('./models');

// 1.1 – Listar salas de chat de un grupo/ pregunta/ fase
router.get(
  '/activities/:activityId/phases/:phaseId/questions/:questionId/groups/:groupId/chatrooms',
  auth,
  checkAbility('read', 'ChatMessage'),
  async (req, res) => {
    const { phaseId, questionId, groupId } = req.params;
    const rooms = await ChatRoom.findAll({
      where: { phase_id: phaseId, question_id: questionId, group_id: groupId },
      include: [{ model: ChatMessage, as: 'messages', order: [['created_at','ASC']] }]
    });
    return res.json({ status: 'success', data: rooms });
  }
);

// 1.2 – Crear (o idempotente) la sala de chat para un grupo en una pregunta
router.post(
  '/activities/:activityId/phases/:phaseId/questions/:questionId/groups/:groupId/chatrooms',
  auth,
  checkAbility('create', 'ChatMessage'),
  async (req, res) => {
    const { phaseId, questionId, groupId } = req.params;
    console.log(`Creating chat room for phase ${phaseId}, question ${questionId}, group ${groupId}`);
    // validar fase activa y chat habilitado
    const phase = await Phase.findByPk(phaseId);
    //console.log('Phase details:', phase.chat, phase.status);
    if (!phase || !phase.chat) {
        console.log(`Fase no válida o sin chat habilitado: ${phaseId}`);
        return res.status(400).json({ status:'error', message:'Fase no válida o sin chat' });
    }
    const sessionId = (await Session.findOne({ where: { id: phase.activity_id ? (await Activity.findByPk(phase.activity_id)).session : null } }))?.id;

    // crear o devolver existente
    try {
      console.log(`Checking for existing chat room for phase ${phaseId}, question ${questionId}, group ${groupId}`);
      const [room] = await ChatRoom.findOrCreate({
        where: {
          session_id: sessionId,
          phase_id: phaseId,
          question_id: questionId,
          group_id: groupId
        },
        defaults: {
          phase_id: phaseId,
          question_id: questionId,
          group_id: groupId
        }
      });
      console.log(`Chat room ${room.id} created or already exists`);
      return res.status(201).json({ status: 'success', data: room });
    } catch (error) {
      console.error('[ChatRoom] Error in findOrCreate:', error);
      return res.status(500).json({ status: 'error', message: 'Failed to create or find chat room' });
    }

  }
);

// 1.3 – Obtener mensajes históricos de una sala
router.get(
  '/chatrooms/:chatRoomId/messages',
  auth,
  checkAbility('read', 'ChatMessage'),
  async (req, res) => {
    const { chatRoomId } = req.params;
    const msgs = await ChatMessage.findAll({
      where: { chatroom_id: chatRoomId },
      order: [['created_at','ASC']]
    });
    return res.json({ status:'success', data:msgs });
  }
);

module.exports = router;
