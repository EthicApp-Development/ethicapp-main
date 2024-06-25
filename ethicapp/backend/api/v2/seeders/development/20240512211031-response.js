'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert('responses', [
      {
        user_id: 1,
        content: JSON.stringify({ key1: 'value1', key2: 'value2' }),
        type: "Ejemplo",
        createdAt: new Date(),
        updatedAt: new Date(),
        question_id: 1
      },
      {
        user_id: 2,
        content: JSON.stringify({ key1: 'value1', key2: 'value2' }),
        type: "Ejemplo 2",
        createdAt: new Date(),
        updatedAt: new Date(),
        question_id: 1
      },
      {
        user_id: 3,
        content: JSON.stringify({ key1: 'value1', key2: 'value2' }),
        type: "Ejemplo 3",
        createdAt: new Date(),
        updatedAt: new Date(),
        question_id: 1
      },
      {
        user_id: 4,
        content: JSON.stringify({ key1: 'value1', key2: 'value2' }),
        type: "Ejemplo 4",
        createdAt: new Date(),
        updatedAt: new Date(),
        question_id:2
      },
      {
        user_id: 5,
        content: JSON.stringify({ key1: 'value1', key2: 'value2' }),
        type: "Ejemplo 5",
        createdAt: new Date(),
        updatedAt: new Date(),
        question_id:3
      }
    ], {});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('responses', null, {});
  }
};
