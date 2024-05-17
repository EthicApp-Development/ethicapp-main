'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert('designs_documents', [
      {
        path: '/uploads/design1_document.pdf',
        dsgnid: 1,
        uploader: 1,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        path: '/uploads/design2_document.pdf',
        dsgnid: 2,
        uploader: 2,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        path: '/uploads/design3_document.pdf',
        dsgnid: 3,
        uploader: 3,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        path: '/uploads/design4_document.pdf',
        dsgnid: 1,
        uploader: 1,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        path: '/uploads/design5_document.pdf',
        dsgnid: 2,
        uploader: 2,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ], {});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('designs_documents', null, {});
  }
};
