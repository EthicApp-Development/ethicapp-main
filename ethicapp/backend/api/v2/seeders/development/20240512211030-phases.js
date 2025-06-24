'use strict';

module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.bulkInsert('phases', [
      {
        number: 1,
        mode: 'Type A', 
        anon: true,
        chat: false,
        prev_ans: 'Previous answer A',
        activity_id: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        number: 2,
        mode: 'Type B',
        anon: false,
        chat: true,
        prev_ans: 'Previous answer B',
        activity_id: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        number: 3,
        mode: 'Type C',
        anon: true,
        chat: true,
        prev_ans: 'Previous answer C',
        activity_id: 2,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        number: 4,
        mode: 'Type D',
        anon: true,
        chat: true,
        prev_ans: 'Previous D answer',
        activity_id: 3,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]);
  },

  async down (queryInterface, Sequelize) {
    
    await queryInterface.bulkDelete('phases', null, {});
  }
};
