'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.bulkInsert('question_text', [
      {
        sesid: 1,
        title: 'Título de la pregunta 1',
        content: 'Contenido de la pregunta 1',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        sesid: 1,
        title: 'Título de la pregunta 2',
        content: 'Contenido de la pregunta 2',
        createdAt: new Date(),
        updatedAt: new Date()
      },
    ], {});
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.bulkDelete('question_text', null, {});
  }
};
