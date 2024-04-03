'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // await queryInterface.createTable('create34s', {
    //   id: {
    //     allowNull: false,
    //     autoIncrement: true,
    //     primaryKey: true,
    //     type: Sequelize.INTEGER
    //   },
    //   bool: {
    //     type: Sequelize.BOOLEAN
    //   },
    //   createdAt: {
    //     allowNull: false,
    //     type: Sequelize.DATE
    //   },
    //   updatedAt: {
    //     allowNull: false,
    //     type: Sequelize.DATE
    //   }
    // });
    await queryInterface.addColumn('users','disabled',{
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false
    })
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('users', 'disabled');
    await queryInterface.dropAllTables();
  }
};