'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert('actors', [
      {
        name: 'John Doe',
        jorder: true,
        stage_id: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Alice Smith',
        jorder: false,
        stage_id: 2,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Bob Johnson',
        jorder: true,
        stage_id: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Eva Brown',
        jorder: false,
        stage_id: 3,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Michael Clark',
        jorder: true,
        stage_id: 2,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ], {});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('actors', null, {});
  }
};
