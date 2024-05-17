'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert('stages', [
      {
        number: 1,
        type: 'Introducción',
        anon: false,
        chats: true,
        prev_ans: null,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        number: 2,
        type: 'Desarrollo',
        anon: true,
        chats: false,
        prev_ans: null,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        number: 3,
        type: 'Cierre',
        anon: false,
        chats: true,
        prev_ans: 'Respuestas de la etapa anterior',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        number: 1,
        type: 'Prueba inicial',
        anon: false,
        chats: false,
        prev_ans: null,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        number: 2,
        type: 'Revisión',
        anon: true,
        chats: true,
        prev_ans: 'Resultados de la prueba inicial',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ], {});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('stages', null, {});
  }
};
