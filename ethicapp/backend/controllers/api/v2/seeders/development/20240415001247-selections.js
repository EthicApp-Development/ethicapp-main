'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert('selections', [
      {
        answer: 0,
        user_id: 1,
        iteration: 1,
        comment: 'I chose option 1',
        question_id: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        answer: 2,
        user_id: 2,
        iteration: 1,
        comment: 'I chose option 3',
        question_id: 2,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        answer: 1,
        user_id: 3,
        iteration: 1,
        comment: 'I chose option 2',
        question_id: 3,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        answer: 3,
        user_id: 4,
        iteration: 1,
        comment: 'I chose option 4',
        question_id: 4,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        answer: 1,
        user_id: 5,
        iteration: 1,
        comment: 'I chose option 2',
        question_id: 5,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ], {});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('selections', null, {});
  }
};
