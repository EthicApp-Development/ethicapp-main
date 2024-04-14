'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addColumn('differentials_chats', 'parent_id', {
      type: Sequelize.INTEGER,
      allowNull: true, 
      references: {
        model: 'differentials_chats',
        key: 'id'
      }
    });
    await queryInterface.addColumn('sessions', 'archived', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.dropAllTables();
    //
  }
};
