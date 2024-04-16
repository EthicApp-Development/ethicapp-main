'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert('report_types', [
      {
        report_type: 'Login', // Tipo de reporte: inicio de sesión
        report_description: 'Reporte de inicios de sesión', // Descripción del tipo de reporte
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        report_type: 'Activity', // Tipo de reporte: actividad
        report_description: 'Reporte de actividades realizadas', // Descripción del tipo de reporte
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        report_type: 'Account Creation', // Tipo de reporte: creación de cuenta
        report_description: 'Reporte de creación de cuentas', // Descripción del tipo de reporte
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ], {});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('report_types', null, {});
  }
};
