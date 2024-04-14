'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.removeConstraint('designs_documents', 'designs_documents_dsgnid_fkey');
    await queryInterface.addConstraint('designs_documents', {
      fields: ['dsgnid'],
      type: 'foreign key',
      name: 'designs_documents_dsgnid_fkey',
      references: {
        table: 'designs',
        field: 'id'
      },
      onDelete: 'CASCADE'
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.dropAllTables();
    //
  }
};
