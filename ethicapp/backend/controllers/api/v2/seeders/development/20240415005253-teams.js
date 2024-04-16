'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert('teams', [
      {
        sesion_id: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        sesion_id: 2,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        sesion_id: 3,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        sesion_id: 4,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        sesion_id: 5,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ], {});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('teams', null, {});
  }
};
