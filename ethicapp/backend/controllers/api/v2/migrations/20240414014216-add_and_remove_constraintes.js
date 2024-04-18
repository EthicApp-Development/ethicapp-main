'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.removeConstraint('designsDocuments', 'designsDocuments_dsgnid_fkey');
    await queryInterface.addConstraint('designsDocuments', {
      fields: ['dsgnid'],
      type: 'foreign key',
      name: 'designsDocuments_dsgnid_fkey',
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
