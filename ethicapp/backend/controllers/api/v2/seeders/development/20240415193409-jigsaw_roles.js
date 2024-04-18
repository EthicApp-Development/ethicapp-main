'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert('jigsawRoles', [
      {
        name: 'Líder de grupo',
        description: 'Responsable de dirigir y coordinar al equipo durante la actividad.',
        sesion_id: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Investigador',
        description: 'Encargado de recopilar información relevante para resolver la tarea asignada.',
        sesion_id: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Presentador',
        description: 'Responsable de comunicar los hallazgos del equipo de manera clara y efectiva.',
        sesion_id: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Moderador',
        description: 'Encargado de facilitar la discusión y asegurarse de que todos los miembros participen de manera equitativa.',
        sesion_id: 2,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Secretario',
        description: 'Responsable de tomar notas durante las reuniones y organizar la documentación del equipo.',
        sesion_id: 2,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ], {});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('jigsawRoles', null, {});
  }
};
