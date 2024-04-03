'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.bulkInsert('report_pair', [
      {
        uid: 1,
        sesid: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        uid: 2,
        sesid: 2,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      // Agrega más filas según sea necesario
    ], {});
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.bulkDelete('report_pair', null, {});
  }
};
