'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert('jigsaw_roles', [
      {
        name: 'Líder de grupo',
        description: 'Responsable de dirigir y coordinar al equipo durante la actividad.',
        session_id: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Investigador',
        description: 'Encargado de recopilar información relevante para resolver la tarea asignada.',
        session_id: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Presentador',
        description: 'Responsable de comunicar los hallazgos del equipo de manera clara y efectiva.',
        session_id: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Moderador',
        description: 'Encargado de facilitar la discusión y asegurarse de que todos los miembros participen de manera equitativa.',
        session_id: 2,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Secretario',
        description: 'Responsable de tomar notas durante las reuniones y organizar la documentación del equipo.',
        session_id: 2,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ], {});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('jigsaw_roles', null, {});
  }
};
