'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // // await queryInterface.createTable('create22s', {
    // //   id: {
    // //     allowNull: false,
    // //     autoIncrement: true,
    // //     primaryKey: true,
    // //     type: Sequelize.INTEGER
    // //   },
    // //   ids: {
    // //     type: Sequelize.INTEGER
    // //   },
    // //   createdAt: {
    // //     allowNull: false,
    // //     type: Sequelize.DATE
    // //   },
    // //   updatedAt: {
    // //     allowNull: false,
    // //     type: Sequelize.DATE
    // //   }
    // // });
    // await queryInterface.addConstraint('differential_chat', {
    //   type: 'primary key',
    //   fields: ['id']
    // });
    await queryInterface.addColumn('differential_chat', 'parent_id', {
      type: Sequelize.INTEGER,
      allowNull: true, 
      references: {
        model: 'differential_chat',
        key: 'id'
      }
    });
    await queryInterface.addColumn('sessions', 'archived', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });
    
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropAllTables();
  }
};