'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert('differentials', [
      {
        title: 'Comparación de café y té',
        text_left: 'El café es una bebida estimulante hecha a partir de granos de café tostados.',
        text_right: 'El té es una bebida aromática preparada al verter agua caliente sobre hojas de té.',
        orden: 1,
        creator: 1,
        sesion_id: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        title: 'Comparación de perros y gatos',
        text_left: 'Los perros son animales leales y amigables que disfrutan de la compañía humana.',
        text_right: 'Los gatos son animales independientes y reservados que disfrutan de su propia compañía.',
        orden: 2,
        creator: 2,
        sesion_id: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        title: 'Comparación de pizza y hamburguesa',
        text_left: 'La pizza es un plato italiano que consiste en una base de masa cubierta con salsa y diversos ingredientes.',
        text_right: 'La hamburguesa es un sándwich que consta de una o más hamburguesas de carne entre dos trozos de pan.',
        orden: 3,
        creator: 3,
        sesion_id: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        title: 'Comparación de verano e invierno',
        text_left: 'El verano es una estación cálida del año con días largos y temperaturas altas.',
        text_right: 'El invierno es una estación fría del año con días cortos y temperaturas bajas.',
        orden: 4,
        creator: 4,
        sesion_id: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        title: 'Comparación de películas y libros',
        text_left: 'Las películas son obras audiovisuales que cuentan historias a través de imágenes y sonidos.',
        text_right: 'Los libros son obras escritas que cuentan historias a través de palabras impresas en papel.',
        orden: 5,
        creator: 5,
        sesion_id: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ], {});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('differentials', null, {});
  }
};
