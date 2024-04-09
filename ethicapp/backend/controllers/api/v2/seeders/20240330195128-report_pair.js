'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.bulkInsert('users_sessions_reports', [
      {
        user_id: 1,
        sesion_id: 1,
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        user_id: 2,
        sesion_id: 2,
        created_at: new Date(),
        updated_at: new Date()
      },
      // Agrega más filas según sea necesario
    ], {});
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.bulkDelete('users_sessions_reports', null, {});
  }
};
