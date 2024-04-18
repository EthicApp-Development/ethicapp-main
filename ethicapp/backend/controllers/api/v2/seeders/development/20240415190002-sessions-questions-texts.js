'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert('sessionsQuestionsTexts', [
      {
        sesion_id: 1,
        title: 'Pregunta 1: El desafío del día',
        content: '¿Cuántos rebanadas de pizza puedes comer en un minuto?',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        sesion_id: 2,
        title: 'Reto de la semana',
        content: '¡Descubre quién puede hacer el baile más ridículo!',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        sesion_id: 3,
        title: 'Pregunta del millón',
        content: '¿Por qué el pollo cruzó la carretera?',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        sesion_id: 4,
        title: '¿Qué prefieres?',
        content: '¿Prefieres luchar contra 100 patos del tamaño de un caballo o contra un caballo del tamaño de un pato?',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        sesion_id: 5,
        title: 'Desafío intelectual',
        content: '¿Cuántas palabras puedes deletrear correctamente al revés?',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ], {});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('sessionsQuestionsTexts', null, {});
  }
};
