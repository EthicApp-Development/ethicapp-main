'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert('questions', [
      {
        content: 'What is the capital of France?',
        options: JSON.stringify(['Paris', 'Madrid', 'London', 'Berlin']),
        answer: 0,
        comment: 'Paris is the capital of France.',
        other: null,
        sesion_id: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        content: 'Who wrote "Romeo and Juliet"?',
        options: JSON.stringify(['William Shakespeare', 'Charles Dickens', 'Jane Austen', 'Leo Tolstoy']),
        answer: 0,
        comment: 'William Shakespeare wrote "Romeo and Juliet".',
        other: null,
        sesion_id: 2,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        content: 'What is the chemical symbol for water?',
        options: JSON.stringify(['H2O', 'CO2', 'NaCl', 'O2']),
        answer: 0,
        comment: 'H2O is the chemical symbol for water.',
        other: null,
        sesion_id: 3,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        content: 'Who painted the Mona Lisa?',
        options: JSON.stringify(['Leonardo da Vinci', 'Vincent van Gogh', 'Pablo Picasso', 'Michelangelo']),
        answer: 0,
        comment: 'Leonardo da Vinci painted the Mona Lisa.',
        other: null,
        sesion_id: 4,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        content: 'What is the largest planet in our solar system?',
        options: JSON.stringify(['Jupiter', 'Saturn', 'Earth', 'Mars']),
        answer: 0,
        comment: 'Jupiter is the largest planet in our solar system.',
        other: null,
        sesion_id: 5,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ], {});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('questions', null, {});
  }
};
