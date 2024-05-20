'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert('account_creation_reports', [
      {
        creation_date: new Date(),
        is_teacher: true, // Cuenta de profesor
        count: 10, // Número de cuentas creadas
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        creation_date: new Date(),
        is_teacher: false, // Cuenta de estudiante
        count: 20, // Número de cuentas creadas
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        creation_date: new Date(),
        is_teacher: true, // Cuenta de profesor
        count: 15, // Número de cuentas creadas
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ], {});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('account_creation_reports', null, {});
  }
};
