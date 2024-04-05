'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.bulkInsert(
      'userexample',
      [
        {
          id: 1,
          name: 'profesor',
          email: 'profesor@test.com',
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          id: 2,
          name: 'alumno1',
          email: 'alumno1@test.com',
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          id: 3,
          name: 'alumno2',
          email: 'alumno2@test.com',
          created_at: new Date(),
          updated_at: new Date(),
        },
      ],
      {}
    );
    await queryInterface.bulkInsert(
      'channel1',
      [
        {
          id: 1,
          name: 'historia',
          user_id: 1,
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          id: 2,
          name: 'matematicas',
          user_id: 2,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ],
      {}
    );
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.bulkDelete('channel', null, bulkDeleteOptions);
    await queryInterface.bulkDelete('video', null, bulkDeleteOptions);
    await queryInterface.bulkDelete('user', null, bulkDeleteOptions);
    await queryInterface.bulkDelete('alltypes', null, bulkDeleteOptions)
  }
};
