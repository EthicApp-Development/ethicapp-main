'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.bulkInsert('chat', 
    [
      {
        sesid: 1,
        stageid: 1,
        uid: 1,
        content: 'Hello there!',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        sesid: 1,
        stageid: 1,
        uid: 2,
        content: 'Hi! How can I help you?',
        parent_id:1,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      // Add more chat entries as needed
    ], {});
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.bulkDelete('chat', null, {});
  }
};
