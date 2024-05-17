'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert('report_logins', [
      {
        login_date: new Date(),
        is_teacher: true, // Inicio de sesión de un profesor
        count: 5, // Número de inicios de sesión
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        login_date: new Date(),
        is_teacher: false, // Inicio de sesión de un estudiante
        count: 10, // Número de inicios de sesión
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        login_date: new Date(),
        is_teacher: true, // Inicio de sesión de un profesor
        count: 7, // Número de inicios de sesión
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ], {});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('report_logins', null, {});
  }
};
