'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert('differentialsSelections', [
      {
        user_id: 1,
        differential_id: 1,
        sel: 1,
        iteration: 1,
        comment: '¡Me encanta el café!',
        stime: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        user_id: 2,
        differential_id: 2,
        sel: 2,
        iteration: 1,
        comment: 'Prefiero los gatos, son más independientes.',
        stime: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        user_id: 3,
        differential_id: 3,
        sel: 1,
        iteration: 1,
        comment: 'La pizza siempre es la mejor opción para mí.',
        stime: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        user_id: 4,
        differential_id: 4,
        sel: 2,
        iteration: 1,
        comment: 'Me gusta el invierno, puedo hacer deportes de nieve.',
        stime: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        user_id: 5,
        differential_id: 5,
        sel: 1,
        iteration: 1,
        comment: 'Disfruto tanto de las películas como de los libros, pero los libros tienen más detalles.',
        stime: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ], {});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('differentialsSelections', null, {});
  }
};
