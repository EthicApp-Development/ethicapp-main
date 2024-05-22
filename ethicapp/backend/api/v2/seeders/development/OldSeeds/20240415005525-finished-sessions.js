'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert('finished_sessions', [
      {
        user_id: 1,
        session_id: 1,
        status: 1,
        stime: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        user_id: 2,
        session_id: 2,
        status: 1,
        stime: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        user_id: 3,
        session_id: 3,
        status: 0,
        stime: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        user_id: 4,
        session_id: 4,
        status: 1,
        stime: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        user_id: 5,
        session_id: 5,
        status: 0,
        stime: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ], {});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('finished_sessions', null, {});
  }
};
