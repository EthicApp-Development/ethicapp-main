'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.bulkInsert('chats', 
    [
      {
        sesion_id: 1,
        stage_id: 1,
        user_id: 1,
        content: 'Hello there!',
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        sesion_id: 1,
        stage_id: 1,
        user_id: 2,
        content: 'Hi! How can I help you?',
        parent_id:1,
        created_at: new Date(),
        updated_at: new Date()
      },
      // Add more chats entries as needed
    ], {});
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.bulkDelete('chats', null, {});
  }
};
