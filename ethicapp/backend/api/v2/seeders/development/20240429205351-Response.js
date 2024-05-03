'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert('responses', [
      {
        uid: 1,
        description: 'Descripción de la respuesta 1',
        comment: 'Comentario de la respuesta 1',
        stime: new Date(),
        content: JSON.stringify({ key1: 'value1', key2: 'value2' }),
        uses: 'Usos de la respuesta 1',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        uid: 2,
        description: 'Descripción de la respuesta 2',
        comment: 'Comentario de la respuesta 2',
        stime: new Date(),
        content: JSON.stringify({ key1: 'value1', key2: 'value2' }),
        uses: 'Usos de la respuesta 2',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        uid: 3,
        description: 'Descripción de la respuesta 3',
        comment: 'Comentario de la respuesta 3',
        stime: new Date(),
        content: JSON.stringify({ key1: 'value1', key2: 'value2' }),
        uses: 'Usos de la respuesta 3',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        uid: 4,
        description: 'Descripción de la respuesta 4',
        comment: 'Comentario de la respuesta 4',
        stime: new Date(),
        content: JSON.stringify({ key1: 'value1', key2: 'value2' }),
        uses: 'Usos de la respuesta 4',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        uid: 5,
        description: 'Descripción de la respuesta 5',
        comment: 'Comentario de la respuesta 5',
        stime: new Date(),
        content: JSON.stringify({ key1: 'value1', key2: 'value2' }),
        uses: 'Usos de la respuesta 5',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ], {});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('responses', null, {});
  }
};
