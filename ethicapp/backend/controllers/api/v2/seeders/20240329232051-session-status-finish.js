'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Seed data for sessions_status table
    await queryInterface.bulkInsert(
      'sessions_status',
      [
        {
          id: 1,
          sesion_id: 1,
          status: 1,
          stime: new Date(),
          created_at: new Date(),
          updated_at: new Date()
        },
        // Add more records as needed
      ],
      {}
    );

    // Seed data for finished_sessions table
    await queryInterface.bulkInsert(
      'finished_sessions',
      [
        {
          id: 1,
          user_id: 1,
          sesion_id: 1,
          status: 1,
          stime: new Date(),
          created_at: new Date(),
          updated_at: new Date()
        },
        // Add more records as needed
      ],
      {}
    );
  },

  async down(queryInterface, Sequelize) {
    // You might want to implement a down function to remove the seeded data
    // For example, you can use bulkDelete for each table
    await queryInterface.bulkDelete('finished_sessions', null, {});
    await queryInterface.bulkDelete('sessions_status', null, {});
  }
};
