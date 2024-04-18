'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert('sessionsStatus', [
      {
        sesion_id: 1,
        status: 1,
        stime: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        sesion_id: 2,
        status: 1,
        stime: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        sesion_id: 3,
        status: 0,
        stime: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        sesion_id: 4,
        status: 1,
        stime: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        sesion_id: 5,
        status: 0,
        stime: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ], {});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('sessionsStatus', null, {});
  }
};
