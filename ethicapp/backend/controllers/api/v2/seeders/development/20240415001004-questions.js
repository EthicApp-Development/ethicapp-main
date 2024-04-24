'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert('questions', [
      {
        content: JSON.stringify({ question: '¿Cuál es la capital de Francia?', options: ['Madrid', 'Londres', 'París', 'Berlín'], answer: 2 }),
        additional_info: 'Pregunta sobre geografía',
        type: 'choice',
        text: 'Seleccione la capital de Francia.',
        sesion_id: 1, // Suponiendo que esta pregunta pertenece a la sesión con ID 1
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        content: JSON.stringify({ question: '¿Cuál es la fórmula química del agua?', answer: 'H2O' }),
        additional_info: 'Pregunta sobre química',
        type: 'text',
        text: 'Escriba la fórmula química del agua.',
        sesion_id: 1, // Suponiendo que esta pregunta pertenece a la sesión con ID 1
        createdAt: new Date(),
        updatedAt: new Date()
      },
    ], {});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('questions', null, {});
  }
};
