'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.bulkInsert('sessions', [
      {
        name: 'Session 1',
        descr: 'Description of session 1',
        status: 1,
        time: new Date(),
        creator: 1,
        code: 'ABC123',
        type: 'A',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Session 2',
        descr: 'Description of session 2',
        status: 1,
        time: new Date(),
        creator: 2,
        code: 'DEF456',
        type: 'B',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Session 3',
        descr: 'Description of session 3',
        status: 0,
        time: new Date(),
        creator: 3,
        code: 'GHI789',
        type: 'C',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Session 4',
        descr: 'Description of session 4',
        status: 1,
        time: new Date(),
        creator: 4,
        code: 'JKL012',
        type: 'A',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Session 5',
        descr: 'Description of session 5',
        status: 0,
        time: new Date(),
        creator: 5,
        code: 'MNO345',
        type: 'B',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ], {});
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.bulkDelete('sessions', null, {});
  }
};
