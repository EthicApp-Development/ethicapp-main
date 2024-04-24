'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert('finishedSessions', [
      {
        user_id: 1,
        sesion_id: 1,
        status: 1,
        stime: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        user_id: 2,
        sesion_id: 2,
        status: 1,
        stime: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        user_id: 3,
        sesion_id: 3,
        status: 0,
        stime: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        user_id: 4,
        sesion_id: 4,
        status: 1,
        stime: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        user_id: 5,
        sesion_id: 5,
        status: 0,
        stime: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ], {});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('finishedSessions', null, {});
  }
};
