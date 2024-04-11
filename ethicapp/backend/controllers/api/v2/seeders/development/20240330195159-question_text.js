'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.bulkInsert('sessions_questions_texts', [
      {
        sesion_id: 1,
        title: 'Título de la pregunta 1',
        content: 'Contenido de la pregunta 1',
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        sesion_id: 1,
        title: 'Título de la pregunta 2',
        content: 'Contenido de la pregunta 2',
        created_at: new Date(),
        updated_at: new Date()
      },
    ], {});
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.bulkDelete('sessions_questions_texts', null, {});
  }
};
