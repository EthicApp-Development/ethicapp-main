'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert('teams_users', [
      {
        team_id: 1,
        user_id: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        team_id: 1,
        user_id: 2,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        team_id: 2,
        user_id: 3,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        team_id: 2,
        user_id: 4,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        team_id: 3,
        user_id: 5,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ], {});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('teams_users', null, {});
  }
};
