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
        chats: false,
        prev_ans: 'Previous answer A',
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        number: 2,
        type: 'Type B',
        anon: true,
        chats: true,
        prev_ans: 'Previous answer B',
        created_at: new Date(),
        updated_at: new Date()
      }
    ]);

    // Seed data for actors table
    await queryInterface.bulkInsert('actors', [
      {
        name: 'Actor 1',
        jorder: true,
        stage_id: 1,
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        name: 'Actor 2',
        jorder: false,
        stage_id: 2,
        created_at: new Date(),
        updated_at: new Date()
      }
    ]);

    // Seed data for actors_selections table
    await queryInterface.bulkInsert('actors_selections', [
      {
        description: 'Description 1',
        orden: 1,
        actor_id: 1,
        user_id: 1,
        stage_id: 1,
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        description: 'Description 2',
        orden: 2,
        actor_id: 2,
        user_id: 2,
        stage_id: 2,
        created_at: new Date(),
        updated_at: new Date()
      }
    ]);
  },

  async down (queryInterface, Sequelize) {
    // Remove all entries from the tables
    await queryInterface.bulkDelete('stages', null, {});
    await queryInterface.bulkDelete('actors', null, {});
    await queryInterface.bulkDelete('actors_selections', null, {});
  }
};
