'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert('activity_reports', [
      {
        creation_date: new Date(),
        professor: 1, // ID del profesor asociado
        count: 5, // Número de actividades
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        creation_date: new Date(),
        professor: 2, // ID del segundo profesor asociado
        count: 3, // Número de actividades
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        creation_date: new Date(),
        professor: 3, // ID del tercer profesor asociado
        count: 7, // Número de actividades
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ], {});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('activity_reports', null, {});
  }
};
