'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Seed data for status_record table
    await queryInterface.bulkInsert(
      'status_record',
      [
        {
          id: 1,
          sesid: 1,
          status: 1,
          stime: new Date(),
          createdAt: new Date(),
          updatedAt: new Date()
        },
        // Add more records as needed
      ],
      {}
    );

    // Seed data for finish_session table
    await queryInterface.bulkInsert(
      'finish_session',
      [
        {
          id: 1,
          uid: 1,
          sesid: 1,
          status: 1,
          stime: new Date(),
          createdAt: new Date(),
          updatedAt: new Date()
        },
        // Add more records as needed
      ],
      {}
    );
  },

  async down(queryInterface, Sequelize) {
    // You might want to implement a down function to remove the seeded data
    // For example, you can use bulkDelete for each table
    await queryInterface.bulkDelete('finish_session', null, {});
    await queryInterface.bulkDelete('status_record', null, {});
  }
};
