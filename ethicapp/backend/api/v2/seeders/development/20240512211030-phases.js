'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.bulkInsert('phases', [
      {
        number: 1,
        type: 'Type A',
        anon: true,
        chat: false,
        prev_ans: 'Previous answer A',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        number: 2,
        type: 'Type B',
        anon: false,
        chat: true,
        prev_ans: 'Previous answer B',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        number: 3,
        type: 'Type c',
        anon: true,
        chat: true,
        prev_ans: 'Previous answer C',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        number: 4,
        type: 'Type D',
        anon: true,
        chat: true,
        prev_ans: 'Previous D answer',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]);
  },

  async down (queryInterface, Sequelize) {
    /**
     * Add commands to revert seed here.
     *
     * Example:
     * await queryInterface.bulkDelete('People', null, {});
     */
  }
};
