'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    // await queryInterface.addColumn('differentialsChats', 'parent_id', {
    //   type: Sequelize.INTEGER,
    //   allowNull: true, 
    //   references: {
    //     model: 'differentialsChats',
    //     key: 'id'
    //   }
    // });
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
