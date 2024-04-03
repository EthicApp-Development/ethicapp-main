'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
 // Seed data for stages table
    await queryInterface.bulkInsert('stages', [
      {
        number: 1,
        type: 'Type A',
        anon: false,
        chat: false,
        prev_ans: 'Previous answer A',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        number: 2,
        type: 'Type B',
        anon: true,
        chat: true,
        prev_ans: 'Previous answer B',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]);

    // Seed data for actors table
    await queryInterface.bulkInsert('actors', [
      {
        name: 'Actor 1',
        jorder: true,
        stageid: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Actor 2',
        jorder: false,
        stageid: 2,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]);

    // Seed data for actor_selection table
    await queryInterface.bulkInsert('actor_selection', [
      {
        description: 'Description 1',
        orden: 1,
        actorid: 1,
        uid: 1,
        stageid: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        description: 'Description 2',
        orden: 2,
        actorid: 2,
        uid: 2,
        stageid: 2,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]);
  },

  async down (queryInterface, Sequelize) {
    // Remove all entries from the tables
    await queryInterface.bulkDelete('stages', null, {});
    await queryInterface.bulkDelete('actors', null, {});
    await queryInterface.bulkDelete('actor_selection', null, {});
  }
};
