'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert('chatrooms', [
      {
        sesion_id: 1,
        phase_id: 1,
        user_id: 1,
        content: '¡Hola a todos! ¿Cómo están?',
        stime: new Date(),
        parent_id: null,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        sesion_id: 1,
        phase_id: 1,
        user_id: 2,
        content: '¡Hola! Estoy bien, gracias por preguntar.',
        stime: new Date(),
        parent_id: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        sesion_id: 1,
        phase_id: 2,
        user_id: 3,
        content: '¿Alguien tiene alguna pregunta sobre el tema que estamos discutiendo?',
        stime: new Date(),
        parent_id: null,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        sesion_id: 1,
        phase_id: 2,
        user_id: 4,
        content: 'Sí, tengo una pregunta...',
        stime: new Date(),
        parent_id: 3,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        sesion_id: 2,
        phase_id: 3,
        user_id: 5,
        content: '¡Buen trabajo, equipo!',
        stime: new Date(),
        parent_id: null,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ], {});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('chatrooms', null, {});
  }
};
