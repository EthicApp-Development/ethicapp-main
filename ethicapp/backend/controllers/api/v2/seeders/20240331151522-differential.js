'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.bulkInsert('differential', [
      {
        title: 'Diferencial 1',
        tleft: 'Texto para la izquierda 1',
        tright: 'Texto para la derecha 1',
        orden: 1,
        creator: 1, // Reemplaza 1 por el ID del usuario creador
        sesid: 1, // Reemplaza 1 por el ID de la sesión relacionada
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        title: 'Diferencial 2',
        tleft: 'Texto para la izquierda 2',
        tright: 'Texto para la derecha 2',
        orden: 2,
        creator: 2, // Reemplaza 2 por el ID del usuario creador
        sesid: 2, // Reemplaza 2 por el ID de la sesión relacionada
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      // Agrega más objetos según sea necesario
    ]);

    // Semilla para la tabla 'differential_selection'
    await queryInterface.bulkInsert('differential_selection', [
      {
        uid: 1, // Reemplaza 1 por el ID del usuario
        did: 1, // Reemplaza 1 por el ID del registro en 'differential' relacionado
        sel: 1,
        iteration: 1,
        comment: 'Comentario sobre la selección',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      // Agrega más objetos según sea necesario
    ]);

    // Semilla para la tabla 'differential_chat'
    await queryInterface.bulkInsert('differential_chat', [
      {
        uid: 1, // Reemplaza 1 por el ID del usuario
        did: 1, // Reemplaza 1 por el ID del registro en 'differential' relacionado
        content: 'Mensaje de chat 1',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        uid: 2, // Reemplaza 2 por el ID del usuario
        did: 1, // Reemplaza 1 por el ID del registro en 'differential' relacionado
        content: 'Mensaje de chat 2',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      // Agrega más objetos según sea necesario
    ]);
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.bulkDelete('differential_chat', null, {});
    await queryInterface.bulkDelete('differential_selection', null, {});
    await queryInterface.bulkDelete('differential', null, {});
  }
};
