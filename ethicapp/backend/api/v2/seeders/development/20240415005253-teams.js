'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert('teams', [
      {
        session_id: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        session_id: 2,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        session_id: 3,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        session_id: 4,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        session_id: 5,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ], {});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('teams', null, {});
  }
};
