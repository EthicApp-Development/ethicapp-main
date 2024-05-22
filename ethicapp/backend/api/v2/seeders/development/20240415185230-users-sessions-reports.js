'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert('user_session_reports', [
      {
        user_id: 1,
        session_id: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        user_id: 2,
        session_id: 2,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        user_id: 3,
        session_id: 3,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        user_id: 4,
        session_id: 4,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        user_id: 5,
        session_id: 5,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ], {});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('user_session_reports', null, {});
  }
};
