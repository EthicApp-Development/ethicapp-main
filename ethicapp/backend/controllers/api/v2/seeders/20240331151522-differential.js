'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.bulkInsert('differentials', [
      {
        title: 'Diferencial 1',
        text_left: 'Texto para la izquierda 1',
        text_right: 'Texto para la derecha 1',
        orden: 1,
        creator: 1, // Reemplaza 1 por el ID del usuario creador
        sesion_id: 1, // Reemplaza 1 por el ID de la sesión relacionada
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        title: 'Diferencial 2',
        text_left: 'Texto para la izquierda 2',
        text_right: 'Texto para la derecha 2',
        orden: 2,
        creator: 2, // Reemplaza 2 por el ID del usuario creador
        sesion_id: 2, // Reemplaza 2 por el ID de la sesión relacionada
        created_at: new Date(),
        updated_at: new Date(),
      },
      // Agrega más objetos según sea necesario
    ]);

    // Semilla para la tabla 'differentials_selections'
    await queryInterface.bulkInsert('differentials_selections', [
      {
        user_id: 1, // Reemplaza 1 por el ID del usuario
        differential_id: 1, // Reemplaza 1 por el ID del registro en 'differentials' relacionado
        sel: 1,
        iteration: 1,
        comment: 'Comentario sobre la selección',
        created_at: new Date(),
        updated_at: new Date(),
      },
      // Agrega más objetos según sea necesario
    ]);

    // Semilla para la tabla 'differentials_chats'
    await queryInterface.bulkInsert('differentials_chats', [
      {
        user_id: 1, // Reemplaza 1 por el ID del usuario
        differential_id: 1, // Reemplaza 1 por el ID del registro en 'differentials' relacionado
        content: 'Mensaje de chats 1',
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        user_id: 2, // Reemplaza 2 por el ID del usuario
        differential_id: 1, // Reemplaza 1 por el ID del registro en 'differentials' relacionado
        content: 'Mensaje de chats 2',
        created_at: new Date(),
        updated_at: new Date(),
      },
      // Agrega más objetos según sea necesario
    ]);
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.bulkDelete('differentials_chats', null, {});
    await queryInterface.bulkDelete('differentials_selections', null, {});
    await queryInterface.bulkDelete('differentials', null, {});
  }
};
