'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert('jigsaw_users', [
      {
        stage_id: 1,
        user_id: 1,
        role_id: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        stage_id: 1,
        user_id: 2,
        role_id: 2,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        stage_id: 2,
        user_id: 3,
        role_id: 3,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        stage_id: 2,
        user_id: 4,
        role_id: 4,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        stage_id: 3,
        user_id: 5,
        role_id: 5,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ], {});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('jigsaw_users', null, {});
  }
};
