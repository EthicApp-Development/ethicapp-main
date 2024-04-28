'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert('questions', [
      {
        content: JSON.stringify({ question: '¿Cuál es la capital de Francia?', options: ['Madrid', 'Londres', 'París', 'Berlín'], answer: 2 }),
        additional_info: 'Pregunta sobre geografía',
        type: 'choice',
        text: 'Seleccione la capital de Francia.',
        sesion_id: 1, 
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        content: JSON.stringify({ question: '¿Cuál es la fórmula química del agua?', answer: 'H2O' }),
        additional_info: 'Pregunta sobre química',
        type: 'text',
        text: 'Escriba la fórmula química del agua.',
        sesion_id: 1, 
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        content: JSON.stringify({ question: '¿que pesa mas un kilo de piedras o un kilo de plumas?', answer: 'ambas pesan igual' }),
        additional_info: 'Pregunta sobre fisica',
        type: 'text',
        text: 'Escriba la differencia de peso',
        sesion_id: 2, 
        createdAt: new Date(),
        updatedAt: new Date()
      },
    ], {});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('questions', null, {});
  }
};
