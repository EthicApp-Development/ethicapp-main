'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert('differentials_chats', [
      {
        user_id: 1,
        differential_id: 1,
        content: '¡Hola! ¿Alguien más prefiere café sobre té?',
        stime: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        user_id: 2,
        differential_id: 1,
        content: '¡Definitivamente! El café es mi bebida favorita.',
        stime: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        user_id: 3,
        differential_id: 2,
        content: '¿Alguien más es equipo gato?',
        stime: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        user_id: 4,
        differential_id: 2,
        content: '¡Sí! Los gatos son geniales, tienen tanto carácter.',
        stime: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        user_id: 5,
        differential_id: 3,
        content: '¿Qué toppings prefieren en su pizza?',
        stime: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ], {});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('differentials_chats', null, {});
  }
};
