'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert('activities', [
      {
        design: 1,
        session: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        design: 2,
        session: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        design: 3,
        session: 2,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        design: 2,
        session: 2,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        design: 1,
        session: 3,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ], {});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('activities', null, {});
  }
};
