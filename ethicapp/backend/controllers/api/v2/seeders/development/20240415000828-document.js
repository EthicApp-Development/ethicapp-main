'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert('documents', [
      {
        title: 'Document 1',
        path: '/path/to/document1.pdf',
        sesion_id: 1,
        uploader: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        title: 'Document 2',
        path: '/path/to/document2.pdf',
        sesion_id: 2,
        uploader: 2,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        title: 'Document 3',
        path: '/path/to/document3.pdf',
        sesion_id: 3,
        uploader: 3,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        title: 'Document 4',
        path: '/path/to/document4.pdf',
        sesion_id: 4,
        uploader: 4,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        title: 'Document 5',
        path: '/path/to/document5.pdf',
        sesion_id: 5,
        uploader: 5,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ], {});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('documents', null, {});
  }
};
