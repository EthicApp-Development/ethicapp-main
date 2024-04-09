'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.bulkInsert('report_type', [{
      report_type: 'Tipo de Reporte 1',
      report_description: 'Descripción del Tipo de Reporte 1',
      created_at: new Date(),
      updated_at: new Date()
    }, {
      report_type: 'Tipo de Reporte 2',
      report_description: 'Descripción del Tipo de Reporte 2',
      created_at: new Date(),
      updated_at: new Date()
    }], {});
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.bulkDelete('report_type', null, {});
  }
};
