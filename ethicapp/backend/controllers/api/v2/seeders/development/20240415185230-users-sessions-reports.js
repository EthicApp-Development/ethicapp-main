'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert('User_Sessions_Reports', [
      {
        user_id: 1,
        sesion_id: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        user_id: 2,
        sesion_id: 2,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        user_id: 3,
        sesion_id: 3,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        user_id: 4,
        sesion_id: 4,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        user_id: 5,
        sesion_id: 5,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ], {});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('User_Sessions_Reports', null, {});
  }
};
