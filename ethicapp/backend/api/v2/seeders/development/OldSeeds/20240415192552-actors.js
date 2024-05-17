'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert('actors', [
      {
        name: 'John Doe',
        jorder: true,
        phase_id: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Alice Smith',
        jorder: false,
        phase_id: 2,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Bob Johnson',
        jorder: true,
        phase_id: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Eva Brown',
        jorder: false,
        phase_id: 3,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Michael Clark',
        jorder: true,
        phase_id: 2,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ], {});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('actors', null, {});
  }
};
