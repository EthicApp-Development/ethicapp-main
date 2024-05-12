'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addColumn('phases', 'question', {
      type: Sequelize.TEXT,
      allowNull: true
    });
    await queryInterface.addColumn('phases', 'grouping', {
      type: Sequelize.STRING(63), 
      allowNull: true
    });
    await queryInterface.addColumn('phases', 'options', {
      type: Sequelize.TEXT,
      allowNull: true
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.dropAllTables();
  }
};
