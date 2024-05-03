'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert('actorsSelections', [
      {
        description: 'John Doe fue seleccionado como líder del grupo.',
        orden: 1,
        actor_id: 1,
        user_id: 1,
        stage_id: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        description: 'Alice Smith fue elegida para encabezar la próxima presentación.',
        orden: 2,
        actor_id: 2,
        user_id: 2,
        stage_id: 2,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        description: 'Bob Johnson ha sido designado como portavoz del equipo.',
        orden: 3,
        actor_id: 3,
        user_id: 3,
        stage_id: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        description: 'Eva Brown fue seleccionada para liderar el proyecto.',
        orden: 4,
        actor_id: 4,
        user_id: 4,
        stage_id: 3,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        description: 'Michael Clark ha sido asignado como coordinador del evento.',
        orden: 5,
        actor_id: 5,
        user_id: 5,
        stage_id: 2,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ], {});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('actorsSelections', null, {});
  }
};
