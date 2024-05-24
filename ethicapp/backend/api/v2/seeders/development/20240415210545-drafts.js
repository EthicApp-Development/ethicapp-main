'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert('drafts', [
      {
        session_id: 1,
        data: JSON.stringify({ title: 'Draft 1', content: 'This is the first draft' }),
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        session_id: 1,
        data: JSON.stringify({ title: 'Draft 2', content: 'This is the second draft' }),
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        session_id: 2,
        data: JSON.stringify({ title: 'Draft 3', content: 'This is the third draft' }),
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        session_id: 2,
        data: JSON.stringify({ title: 'Draft 4', content: 'This is the fourth draft' }),
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        session_id: 3,
        data: JSON.stringify({ title: 'Draft 5', content: 'This is the fifth draft' }),
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ], {});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('drafts', null, {});
  }
};
